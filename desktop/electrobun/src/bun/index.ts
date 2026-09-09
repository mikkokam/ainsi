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

const window = new BrowserWindow({
    title: "ainsi",
    url: current.url,
    frame: { width: 1440, height: 900, x: 80, y: 60 },
});

/*
 * Opening moves the root, and the root is fixed when the studio starts, so this restarts it.
 * A second server on the old root would be a second writer over the same files; a restart
 * costs about a second and there is nothing to carry across, because the studio holds no
 * document state.
 */
async function open(): Promise<void> {
    const chosen = await Utils.openFileDialog({
        startingFolder: root,
        allowedFileTypes: "md",
        canChooseFiles: true,
        // a folder opens the chooser under it, which is where New presentation lives
        canChooseDirectory: true,
        allowsMultipleSelection: false,
    });
    const picked = chosen[0];
    if (!picked) return;

    const deck = picked.endsWith(".md") ? picked : undefined;
    const next = await studio({ repo, bun, deck, root: deck ? dirname(picked) : picked });
    current.stop();
    current = next;
    window.webview.loadURL(next.url);
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

ApplicationMenu.setApplicationMenu([
    { label: "ainsi", submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "quit" }] },
    {
        label: "File",
        submenu: [
            { label: "New Presentation", action: "new", accelerator: "cmd+n" },
            { label: "Open…", action: "open", accelerator: "cmd+o" },
            { type: "separator" },
            {
                label: "Export",
                submenu: [
                    { label: "PDF", action: "pdf", accelerator: "cmd+e" },
                    { label: "PDF, compact", action: "pdf:compact" },
                    { label: "PDF, full-resolution images", action: "pdf:full" },
                    { type: "separator" },
                    { label: "PPTX, editable", action: "pptx" },
                    { type: "separator" },
                    { label: "Deck and its files…", action: "zip" },
                ],
            },
            { type: "separator" },
            { role: "close" },
        ],
    },
    {
        /*
         * Cut, copy and paste are the studio's rather than the webview's roles: a role acts on
         * a text selection, and most of the time what is selected here is a block. The studio
         * hands the verb back to the field when a caret is in one.
         */
        label: "Edit",
        submenu: [
            { role: "undo" }, { role: "redo" },
            { type: "separator" },
            { label: "Cut", action: "cut", accelerator: "cmd+x" },
            { label: "Copy", action: "copy", accelerator: "cmd+c" },
            { label: "Paste", action: "paste", accelerator: "cmd+v" },
            { label: "Delete", action: "delete" },
            { role: "selectAll" },
            { type: "separator" },
            { label: "Edit Source", action: "source" },
            { label: "Deck Settings…", action: "settings" },
        ],
    },
    {
        label: "Insert",
        submenu: [{ label: "Block…", action: "insert", accelerator: "cmd+shift+n" }],
    },
    {
        label: "View",
        submenu: [
            { label: "Reading", action: "reading" },
            { label: "Grid", action: "grid", accelerator: "cmd+g" },
        ],
    },
    {
        /* from here, not from the beginning: the deck is open at a page for a reason */
        label: "Slideshow",
        submenu: [
            { label: "Play", action: "present", accelerator: "cmd+enter" },
            { label: "Play from Start", action: "present-from-start", accelerator: "cmd+shift+enter" },
        ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "toggleFullScreen" }] },
]);

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
