import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { BUILTIN, LAYOUTS, load, loadLayouts } from "../src/load";
import { build } from "../src/build";
import type { Diagnostic } from "../src/types";

const FIXTURES = resolve(import.meta.dir, "fixtures/components");
const BAD = resolve(import.meta.dir, "fixtures/bad");
const layouts = await loadLayouts([LAYOUTS]);

test("components are discovered by scanning folders, not by a barrel file", async () => {
    const registry = await load([BUILTIN]);
    expect(registry.names().sort()).toEqual(
        ["aside", "boxes", "comparison", "full", "lead", "prose", "quote", "raw", "table", "timeline"],
    );
});

test("a component's name is its folder name and is stated nowhere else", async () => {
    const registry = await load([BUILTIN]);
    const source = await Bun.file(resolve(BUILTIN, "timeline/index.ts")).text();
    expect(registry.get("timeline")).toBeDefined();
    expect(source).not.toContain('name:');
});

test("a third-party root registers alongside the builtins", async () => {
    const registry = await load([BUILTIN, FIXTURES]);
    expect(registry.get("callout")).toBeDefined();
    expect(registry.names().length).toBe(11);
});

test("a later root overrides a builtin of the same name", async () => {
    const registry = await load([BUILTIN, FIXTURES]);
    const { html } = build("<!-- pac: callout tone=alert -->\n\nvaroitus\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('class="pac-callout pac-callout--alert"');
});

test("style.css that escapes its own class is reported", async () => {
    const diagnostics: Diagnostic[] = [];
    await load([BAD], diagnostics);
    expect(diagnostics.some(d => d.message.includes("escapes its scope") && d.message.includes("h1"))).toBe(true);
});

test("a component may react to ambient state without escaping its scope", async () => {
    const diagnostics: Diagnostic[] = [];
    const registry = await load([FIXTURES], diagnostics);
    expect(registry.get("callout")!.css).toContain("body[data-present]");
    expect(diagnostics).toEqual([]);
});

test("script.ts is bundled and scoped to its own component's roots", async () => {
    const registry = await load([BUILTIN, FIXTURES]);
    const script = registry.get("callout")!.script!;
    expect(script).toContain('[data-pac="callout"]');
    expect(script).not.toContain("export");          // bundled to an iife, not a module
    expect(script).not.toContain(": HTMLElement");   // typescript stripped
});

test("only the css and script of components a deck uses are emitted", async () => {
    const registry = await load([BUILTIN, FIXTURES]);
    const { html } = build("# T\n\n- Q1: a\n- Q2: b\n", { registry, layouts, themeCss: "" });
    expect(html).toContain(".pac-timeline__step");
    expect(html).not.toContain(".pac-callout");
    expect(html).not.toContain('[data-pac="callout"]');
});

test("a directive naming nothing registered warns and renders anyway", async () => {
    const registry = await load([BUILTIN]);
    const { html, diagnostics } = build("<!-- pac: nonesuch -->\n\n- a\n- b\n", { registry, layouts, themeCss: "" });
    expect(diagnostics.some(d => d.message.includes("unknown component"))).toBe(true);
    expect(html).toContain("<li");
});

test("a component used many times emits its css and script exactly once", async () => {
    const registry = await load([BUILTIN]);
    const md = "# Yksi\n\n- Q1: a\n- Q2: b\n\n# Kaksi\n\n- Q3: c\n- Q4: d\n\n# Kolme\n\n- Q5: e\n- Q6: f\n";
    const { html, pages } = build(md, { registry, layouts, themeCss: "" });

    expect(pages.flatMap(p => p.blocks).filter(b => b.component === "timeline").length).toBe(3);
    expect(html.match(/--pac-timeline-marker:/g)?.length).toBe(1);   // the stylesheet, inlined once
    expect(html.match(/data-pac=.timeline./g)!.length).toBe(3);
});

test("the one script mounts once per instance", async () => {
    const registry = await load([BUILTIN, FIXTURES]);
    const script = registry.get("callout")!.script!;
    // one generated entry, looping every root; the component itself never touches document
    expect(script.match(/document\.querySelectorAll/g)?.length).toBe(1);
    expect(script).toContain(`[data-pac="callout"]`);
});
