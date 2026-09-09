import { BrowserWindow, Utils } from "electrobun/main";
import { dirname } from "node:path";
import { studio } from "./studio";

/*
 * The desktop shell: a native window over the studio the CLI already serves.
 *
 * Nothing about the deck is understood here. The shell asks for a file, starts the studio
 * beside it and points a webview at it, so every feature the studio grows arrives in the app
 * without a line changing on this side.
 */

/** the checkout and the bun that runs it, both baked in by electrobun.config.ts */
const repo = process.env.AINSI_REPO!;
const bun = process.env.AINSI_BUN!;

// AINSI_DECK skips the dialog: how the shell is tested, and how a deck opens from a terminal.
// An environment variable rather than an argument because the app bundle's launcher forwards
// the environment and swallows argv.
const given = process.env.AINSI_DECK;

const chosen = given ? [given] : await Utils.openFileDialog({
    startingFolder: process.env.HOME ?? "~/",
    allowedFileTypes: "md",
    canChooseFiles: true,
    // a folder opens the studio's own chooser under it, which is where New deck lives
    canChooseDirectory: true,
    allowsMultipleSelection: false,
});

const picked = chosen[0];
if (!picked) {
    // no file, nothing to show: a window on the chooser would need a root, and the person
    // just said they did not want one
    Utils.quit(0);
    throw new Error("unreachable");
}

const deck = picked.endsWith(".md") ? picked : undefined;
const started = await studio({ repo, bun, deck, root: deck ? dirname(picked) : picked });

const window = new BrowserWindow({
    title: deck ? deck.split("/").pop()! : "ainsi",
    url: started.url,
    frame: { width: 1440, height: 900, x: 80, y: 60 },
    titleBarStyle: "hiddenInset",
});

// the studio outlives its window otherwise: it is a detached bun process holding a port
const stop = () => { started.stop(); Utils.quit(0); };
window.on("close", stop);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);
