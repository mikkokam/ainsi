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
        name: "ainsi",
        identifier: "dev.ainsi.studio",
        version: "1.3.0",
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
