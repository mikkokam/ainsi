import { expect, test } from "bun:test";
import { resolve } from "node:path";

/**
 * One version, three files. A plugin claiming a version the tool does not have sends an agent
 * a grammar the binary cannot render, and an app bundle claiming one is worse, because it is
 * on someone else's machine by then. The fourth place is the git tag, which no test can see.
 */

const root = resolve(import.meta.dir, "..");
const json = (path: string) => Bun.file(resolve(root, path)).json();

test("the tool, the plugin and the app bundle all claim the same version", async () => {
    const tool = (await json("package.json")).version;
    const plugin = (await json(".claude-plugin/plugin.json")).version;
    // regex rather than an import: the config imports electrobun's types, which resolve only
    // inside the devkit hutch projects into that folder
    const config = await Bun.file(resolve(root, "desktop/electrobun/electrobun.config.ts")).text();
    const app = /version:\s*"([^"]+)"/.exec(config)?.[1];

    expect(tool).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    expect(plugin).toBe(tool);
    expect(app).toBe(tool);
});
