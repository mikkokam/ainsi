import { resolve } from "node:path";
import { which } from "bun";
import type { ElectrobunConfig } from "electrobun";

/*
 * The checkout this shell runs is baked in at build time. A dev-only shell has exactly one
 * ainsi to start, and finding it from inside an .app bundle would mean walking out of
 * Contents/Resources to a path that only holds while the build stays where it was made.
 */
const repo = resolve(import.meta.dir, "..", "..");
/* An app launched from Finder gets the login environment, which on a mac has no homebrew in
 * it, so a bare `bun` in the shell's spawn resolves to nothing. */
const bun = which("bun") ?? "bun";

export default {
    app: {
        // the wordmark is lower case; the name of the thing is not, and this is the name the
        // menu bar and the bundle are called by
        name: "Ainsi",
        identifier: "dev.ainsi.studio",
        version: "2.0.0-beta.1",
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
    build: {
        // the shell spawns bun, reads its stdout and holds the child; real Bun, not a
        // lookalike, because that is what the studio it starts is written against
        mainProcess: "bun",
        bun: {
            entrypoint: "src/bun/index.ts",
            define: {
                "process.env.AINSI_REPO": JSON.stringify(repo),
                "process.env.AINSI_BUN": JSON.stringify(bun),
            },
        },
        mac: { bundleCEF: false },
        linux: { bundleCEF: false },
        win: { bundleCEF: false },
    },
} satisfies ElectrobunConfig;
