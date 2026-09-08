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
        ["agenda", "alert", "bar-table", "boxes", "columns", "comparison", "figures", "full", "matrix", "prose", "roadmap", "striped-table", "tiles", "timeline"],
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
    expect(registry.names().length).toBe(15);
});

test("a later root overrides a builtin of the same name", async () => {
    const registry = await load([BUILTIN, FIXTURES]);
    const { html } = build("<!-- ainsi: callout tone=alert -->\n\nvaroitus\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('class="ainsi-callout ainsi-callout--alert"');
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
    expect(script).toContain('[data-ainsi="callout"]');
    expect(script).not.toContain("export");          // bundled to an iife, not a module
    expect(script).not.toContain(": HTMLElement");   // typescript stripped
});

test("only the css and script of components a deck uses are emitted", async () => {
    const registry = await load([BUILTIN, FIXTURES]);
    const { html } = build("# T\n\n<!-- ainsi: timeline -->\n- Q1: a\n- Q2: b\n", { registry, layouts, themeCss: "" });
    expect(html).toContain(".ainsi-timeline__step");
    expect(html).not.toContain(".ainsi-callout");
    expect(html).not.toContain('[data-ainsi="callout"]');
});

test("a directive naming nothing registered warns and renders anyway", async () => {
    const registry = await load([BUILTIN]);
    const { html, diagnostics } = build("<!-- ainsi: nonesuch -->\n\n- a\n- b\n", { registry, layouts, themeCss: "" });
    expect(diagnostics.some(d => d.message.includes("unknown component"))).toBe(true);
    expect(html).toContain("<li");
});

test("a component used many times emits its css and script exactly once", async () => {
    const registry = await load([BUILTIN]);
    const md = "# Yksi\n\n<!-- ainsi: timeline -->\n- Q1: a\n- Q2: b\n\n---\n\n# Kaksi\n\n<!-- ainsi: timeline -->\n- Q3: c\n- Q4: d\n\n---\n\n# Kolme\n\n<!-- ainsi: timeline -->\n- Q5: e\n- Q6: f\n";
    const { html, pages } = build(md, { registry, layouts, themeCss: "" });

    expect(pages.flatMap(p => p.blocks).filter(b => b.component === "timeline").length).toBe(3);
    expect(html.match(/\.ainsi-timeline__label \{/g)?.length).toBe(1);   // the stylesheet, inlined once
    expect(html.match(/data-ainsi=.timeline./g)!.length).toBe(3);
});

test("the one script mounts once per instance", async () => {
    const registry = await load([BUILTIN, FIXTURES]);
    const script = registry.get("callout")!.script!;
    // one generated entry, looping every root; the component itself never touches document
    expect(script.match(/document\.querySelectorAll/g)?.length).toBe(1);
    expect(script).toContain(`[data-ainsi="callout"]`);
});

test("a label is a leading bold run and nothing else is read as structure", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- ainsi: timeline -->\n- **Q1** [a](https://x.test) thing\n- Q2: colon stays\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<span class="ainsi-timeline__label">Q1</span>');
    expect(html).toContain('<span class="ainsi-timeline__body"><a href="https://x.test">a</a> thing</span>');
    expect(html).toContain('<span class="ainsi-timeline__label"></span>');
    expect(html).toContain('<span class="ainsi-timeline__body">Q2: colon stays</span>');
});

test("prose adds a wrapper only for a size, and the size is a scale step, not a heading", async () => {
    const registry = await load([BUILTIN]);
    const plain = build("# T\n\nwords\n", { registry, layouts, themeCss: "" }).html;
    expect(plain).not.toContain('class="ainsi-prose');
    const sized = build("# T\n\n<!-- ainsi: prose size=huge -->\nwords\n", { registry, layouts, themeCss: "" }).html;
    expect(sized).toContain('<div class="ainsi-prose ainsi-prose--huge">');
    expect(sized).toContain("<p>words</p>");
    expect(sized.match(/<h[1-6]/g)!.length).toBe(1);   // the deck's own h1: the sized text is still a p
});

test("boxes over a numbered list is an ol, so the numbers survive", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- ainsi: boxes -->\n1. one\n2. two\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<ol class="ainsi-boxes ainsi-boxes--ordered"');
    const plain = build("# T\n\n<!-- ainsi: boxes -->\n- one\n- two\n", { registry, layouts, themeCss: "" }).html;
    expect(plain).toContain('<ul class="ainsi-boxes"');
});

test("timeline over a numbered list carries the numbers on its markers", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- ainsi: timeline -->\n1. **Plan** a\n2. **Build** b\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<ol class="ainsi-timeline ainsi-timeline--horizontal ainsi-timeline--numbered"');
    expect(build("# T\n\n<!-- ainsi: timeline -->\n- Q1: a\n- Q2: b\n", { registry, layouts, themeCss: "" }).html).toContain('<ol class="ainsi-timeline ainsi-timeline--horizontal"');
});

test("a quote signs itself: a dashed last line inside the blockquote is the attribution, with no component", async () => {
    const registry = await load([BUILTIN]);
    const { html, pages } = build("# T\n\n> said\n>\n> — Who\n\nafter\n", { registry, layouts, themeCss: "" });
    expect(pages[0]!.blocks.map(b => b.component)).toEqual(["prose"]);
    expect(html).toContain('<figure class="ainsi-quote"><blockquote>');
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
    expect(html).toContain('<aside class="ainsi-alert ainsi-alert--warning" data-ainsi="alert" role="note" aria-label="Warning" title="Warning">');
    expect(html).toContain('<span class="ainsi-alert__tag"><svg');
    expect(html).toContain("<p>Mind the <mark>gap</mark>, and <code>keep</code> it.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
    expect(html).not.toContain("[!WARNING]");
    const plain = build("> just a quote\n", { registry, layouts, themeCss: "" });
    expect(plain.pages[0]!.blocks[0]!.component).toBe("prose");
});

test("==words== is a highlight, in prose and inside a component's own text", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\nsay ==this== and a == b stays\n\n<!-- ainsi: boxes -->\n- **One** ==hot==\n", { registry, layouts, themeCss: "" });
    expect(html).toContain("say <mark>this</mark> and a == b stays");
    expect(html).toContain('<span class="ainsi-boxes__body"><mark>hot</mark></span>');
});

test("prose aligns a block without touching its text", async () => {
    const registry = await load([BUILTIN]);
    const html = build("# T\n\n<!-- ainsi: prose align=center -->\nwords\n\n<!-- ainsi: prose size=large align=right -->\nmore\n", { registry, layouts, themeCss: "" }).html;
    expect(html).toContain('<div class="ainsi-prose ainsi-prose--center">');
    expect(html).toContain('<div class="ainsi-prose ainsi-prose--large ainsi-prose--right">');
});

test("columns is boxes without the chrome: one column per item, a bold run as its title", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- ainsi: columns -->\n- **Fast** ships in a day\n- plain second\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<ul class="ainsi-columns" data-ainsi="columns">');
    expect(html).toContain('<li class="ainsi-columns__column"><span class="ainsi-columns__title">Fast</span><span class="ainsi-columns__body">ships in a day</span></li>');
    expect(html).toContain('<li class="ainsi-columns__column"><span class="ainsi-columns__body">plain second</span></li>');
    const wrapped = build("# T\n\n<!-- ainsi: columns -->\n- **Fast**\n  ships in a day\n", { registry, layouts, themeCss: "" }).html;
    expect(wrapped).toContain('<span class="ainsi-columns__title">Fast</span><span class="ainsi-columns__body">ships in a day</span>');
    const numbered = build("# T\n\n<!-- ainsi: columns -->\n1. one\n2. two\n", { registry, layouts, themeCss: "" }).html;
    expect(numbered).toContain('<ol class="ainsi-columns ainsi-columns--ordered" data-ainsi="columns">');
});

test("figures: the bold run is the figure, any text; the row takes one size from its longest", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- ainsi: figures -->\n- **5** things\n- **$500 000** a year\n- **200 Mtok/s** peak\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('style="--ainsi-figures-count: 3; --ainsi-figures-chars: 10"');
    expect(html).toContain('<span class="ainsi-figures__value">200 Mtok/s</span>');
    expect(html).toContain('<span class="ainsi-figures__caption">peak</span>');
});

test("matrix takes exactly four items and names its axes from props", async () => {
    const registry = await load([BUILTIN]);
    const four = build("# T\n\n<!-- ainsi: matrix x=\"effort\" y=\"impact\" -->\n- **A** a\n- **B** b\n- **C** c\n- **D** d\n", { registry, layouts, themeCss: "" });
    expect(four.pages[0]!.blocks[1]!.component).toBe("matrix");
    expect(four.html).toContain('<span class="ainsi-matrix__x">effort</span>');
    const three = build("# T\n\n<!-- ainsi: matrix -->\n- a\n- b\n- c\n", { registry, layouts, themeCss: "" });
    expect(three.pages[0]!.blocks.every(b => b.component === "prose")).toBe(true);
    expect(three.diagnostics.some(d => d.message.includes("does not accept"))).toBe(true);
});

test("agenda numbers its rows with two digits", async () => {
    const registry = await load([BUILTIN]);
    const { html } = build("# T\n\n<!-- ainsi: agenda -->\n1. **Open** where we are\n2. **Plan** where next\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<ol class="ainsi-agenda"');
    expect(html).toContain('<span class="ainsi-agenda__number">01</span>');
    expect(html).toContain('<span class="ainsi-agenda__title">Open</span>');
    const bulleted = build("# T\n\n<!-- ainsi: agenda -->\n- **Open** where we are\n", { registry, layouts, themeCss: "" }).html;
    expect(bulleted).toContain('<ul class="ainsi-agenda"');
    expect(bulleted).not.toContain('<span class="ainsi-agenda__number">');
});

test("prose colours by the theme's ink names only", async () => {
    const registry = await load([BUILTIN]);
    const html = build("# T\n\n<!-- ainsi: prose color=accent caps -->\nlabel\n", { registry, layouts, themeCss: "" }).html;
    expect(html).toContain('<div class="ainsi-prose ainsi-prose--caps ainsi-prose--accent">');
    const bad = build("# T\n\n<!-- ainsi: prose color=#ff0000 -->\nwords\n", { registry, layouts, themeCss: "" });
    expect(bad.diagnostics.some(d => d.message.includes("bad props"))).toBe(true);
});
