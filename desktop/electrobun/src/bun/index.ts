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

ApplicationMenu.setApplicationMenu([
    { label: "ainsi", submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "quit" }] },
    { label: "File", submenu: [{ label: "Open…", action: "open", accelerator: "cmd+o" }] },
    {
        label: "Edit",
        submenu: [
            { role: "undo" }, { role: "redo" }, { type: "separator" },
            { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
        ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "toggleFullScreen" }] },
]);
ApplicationMenu.on("application-menu-clicked", event => {
    if ((event as { data?: { action?: string } }).data?.action === "open") void open();
});

// the studio outlives its window otherwise: it is a bun process holding a port
const stop = () => { current.stop(); Utils.quit(0); };
window.on("close", stop);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);
