import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadTheme } from "../src/load";
import { build } from "../src/build";
import { parse } from "../src/parse";

const registry = await load([BUILTIN]);
const source = await Bun.file(resolve(import.meta.dir, "../samples/acme.md")).text();
const settings = parse(source).doc.settings;
const theme = await loadTheme(resolve(import.meta.dir, "../themes", settings.theme));
const layouts = await loadLayouts([LAYOUTS, theme.layouts]);
const result = build(source, { registry, layouts, themeCss: theme.css });

test("the deck declares its mark and nothing the defaults already say, and its theme exists", async () => {
    expect(source.startsWith("---\n")).toBe(true);
    const frontmatter = source.slice(0, source.indexOf("\n---", 3));
    expect(frontmatter).toContain("logo:");
    for (const key of ["theme:", "ratio:", "layout:"]) expect(frontmatter).not.toContain(key);
    const variables = resolve(import.meta.dir, "../themes", settings.theme, "variables.css");
    expect(await Bun.file(variables).exists()).toBe(true);
});

test("the example deck builds clean", () => {
    expect(result.diagnostics).toEqual([]);
});

test("the example deck exercises the whole vocabulary bar the escape hatch", () => {
    const used = new Set(result.pages.flatMap(p => p.blocks.map(b => b.component)));
    const missing = registry.names().filter(n => !used.has(n));
    expect(missing).toEqual([]);
});

test("the example deck exercises every layout", () => {
    const used = new Set(result.pages.map(p => p.layout));
    expect([...used].sort()).toEqual(layouts.names().sort());
});

test("both heuristic and directive choices appear", () => {
    const origins = new Set(result.pages.flatMap(p => p.blocks.map(b => b.origin)));
    expect([...origins].sort()).toEqual(["directive", "heuristic"]);
});

test("the deck carries no styling of its own", () => {
    expect(source).not.toMatch(/style=|<div|class=|#[0-9a-f]{6}/i);
});
