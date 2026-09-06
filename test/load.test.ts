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
        ["agenda", "alert", "aside", "boxes", "columns", "comparison", "figures", "full", "lead", "matrix", "prose", "timeline"],
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
    expect(registry.names().length).toBe(13);
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
    const { html } = build("# T\n\n<!-- pac: timeline -->\n- Q1: a\n- Q2: b\n", { registry, layouts, themeCss: "" });
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
    const md = "# Yksi\n\n<!-- pac: timeline -->\n- Q1: a\n- Q2: b\n\n---\n\n# Kaksi\n\n<!-- pac: timeline -->\n- Q3: c\n- Q4: d\n\n---\n\n# Kolme\n\n<!-- pac: timeline -->\n- Q5: e\n- Q6: f\n";
    const { html, pages } = build(md, { registry, layouts, themeCss: "" });

    expect(pages.flatMap(p => p.blocks).filter(b => b.component === "timeline").length).toBe(3);
    expect(html.match(/\.pac-timeline__label \{/g)?.length).toBe(1);   // the stylesheet, inlined once
    expect(html.match(/data-pac=.timeline./g)!.length).toBe(3);
});

test("the one script mounts once per instance", async () => {
    const registry = await load([BUILTIN, FIXTURES]);
    const script = registry.get("callout")!.script!;
    // one generated entry, looping every root; the component itself never touches document
    expect(script.match(/document\.querySelectorAll/g)?.length).toBe(1);
    expect(script).toContain(`[data-pac="callout"]`);
});

test("a label is a leading bold run and nothing else is read as structure", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- pac: timeline -->\n- **Q1** [a](https://x.test) thing\n- Q2: colon stays\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<span class="pac-timeline__label">Q1</span>');
    expect(html).toContain('<span class="pac-timeline__body"><a href="https://x.test">a</a> thing</span>');
    expect(html).toContain('<span class="pac-timeline__label"></span>');
    expect(html).toContain('<span class="pac-timeline__body">Q2: colon stays</span>');
});

test("prose adds a wrapper only for a size, and the size is a scale step, not a heading", async () => {
    const registry = await load([BUILTIN]);
    const plain = build("# T\n\nwords\n", { registry, layouts, themeCss: "" }).html;
    expect(plain).not.toContain('class="pac-prose');
    const sized = build("# T\n\n<!-- pac: prose size=huge -->\nwords\n", { registry, layouts, themeCss: "" }).html;
    expect(sized).toContain('<div class="pac-prose pac-prose--huge">');
    expect(sized).toContain("<p>words</p>");
    expect(sized.match(/<h[1-6]/g)!.length).toBe(1);   // the deck's own h1: the sized text is still a p
});

test("boxes over a numbered list is an ol, so the numbers survive", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- pac: boxes -->\n1. one\n2. two\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<ol class="pac-boxes pac-boxes--ordered"');
    const plain = build("# T\n\n<!-- pac: boxes -->\n- one\n- two\n", { registry, layouts, themeCss: "" }).html;
    expect(plain).toContain('<ul class="pac-boxes"');
});

test("timeline over a numbered list carries the numbers on its markers", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- pac: timeline -->\n1. **Plan** a\n2. **Build** b\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<ol class="pac-timeline pac-timeline--horizontal pac-timeline--numbered"');
    expect(build("# T\n\n<!-- pac: timeline -->\n- Q1: a\n- Q2: b\n", { registry, layouts, themeCss: "" }).html).toContain('<ol class="pac-timeline pac-timeline--horizontal"');
});

test("a quote signs itself: a dashed last line inside the blockquote is the attribution, with no component", async () => {
    const registry = await load([BUILTIN]);
    const { html, pages } = build("# T\n\n> said\n>\n> — Who\n\nafter\n", { registry, layouts, themeCss: "" });
    expect(pages[0]!.blocks.map(b => b.component)).toEqual(["prose"]);
    expect(html).toContain('<figure class="pac-quote"><blockquote>');
    expect(html).toContain("<figcaption>Who</figcaption>");
    expect(html).not.toContain("— Who");
    expect(html).toContain("<p>after</p>");
    expect(html.indexOf("</figure>")).toBeLessThan(html.indexOf("<p>after</p>"));
});

test("a GitHub alert is its own block with the marker lifted into a title", async () => {
    const registry = await load([BUILTIN]);
    const md = "# T\n\nbefore\n\n> [!WARNING]\n> Mind the ==gap==, and `keep` it.\n>\n> Second paragraph.\n\nafter\n";
    const { html, pages } = build(md, { registry, layouts, themeCss: "" });
    expect(pages[0]!.blocks.map(b => b.component)).toEqual(["prose", "alert", "prose"]);
    expect(html).toContain('<aside class="pac-alert pac-alert--warning" data-pac="alert" role="note" aria-label="Warning" title="Warning">');
    expect(html).toContain('<span class="pac-alert__tag"><svg');
    expect(html).toContain("<p>Mind the <mark>gap</mark>, and <code>keep</code> it.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
    expect(html).not.toContain("[!WARNING]");
    const plain = build("> just a quote\n", { registry, layouts, themeCss: "" });
    expect(plain.pages[0]!.blocks[0]!.component).toBe("prose");
});

test("==words== is a highlight, in prose and inside a component's own text", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\nsay ==this== and a == b stays\n\n<!-- pac: boxes -->\n- **One** ==hot==\n", { registry, layouts, themeCss: "" });
    expect(html).toContain("say <mark>this</mark> and a == b stays");
    expect(html).toContain('<span class="pac-boxes__body"><mark>hot</mark></span>');
});

test("prose aligns a block without touching its text", async () => {
    const registry = await load([BUILTIN]);
    const html = build("# T\n\n<!-- pac: prose align=center -->\nwords\n\n<!-- pac: prose size=large align=right -->\nmore\n", { registry, layouts, themeCss: "" }).html;
    expect(html).toContain('<div class="pac-prose pac-prose--center">');
    expect(html).toContain('<div class="pac-prose pac-prose--large pac-prose--right">');
});

test("columns is boxes without the chrome: one column per item, a bold run as its title", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- pac: columns -->\n- **Fast** ships in a day\n- plain second\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<ul class="pac-columns" data-pac="columns">');
    expect(html).toContain('<li class="pac-columns__column"><span class="pac-columns__title">Fast</span><span class="pac-columns__body">ships in a day</span></li>');
    expect(html).toContain('<li class="pac-columns__column"><span class="pac-columns__body">plain second</span></li>');
    const numbered = build("# T\n\n<!-- pac: columns -->\n1. one\n2. two\n", { registry, layouts, themeCss: "" }).html;
    expect(numbered).toContain('<ol class="pac-columns pac-columns--ordered" data-pac="columns">');
});

test("figures: the bold run is the figure, any text; the row takes one size from its longest", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- pac: figures -->\n- **5** things\n- **$500 000** a year\n- **200 Mtok/s** peak\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('style="--pac-figures-count: 3; --pac-figures-chars: 10"');
    expect(html).toContain('<span class="pac-figures__value">200 Mtok/s</span>');
    expect(html).toContain('<span class="pac-figures__caption">peak</span>');
});

test("matrix takes exactly four items and names its axes from props", async () => {
    const registry = await load([BUILTIN]);
    const four = build("# T\n\n<!-- pac: matrix x=\"effort\" y=\"impact\" -->\n- **A** a\n- **B** b\n- **C** c\n- **D** d\n", { registry, layouts, themeCss: "" });
    expect(four.pages[0]!.blocks[1]!.component).toBe("matrix");
    expect(four.html).toContain('<span class="pac-matrix__x">effort</span>');
    const three = build("# T\n\n<!-- pac: matrix -->\n- a\n- b\n- c\n", { registry, layouts, themeCss: "" });
    expect(three.pages[0]!.blocks.every(b => b.component === "prose")).toBe(true);
    expect(three.diagnostics.some(d => d.message.includes("does not accept"))).toBe(true);
});

test("agenda numbers its rows with two digits", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- pac: agenda -->\n1. **Open** where we are\n2. **Plan** where next\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<ol class="pac-agenda"');
    expect(html).toContain('<span class="pac-agenda__number">01</span>');
    expect(html).toContain('<span class="pac-agenda__title">Open</span>');
    const bulleted = build("# T\n\n<!-- pac: agenda -->\n- **Open** where we are\n", { registry, layouts, themeCss: "" }).html;
    expect(bulleted).toContain('<ul class="pac-agenda"');
    expect(bulleted).not.toContain('<span class="pac-agenda__number">');
});

test("prose colours by the theme's ink names only", async () => {
    const registry = await load([BUILTIN]);
    const html = build("# T\n\n<!-- pac: prose color=accent caps -->\nlabel\n", { registry, layouts, themeCss: "" }).html;
    expect(html).toContain('<div class="pac-prose pac-prose--caps pac-prose--accent">');
    const bad = build("# T\n\n<!-- pac: prose color=#ff0000 -->\nwords\n", { registry, layouts, themeCss: "" });
    expect(bad.diagnostics.some(d => d.message.includes("bad props"))).toBe(true);
});
