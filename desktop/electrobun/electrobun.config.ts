import { resolve } from "node:path";
import type { ElectrobunConfig } from "electrobun";

/*
 * Only the fallback for `bun run app`, where the shell has no Contents/Resources/app/ainsi next
 * to it the way an installed app does (the `copy` below puts it there). An installed app's own
 * copy is found at runtime by src/bun/index.ts instead: a path baked in here is a path on the
 * build machine, which the machine that installs the app does not have.
 */
const repo = resolve(import.meta.dir, "..", "..");

export default {
    app: {
        // the wordmark is lower case; the name of the thing is not, and this is the name the
        // menu bar and the bundle are called by
        name: "Ainsi",
        identifier: "dev.ainsi.studio",
        version: "2.0.0-beta.4",
    },
    /*
     * Where an installed app looks for its next version. `app:build --env=stable` writes
     * `stable-macos-arm64-update.json` and the `.app.tar.zst` beside it into artifacts/; a
     * release carrying those two under this url is what the updater reads and patches from.
     * `/releases/latest/download/` always resolves to the newest release's assets.
     */
    release: {
        baseUrl: "https://github.com/mikkokam/ainsi/releases/latest/download",
    },
    /*
     * A Mac app lives on with no windows open; closing the last deck and the Decks window
     * behind it is not quitting, and the Dock icon is what brings Decks back.
     */
    runtime: {
        exitOnLastWindowClosed: false,
    },
    build: {
        // the shell spawns bun, reads its stdout and holds the child; real Bun, not a
        // lookalike, because that is what the studio it starts is written against
        mainProcess: "bun",
        bun: {
            entrypoint: "src/bun/index.ts",
            define: {
                "process.env.AINSI_REPO": JSON.stringify(repo),
            },
        },
        /*
         * The checkout the shell spawns, so an installed app carries its own rather than
         * reaching for the build machine's. `copy` is what makes this part of the packaged
         * application itself rather than a folder dropped on top of one afterwards: only that
         * makes it survive the self-extraction a stable build does on first launch.
         */
        copy: {
            "../../src": "ainsi/src",
            "../../themes": "ainsi/themes",
            "../../samples": "ainsi/samples",
            "../../package.json": "ainsi/package.json",
            "../../bun.lock": "ainsi/bun.lock",
            "../../node_modules": "ainsi/node_modules",
        },
        mac: { bundleCEF: false },
        linux: { bundleCEF: false },
        win: { bundleCEF: false },
    },
} satisfies ElectrobunConfig;
