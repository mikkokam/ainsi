import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadTheme, themeDir } from "../src/load";
import { build } from "../src/build";
import { parse } from "../src/parse";

const registry = await load([BUILTIN]);

const SAMPLES = ["gatekeeper", "lehto", "kaari", "boring-inc", "aava", "meridian"];

async function sample(name: string) {
    const dir = resolve(import.meta.dir, "../samples", name);
    const source = await Bun.file(resolve(dir, `${name}.md`)).text();
    const settings = parse(source).doc.settings;
    const theme = await loadTheme(themeDir(settings.theme, dir));
    const layouts = await loadLayouts([LAYOUTS, theme.layouts]);
    return { source, settings, dir, result: build(source, { registry, layouts, themeCss: theme.css }) };
}

const decks = Object.fromEntries(await Promise.all(SAMPLES.map(async n => [n, await sample(n)] as const)));
const acme = decks.gatekeeper!;

test("every sample names a theme that exists, and says nothing the defaults already say", async () => {
    for (const [name, deck] of Object.entries(decks)) {
        expect(deck.source.startsWith("---\n")).toBe(true);
        const frontmatter = deck.source.slice(0, deck.source.indexOf("\n---", 3));
        expect(frontmatter).toContain("theme:");
        expect(frontmatter).not.toContain("layout:");
        const variables = resolve(themeDir(deck.settings.theme, deck.dir), "variables.css");
        expect(`${name}: ${await Bun.file(variables).exists()}`).toBe(`${name}: true`);
    }
});

test("every sample builds clean", () => {
    for (const [name, deck] of Object.entries(decks)) {
        expect(`${name}: ${JSON.stringify(deck.result.diagnostics)}`).toBe(`${name}: []`);
    }
});

test("the samples between them exercise the whole vocabulary bar the escape hatch", () => {
    const used = new Set(Object.values(decks).flatMap(d => d.result.pages.flatMap(p => p.blocks.map(b => b.component))));
    expect(registry.names().filter(n => !used.has(n))).toEqual([]);
});

test("both heuristic and directive choices appear", () => {
    const origins = new Set(acme.result.pages.flatMap(p => p.blocks.map(b => b.origin)));
    expect([...origins].sort()).toEqual(["directive", "heuristic"]);
});

test("a deck carries no styling of its own", () => {
    for (const deck of Object.values(decks)) expect(deck.source).not.toMatch(/style=|<div|class=|#[0-9a-f]{6}/i);
});
