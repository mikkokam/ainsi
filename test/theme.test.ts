import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadTheme } from "../src/load";

const defaults = await load([BUILTIN]);
const layouts = await loadLayouts([LAYOUTS]);
import { TOKENS } from "../src/tokens";
import { BASE_CSS } from "../src/base";
import { build } from "../src/build";

const ENGINE_VARS = ["--ainsi-ratio", "--ainsi-step"];

test("a component references only theme tokens and its own namespaced variables", () => {
    const offences: string[] = [];
    for (const c of defaults.all()) {
        for (const [, name] of (c.css ?? "").matchAll(/var\((--[a-z0-9-]+)/g)) {
            const own = name!.startsWith(`--ainsi-${c.name}-`);
            if (!own && !TOKENS.includes(name as any) && !ENGINE_VARS.includes(name!)) {
                offences.push(`${c.name}: ${name}`);
            }
        }
    }
    expect(offences).toEqual([]);
});

test("a component declares only its own namespaced variables", () => {
    const offences: string[] = [];
    for (const c of defaults.all()) {
        for (const [, name] of (c.css ?? "").matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) {
            if (!name!.startsWith(`--ainsi-${c.name}-`)) offences.push(`${c.name}: ${name}`);
        }
    }
    expect(offences).toEqual([]);
});

test("a component hard-codes no colour", () => {
    const offences = defaults.all()
        .filter(c => /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(c.css ?? ""))
        .map(c => c.name);
    expect(offences).toEqual([]);
});

test("every token the engine, components and layouts use is declared by the default theme, which every theme layers on", async () => {
    const used = new Set<string>();
    for (const css of [BASE_CSS, ...defaults.all().map(c => c.css ?? ""), ...layouts.all().map(l => l.css ?? "")]) {
        for (const [, name] of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
            if (TOKENS.includes(name as any)) used.add(name!);
        }
    }
    const dir = `${import.meta.dir}/../themes`;
    const base = await Bun.file(`${dir}/default/variables.css`).text();
    expect([...used].filter(t => !base.includes(`${t}:`))).toEqual([]);
    for (const theme of (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory() && e.name !== "default")) {
        const { css } = await loadTheme(`${dir}/${theme.name}`);
        expect(css.indexOf("--ainsi-info:")).toBeGreaterThanOrEqual(0);           // inherited
        expect(css.indexOf("--ainsi-accent:")).toBeLessThan(css.lastIndexOf("--ainsi-accent:"));   // the theme's own comes after and wins
    }
});

test("a theme's @import comes before every rule in the style block, where a browser honours it", () => {
    const theme = ':root { --ainsi-ink: #000; }\n@import url("https://fonts.example/x.css");';
    const { html } = build("# T\n", { registry: defaults, layouts, themeCss: theme });
    const style = html.slice(html.indexOf("<style>") + 7);
    expect(style.trimStart().startsWith("@import")).toBe(true);
    expect(style.match(/@import/g)).toHaveLength(1);
});

test("a theme's styles come after the engine's element defaults, so a same-specificity rule wins", () => {
    const { html } = build("# T\n", { registry: defaults, layouts, themeCss: ".ainsi-page h1 { letter-spacing: .03em; }" });
    expect(html.indexOf("letter-spacing: .03em")).toBeGreaterThan(html.indexOf(".ainsi-page h1 { font-size"));
});

test("a theme swap changes no markup", () => {
    const md = "# Otsikko\n\njohdanto\n\n---\n\n# Vaiheet\n\n- Q1: a\n- Q2: b\n";
    const body = (theme: string) => build(md, { registry: defaults, layouts, themeCss: theme }).html.split("</style>")[1];
    expect(body("/* a */")).toBe(body("/* b */"));
});

test("only the css of components actually used is emitted", () => {
    const { html } = build("# T\n\n<!-- ainsi: boxes -->\n- a\n", { registry: defaults, layouts, themeCss: "" });
    expect(html).toContain(".ainsi-boxes__box");
    expect(html).not.toContain(".ainsi-timeline__step");
});
