import { ApplicationMenu, BrowserWindow, Utils } from "electrobun/main";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { studio, type Studio } from "./studio";

/*
 * The desktop shell: a native window over the studio the CLI already serves.
 *
 * Nothing about the deck is understood here. The shell starts the studio and points a webview
 * at it, so every feature the studio grows arrives in the app without a line changing on this
 * side. Even opening a deck is the studio's own chooser doing it; the File menu is a second
 * door for a deck that lives somewhere the chooser cannot reach.
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

let current: Studio = await studio({ repo, bun, deck: process.env.AINSI_DECK, root });

/*
 * No titlebar of the system's own: the page draws that strip, so the window is one bar rather
 * than a native one with the studio's own under it. The traffic lights stay, drawn over the
 * page's top-left corner, and --ac-lights is the room the chrome leaves them; the offset drops
 * them to the middle of a 44px strip.
 */
const window = new BrowserWindow({
    title: "Ainsi",
    url: current.url,
    frame: { width: 1440, height: 900, x: 80, y: 60 },
    titleBarStyle: "hiddenInset",
    trafficLightOffset: { x: 0, y: 8 },
});

/*
 * Opening moves the root, and the root is fixed when the studio starts, so this restarts it.
 * A second server on the old root would be a second writer over the same files; a restart
 * costs about a second and there is nothing to carry across, because the studio holds no
 * document state.
 */
async function open(): Promise<boolean> {
    const chosen = await Utils.openFileDialog({
        startingFolder: root,
        allowedFileTypes: "md",
        canChooseFiles: true,
        // a folder opens the chooser under it, which is where New presentation lives
        canChooseDirectory: true,
        allowsMultipleSelection: false,
    });
    const picked = chosen[0];
    if (!picked) return false;

    const deck = picked.endsWith(".md") ? picked : undefined;
    const next = await studio({ repo, bun, deck, root: deck ? dirname(picked) : picked });
    current.stop();
    current = next;
    void follow(next);
    void attend(next);
    window.webview.loadURL(next.url);
    return true;
}

/*
 * Everything but Open is the page's own doing: the shell dispatches the command and the
 * studio runs it with its own progress and its own errors, so a native File menu and the
 * studio's own menu are one implementation and this side never learns an endpoint.
 *
 * There is no Save and no Save As, and adding either would be a lie: an edit is written to
 * the markdown the moment it is committed, so there has never been anything unsaved to keep.
 * The nearest real thing is the filename field in the studio's own chrome, which renames.
 */
const command = (name: string) =>
    window.webview.executeJavascript(`document.dispatchEvent(new CustomEvent("ainsi:command",{detail:${JSON.stringify(name)}}))`);

/*
 * The menu, drawn for the state the studio is in. With no deck open most of it can do nothing,
 * and an item that answers a click with silence is worse than one that says it is not available,
 * so everything past New and Open is disabled until a deck is there.
 */
type Item = Parameters<typeof ApplicationMenu.setApplicationMenu>[0][number];
const needsDeck = (item: Item): Item => ({ ...item, ...("type" in item && item.type === "separator" ? {} : { enabled: hasDeck }) });

let hasDeck = Boolean(process.env.AINSI_DECK);

function paintMenu(): void {
    ApplicationMenu.setApplicationMenu([
        /* a role carries no key equivalent of its own here, so the ones everyone reaches for say theirs */
        { label: "Ainsi", submenu: [{ role: "about" }, { type: "separator" }, { role: "hide", accelerator: "cmd+h" }, { role: "quit", accelerator: "cmd+q" }] },
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
                /* what ⌘W closes is the deck, because the window under it is the app: closing that
                   is quitting, and Quit already says so */
                needsDeck({ label: "Close Deck", action: "close-deck", accelerator: "cmd+w" }),
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
        { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "toggleFullScreen" }] },
    ]);
}

paintMenu();

/*
 * The studio is the one that knows: making, opening and closing a deck all happen in the page,
 * and each ends in a push down the reload stream. Every push is a reason to ask again, which is
 * cheaper than a poll and cannot drift from what the page is showing.
 */
async function follow(studio: Studio): Promise<void> {
    const stream = await fetch(`${studio.url}/__reload`).catch(() => undefined);
    const reader = stream?.body?.getReader();
    if (!reader) return;
    for (;;) {
        const read = await reader.read().catch(() => ({ done: true }));
        if (read.done) return;   // the studio this followed is gone; the next one is followed by open()
        const state = await fetch(`${studio.url}/__state`).then(r => r.json() as Promise<{ deck: string | null }>).catch(() => undefined);
        if (!state || Boolean(state.deck) === hasDeck) continue;
        hasDeck = Boolean(state.deck);
        paintMenu();
    }
}

/*
 * The other half of that: the page's own Open door is this dialog, so a deck is chosen the same
 * way whichever surface asked. The studio holds the request open until someone asks; a request
 * that ends without one, because the studio was replaced, ends the wait with it.
 */
async function attend(studio: Studio): Promise<void> {
    for (;;) {
        const asked = await fetch(`${studio.url}/__shell`)
            .then(r => (r.status === 204 ? { what: "" } : r.json() as Promise<{ what: string }>))
            .catch(() => undefined);
        if (!asked) return;
        // a dialog that was cancelled leaves this studio where it was, so the wait goes back on
        if (asked.what === "open" && await open()) return;
    }
}

void follow(current);
void attend(current);


ApplicationMenu.on("application-menu-clicked", event => {
    const action = (event as { data?: { action?: string } }).data?.action;
    if (!action) return;
    if (action === "open") void open();
    else command(action);
});

// the studio outlives its window otherwise: it is a bun process holding a port
const stop = () => { current.stop(); Utils.quit(0); };
window.on("close", stop);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);
