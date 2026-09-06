import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadTheme } from "../src/load";

const defaults = await load([BUILTIN]);
const layouts = await loadLayouts([LAYOUTS]);
import { TOKENS } from "../src/tokens";
import { BASE_CSS } from "../src/base";
import { build } from "../src/build";

const ENGINE_VARS = ["--pac-ratio", "--pac-step"];

test("a component references only theme tokens and its own namespaced variables", () => {
    const offences: string[] = [];
    for (const c of defaults.all()) {
        for (const [, name] of (c.css ?? "").matchAll(/var\((--[a-z0-9-]+)/g)) {
            const own = name!.startsWith(`--pac-${c.name}-`);
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
            if (!name!.startsWith(`--pac-${c.name}-`)) offences.push(`${c.name}: ${name}`);
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
        expect(css.indexOf("--pac-info:")).toBeGreaterThanOrEqual(0);           // inherited
        expect(css.indexOf("--pac-accent:")).toBeLessThan(css.lastIndexOf("--pac-accent:"));   // the theme's own comes after and wins
    }
});

test("a theme swap changes no markup", () => {
    const md = "# Otsikko\n\njohdanto\n\n---\n\n# Vaiheet\n\n- Q1: a\n- Q2: b\n";
    const body = (theme: string) => build(md, { registry: defaults, layouts, themeCss: theme }).html.split("</style>")[1];
    expect(body("/* a */")).toBe(body("/* b */"));
});

test("only the css of components actually used is emitted", () => {
    const { html } = build("# T\n\n<!-- pac: boxes -->\n- a\n", { registry: defaults, layouts, themeCss: "" });
    expect(html).toContain(".pac-boxes__box");
    expect(html).not.toContain(".pac-timeline__step");
});
