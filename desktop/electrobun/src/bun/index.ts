import { ApplicationMenu, BrowserWindow, Updater, Utils, app } from "electrobun/main";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { studio, type Studio } from "./studio";

/*
 * The desktop shell: one window per open deck, plus a Decks window over the chooser the studio
 * serves at `/`. A single studio server now holds every open deck at `/d/<id>/`, so this side
 * spawns it once for the app's life and never restarts it; opening or making a deck is a request
 * against that one server, answered with the id and url of the deck it opened.
 */

/** the checkout and the bun that runs it, both baked in by electrobun.config.ts */
const repo = process.env.AINSI_REPO!;
const bun = process.env.AINSI_BUN!;

/*
 * What the studio's file browser may reach. Home rather than the working directory, which is
 * `/` for anything launched from an icon, and rather than a dialog on launch, which asks a
 * question before showing anything and has no answer for someone who wants a new deck.
 */
const root = process.env.AINSI_DECK ? dirname(process.env.AINSI_DECK) : homedir();

const server: Studio = await studio({ repo, bun, root });

/** every deck window, keyed by the id the server gave it; a second open of the same id focuses this one rather than making another */
const windows = new Map<string, { win: BrowserWindow; title: string }>();
/** the Decks window, made lazily and remade if it was closed */
let decksWin: BrowserWindow | undefined;
/** the deck id of the frontmost window, or undefined when Decks is frontmost; the only source the Window menu and the needsDeck gate read */
let activeId: string | undefined;

/** the deck a `document.title` names, read off the page rather than kept here: the page already
 * decides what a deck is called, and scraping it is cheaper than a second source that can drift */
async function titleOf(url: string): Promise<string> {
    const html = await fetch(new URL(url, server.url)).then(r => r.text()).catch(() => "");
    return /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "Deck";
}

const WINDOW_FRAME = { width: 1440, height: 900, x: 80, y: 60 };

/*
 * No titlebar of the system's own: the page draws that strip, so the window is one bar rather
 * than a native one with the studio's own under it. The traffic lights stay, drawn over the
 * page's top-left corner, and --ac-lights is the room the chrome leaves them; the offset drops
 * them to the middle of a 44px strip.
 *
 * A window that navigates itself to another deck's url is intercepted rather than let through:
 * every deck gets its own window, so this one is sent back to its own url and the navigation is
 * redirected into openDeckWindow instead. This is how a click inside the chooser or a deck's own
 * chrome ends up opening a window here, without this side needing to know how that click made it
 * happen.
 */
function open(win: BrowserWindow, home: string, ownId: string | undefined): void {
    win.webview.on("dom-ready" as "did-navigate", () => { if (offered) announce(); });
    win.webview.on("did-navigate", async event => {
        const to = (event as { data?: { detail?: string } }).data?.detail;
        const id = to && /\/d\/([^/]+)\//.exec(to)?.[1];
        if (!id || id === ownId) return;
        win.webview.loadURL(home);
        openDeckWindow(id, to!, await titleOf(to!));
    });
}

/** the Decks window: the chooser at `/`, made once and reused, remade if it was closed */
function openDecks(): BrowserWindow {
    if (decksWin) { decksWin.activate(); return decksWin; }
    const win = new BrowserWindow({
        title: "Decks", url: `${server.url}/`, frame: WINDOW_FRAME,
        titleBarStyle: "hiddenInset", trafficLightOffset: { x: 0, y: 8 },
    });
    decksWin = win;
    open(win, `${server.url}/`, undefined);
    win.on("close", () => { decksWin = undefined; paintMenu(); });
    win.on("focus", () => { activeId = undefined; paintMenu(); });
    activeId = undefined;
    paintMenu();
    return win;
}

/** a deck's own window: made once per id, focused rather than duplicated on a second open */
function openDeckWindow(id: string, url: string, title: string): BrowserWindow {
    const existing = windows.get(id);
    if (existing) { existing.win.activate(); return existing.win; }
    // the server answers with the deck's path on itself; a window needs the whole address, and
    // a relative one loads as a blank page rather than as an error anyone can see
    url = new URL(url, server.url).href;
    const win = new BrowserWindow({
        title, url, frame: WINDOW_FRAME,
        titleBarStyle: "hiddenInset", trafficLightOffset: { x: 0, y: 8 },
    });
    windows.set(id, { win, title });
    open(win, url, id);
    win.on("close", () => { windows.delete(id); if (activeId === id) activeId = undefined; paintMenu(); });
    win.on("focus", () => { activeId = id; paintMenu(); });
    activeId = id;
    paintMenu();
    return win;
}

/** every deck-opening door funnels here: a path picked from a dialog, or one asked for at launch */
async function openPath(path: string): Promise<void> {
    if (!path.endsWith(".md")) { openDecks(); return; } // a folder: nothing left to reroot a shared server to, so this just brings the chooser up
    // the key says this path came out of a native dialog, so it may live outside the roots a
    // page is held to; without it the app could only ever open decks under the launch folder
    const res = await fetch(`${server.url}/__open`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ainsi-shell": server.key },
        body: JSON.stringify({ path }),
    }).catch(() => undefined);
    if (!res?.ok) return;
    const { id, url } = await res.json() as { id: string; url: string };
    openDeckWindow(id, url, await titleOf(url));
}

/** a url the server already holds, named by its own `/d/<id>/` prefix */
async function openAsked(url: string): Promise<void> {
    const id = /\/d\/([^/]+)\//.exec(url)?.[1];
    if (!id) return;
    openDeckWindow(id, url, await titleOf(url));
}

/*
 * Opening moves nothing any more: the server already holds every deck, so this is a native
 * dialog and a request against it, never a restart.
 */
async function openDialog(): Promise<void> {
    const chosen = await Utils.openFileDialog({
        startingFolder: root,
        allowedFileTypes: "md",
        canChooseFiles: true,
        canChooseDirectory: true,
        allowsMultipleSelection: false,
    });
    const picked = chosen[0];
    if (picked) await openPath(picked);
}

/** the window a menu action or a page command is meant for: whichever one is frontmost */
function activeWindow(): BrowserWindow {
    return (activeId ? windows.get(activeId)?.win : decksWin) ?? openDecks();
}

/*
 * Everything but Open is the page's own doing: the shell dispatches the command to whichever
 * window is frontmost and the studio runs it with its own progress and its own errors, so a
 * native File menu and the studio's own menu are one implementation and this side never learns
 * an endpoint.
 *
 * There is no Save and no Save As, and adding either would be a lie: an edit is written to
 * the markdown the moment it is committed, so there has never been anything unsaved to keep.
 * The nearest real thing is the filename field in the studio's own chrome, which renames.
 */
const command = (name: string) => {
    const win = activeWindow();
    win.activate();
    win.webview.executeJavascript(`document.dispatchEvent(new CustomEvent("ainsi:command",{detail:${JSON.stringify(name)}}))`);
};

/** the next deck window over from the frontmost one, wrapping; a no-op with fewer than two open */
function cycle(): void {
    const ids = [...windows.keys()];
    if (ids.length < 2) return;
    const at = activeId ? ids.indexOf(activeId) : -1;
    windows.get(ids[(at + 1) % ids.length]!)?.win.activate();
}

/*
 * The menu, drawn for the window that is frontmost. With Decks frontmost most of the deck-only
 * items can do nothing, and an item that answers a click with silence is worse than one that
 * says it is not available, so everything past New and Open is disabled until a deck window is.
 */
type Item = Parameters<typeof ApplicationMenu.setApplicationMenu>[0][number];
const needsDeck = (item: Item): Item => ({ ...item, ...("type" in item && item.type === "separator" ? {} : { enabled: activeId !== undefined }) });

/** the version waiting to be installed, once a check has found one; the menu reads it */
let offered: string | undefined;

function paintMenu(): void {
    const decks = [...windows.entries()].map(([id, { title }]) => ({ label: title, action: "window:activate", data: id, checked: id === activeId }));
    ApplicationMenu.setApplicationMenu([
        /* a role carries no key equivalent of its own here, so the ones everyone reaches for say theirs */
        {
            label: "Ainsi",
            submenu: [
                { role: "about" },
                offered
                    ? { label: `Install Ainsi ${offered}…`, action: "update-install" }
                    : { label: "Check for Updates…", action: "update-check" },
                { type: "separator" },
                { role: "hide", accelerator: "cmd+h" },
                { role: "quit", accelerator: "cmd+q" },
            ],
        },
        {
            label: "File",
            submenu: [
                { label: "New Presentation", action: "new", accelerator: "cmd+n" },
                { label: "Open…", action: "open", accelerator: "cmd+o" },
                { type: "separator" },
                needsDeck({
                    label: "Export",
                    submenu: [
                        { label: "PDF", action: "pdf", accelerator: "cmd+e" },
                        { label: "PDF, compact", action: "pdf:compact" },
                        { label: "PDF, full-resolution images", action: "pdf:full" },
                        { type: "separator" },
                        { label: "PPTX, editable", action: "pptx" },
                        { type: "separator" },
                        { label: "Deck and its files…", action: "zip" },
                    ].map(needsDeck),
                }),
                { type: "separator" },
                /* native performClose on whichever window is frontmost: a deck window or Decks
                   itself, either safe to close now that closing is never the last thing open */
                { role: "close", label: "Close Window", accelerator: "cmd+w" },
            ],
        },
        {
            /*
             * Cut, copy, paste and select all are the studio's rather than the webview's roles: a role
             * acts on a text selection, and most of the time what is selected here is a block or the deck.
             * The studio hands the verb back to the field when a caret is in one.
             */
            label: "Edit",
            submenu: [
                { role: "undo" }, { role: "redo" },
                { type: "separator" },
                needsDeck({ label: "Cut", action: "cut", accelerator: "cmd+x" }),
                needsDeck({ label: "Copy", action: "copy", accelerator: "cmd+c" }),
                needsDeck({ label: "Paste", action: "paste", accelerator: "cmd+v" }),
                needsDeck({ label: "Duplicate", action: "duplicate", accelerator: "cmd+d" }),
                needsDeck({ label: "Delete", action: "delete" }),
                needsDeck({ label: "Select All", action: "select-all", accelerator: "cmd+a" }),
                { type: "separator" },
                needsDeck({ label: "Edit Deck Source", action: "source", accelerator: "shift+cmd+e" }),
                needsDeck({ label: "Edit Page Source", action: "source-page", accelerator: "alt+cmd+e" }),
                needsDeck({ label: "Deck Settings…", action: "settings" }),
                needsDeck({ label: "Theme…", action: "theme" }),
            ],
        },
        {
            /*
             * The kinds the parser has, which is a list that cannot drift. Which components each
             * kind can be shown as lives in the page, where the registry is: a menu built before
             * a deck is open cannot know what a theme's components accept.
             */
            label: "Insert",
            submenu: [
                { label: "Page", action: "insert:Page", accelerator: "cmd+shift+n" },
                { type: "separator" },
                { label: "Text", action: "insert:Text" },
                { label: "Bullets", action: "insert:Bullets" },
                { label: "Numbered", action: "insert:Numbered" },
                { label: "Quote", action: "insert:Quote" },
                { label: "Callout", action: "insert:Callout" },
                { label: "Code", action: "insert:Code" },
                { label: "Table", action: "insert:Table" },
                { label: "Image", action: "insert:Image" },
            ].map(needsDeck),
        },
        {
            label: "View",
            submenu: [
                { label: "Reading", action: "reading" },
                { label: "Grid", action: "grid", accelerator: "cmd+g" },
            ].map(needsDeck),
        },
        {
            /* from here, not from the beginning: the deck is open at a page for a reason */
            label: "Slideshow",
            submenu: [
                { label: "Play", action: "present", accelerator: "cmd+enter" },
                { label: "Play from Start", action: "present-from-start", accelerator: "cmd+shift+enter" },
            ].map(needsDeck),
        },
        {
            /* the deck switcher: no chrome of its own, this list and the tick on the current one is it */
            label: "Window",
            submenu: [
                { role: "minimize" }, { role: "zoom" }, { role: "toggleFullScreen" },
                { type: "separator" },
                { label: "Decks", action: "window:decks", accelerator: "shift+cmd+d" },
                ...(decks.length ? [{ type: "separator" } as const, ...decks] : []),
                { type: "separator" },
                { label: "Cycle Through Decks", action: "window:cycle", accelerator: "cmd+`", enabled: decks.length > 1 },
            ],
        },
    ]);
}

paintMenu();

/*
 * Updates. The channel is baked into the bundle: a dev build reports "updates disabled" and the
 * check costs one no-op, so this is quiet under `bun run app` and live only in something that
 * was installed. What it finds is the page's to show, because the page is the only surface with
 * room to say it, and the shell's own menu item is the second door to the same install.
 *
 * The offer is re-announced on every window's dom-ready: the studio reloads a page on every
 * commit, and a badge that vanished on the first edit would be a badge nobody trusts. It goes to
 * every open window, because any of them could be showing it.
 */
const announce = (error?: string) => {
    const js = `document.dispatchEvent(new CustomEvent("ainsi:update",{detail:${JSON.stringify({ version: offered ?? null, error })}}))`;
    decksWin?.webview.executeJavascript(js);
    for (const { win } of windows.values()) win.webview.executeJavascript(js);
};

/*
 * Loud when someone asked, from the version on the landing or from the menu: a check that says
 * nothing when there is nothing looks like a check that did not run. The launch check is quiet,
 * because news of no news at launch is noise.
 */
async function checkUpdate(loud = false): Promise<void> {
    const found = await Updater.checkForUpdate().catch(() => undefined);
    offered = found?.updateAvailable ? found.version : undefined;
    paintMenu();
    // offline is not up to date, and saying so is the difference between a check and a shrug
    const error = found ? found.error || undefined : "the release could not be reached";
    if (offered || loud) announce(error);
}

/*
 * What the badge and the menu item both run: ask, fetch it, then restart into it.
 *
 * The dialog is where the plugin gets named. A version that changes the deck grammar changes
 * what the agent should be writing, and the agent learns that from the Claude Code plugin, not
 * from this bundle; updating one and not the other is how a deck ends up written against a
 * grammar the binary does not have. The moment someone is deciding to update is the only moment
 * that sentence gets read.
 */
async function install(): Promise<void> {
    if (!offered) return;
    const { response } = await Utils.showMessageBox({
        type: "question",
        title: "Install Ainsi",
        message: `Install Ainsi ${offered} and restart?`,
        detail: "Update the Claude Code plugin too, so the agent writes the grammar this version"
            + " renders:\n\n    claude plugin marketplace update ainsi",
        buttons: ["Install and Restart", "Not Now"],
        defaultId: 0,
        cancelId: 1,
    }).catch(() => ({ response: 0 }));   // no dialog is no reason to refuse an update someone asked for
    if (response !== 0) return;
    try {
        await Updater.downloadUpdate();
        await Updater.applyUpdate();   // restarts into the new version; nothing runs after it
    } catch (error) {
        console.error(`update failed: ${String(error)}`);
    }
}

void checkUpdate();

/*
 * The other half of the studio's own Open door: a park-and-wait on the server's one shared
 * `/__shell`, same as before, except there is only ever one of these loops now, for the one
 * server, rather than one per deck.
 */
async function attend(): Promise<void> {
    for (;;) {
        const asked = await fetch(`${server.url}/__shell`)
            .then(r => (r.status === 204 ? { what: "" } : r.json() as Promise<{ what: string }>))
            .catch(() => undefined);
        if (!asked) return; // the shared server is gone; nothing left to ask
        if (asked.what === "open") void openDialog();
        // the page's own Open and New land here: the server has already opened the deck and is
        // asking for a window on it. Answering without acting is worse than refusing, because
        // the page only falls back to navigating in place when this call fails.
        if (asked.what.startsWith("window ")) void openAsked(asked.what.slice(7));
        if (asked.what === "update") void install();
        if (asked.what === "update-check") void checkUpdate(true);
    }
}
void attend();

/*
 * The launch deck, if there is one, opened the same way a File > Open pick would be: a request
 * against the one server. A missing or already-open deck answers with what it already has, per
 * the server's own contract, so this never risks a second window on the same id.
 */
if (process.env.AINSI_DECK) await openPath(process.env.AINSI_DECK);
else openDecks();

ApplicationMenu.on("application-menu-clicked", event => {
    const clicked = (event as { data?: { action?: string; data?: unknown } }).data;
    const action = clicked?.action;
    if (!action) return;
    if (action === "open") void openDialog();
    else if (action === "update-check") void checkUpdate(true);
    else if (action === "update-install") void install();
    else if (action === "window:decks") openDecks().activate();
    else if (action === "window:cycle") cycle();
    else if (action === "window:activate") windows.get(String(clicked.data))?.win.activate();
    else command(action);
});

// the app lives on with no windows; only Quit and a kill signal take the shared server down with it
app.on("reopen", () => openDecks());
app.on("before-quit", () => server.stop());
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.stop(); Utils.quit(0); });
