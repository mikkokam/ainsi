import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadTheme } from "../src/load";
import { build } from "../src/build";
import type { Diagnostic } from "../src/types";

const registry = await load([BUILTIN]);
const layouts = await loadLayouts([LAYOUTS]);
const THEMES = resolve(import.meta.dir, "../themes");

test("layouts are discovered by folder and default is always present", () => {
    expect(layouts.names().sort()).toEqual(["default", "header", "section", "split"]);
    expect(layouts.get("default")).toBeDefined();
});

test("a page with no directive gets the default layout", () => {
    const { pages } = build("# T\n\ntext\n", { registry, layouts, themeCss: "" });
    expect(pages[0]!.layout).toBe("default");
});

test("a layout directive starts a page", () => {
    const md = "# One\n\na\n\n<!-- ainsi:layout header -->\n\nb\n";
    const { pages } = build(md, { registry, layouts, themeCss: "" });
    expect(pages.map(p => p.layout)).toEqual(["default", "header"]);
    expect(pages[0]!.blocks.flatMap(b => b.entities).length).toBe(2);
});

test("a layout directive next to an h1 makes one page, not an empty one", () => {
    const md = "<!-- ainsi:layout header -->\n\n# One\n\na\n";
    const { pages } = build(md, { registry, layouts, themeCss: "" });
    expect(pages.length).toBe(1);
    expect(pages[0]!.layout).toBe("header");
});

test("a layout governs its own page and no other", () => {
    const md = "<!-- ainsi:layout header -->\n\n# One\n\na\n\n---\n\n# Two\n\nb\n\n---\n\nc\n";
    const { pages } = build(md, { registry, layouts, themeCss: "" });
    expect(pages.map(p => p.layout)).toEqual(["header", "default", "default"]);
});

test("a deck declares its house layout once, in frontmatter", () => {
    const md = "---\nlayout: split\n---\n\n# One\n\na\n\n<!-- ainsi:layout header -->\n\n# Two\n\nb\n\n---\n\n# Three\n\nc\n";
    const { pages } = build(md, { registry, layouts, themeCss: "" });
    expect(pages.map(p => p.layout)).toEqual(["split", "header", "split"]);
});

test("an unknown house layout warns and falls back to default", () => {
    const { pages, diagnostics } = build("---\nlayout: nonesuch\n---\n\n# T\n\na\n", { registry, layouts, themeCss: "" });
    expect(pages[0]!.layout).toBe("default");
    expect(diagnostics.some(d => d.message.includes("unknown deck layout"))).toBe(true);
});

test("layout props are coerced like a component's", () => {
    const { pages } = build("<!-- ainsi:layout split ratio=\"2fr 1fr\" -->\n\n# T\n\na\n", { registry, layouts, themeCss: "" });
    expect(pages[0]!.layoutProps).toMatchObject({ ratio: "2fr 1fr" });
});

test("an unknown page layout warns and leaves the page on the deck's own", () => {
    const md = "---\nlayout: split\n---\n\n<!-- ainsi:layout nonesuch -->\n\n# One\n\na\n";
    const { pages, diagnostics } = build(md, { registry, layouts, themeCss: "" });
    expect(pages[0]!.layout).toBe("split");
    expect(diagnostics.some(d => d.message.includes("unknown layout"))).toBe(true);
});

test("a layout that drops the content is reported", async () => {
    const bad = await loadLayouts([LAYOUTS]);
    bad.register({ name: "lossy", props: layouts.get("default")!.props, render: () => "<main></main>" });
    const { diagnostics } = build("<!-- ainsi:layout lossy -->\n\n# T\n\na\n", { registry, layouts: bad, themeCss: "" });
    expect(diagnostics.some(d => d.message.includes("dropped the content"))).toBe(true);
});

test("header and section declare props at most and inherit default's render", () => {
    for (const name of ["header", "section"]) {
        expect(layouts.get(name)!.render).toBe(layouts.get("default")!.render);
    }
    for (const name of ["header", "split"]) expect(layouts.get(name)!.css).toBeTruthy();
});

test("split size=image hoists the figure before the article, dropping nothing", () => {
    const md = "<!-- ainsi:layout split size=image -->\n\n# T\n\na\n\n![](x.png)\n";
    const { html, diagnostics } = build(md, { registry, layouts, themeCss: "" });
    expect(html).toMatch(/<figure[^>]*class="ainsi-full"[\s\S]*?<\/figure><article>/);
    expect(diagnostics.some(d => d.message.includes("dropped the content"))).toBe(false);
});

test("split without size=image keeps the figure inside the article", () => {
    const md = "<!-- ainsi:layout split -->\n\n# T\n\na\n\n![](x.png)\n";
    const { html } = build(md, { registry, layouts, themeCss: "" });
    expect(html).toMatch(/<article>[\s\S]*<figure[^>]*class="ainsi-full"/);
});

test("a tone prop lands on main and the engine paints the ground from it", () => {
    const { html } = build("<!-- ainsi:layout default tone=accent -->\n\n# T\n\na\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<main data-tone="accent">');
    expect(html).toContain('main[data-tone="accent"]');
});

test("a section is on the accent ground unless its tone says otherwise", () => {
    const { html, pages } = build("<!-- ainsi:layout section -->\n\n# One\n", { registry, layouts, themeCss: "" });
    expect(pages[0]!.layoutProps).toMatchObject({ tone: "accent" });
    expect(html).toContain('<main data-tone="accent">');
    const grounded = build("<!-- ainsi:layout section tone=ground -->\n\n# One\n", { registry, layouts, themeCss: "" });
    expect(grounded.pages[0]!.layoutProps).toMatchObject({ tone: "ground" });
});

test("a frontmatter layout gets its schema's defaults too", () => {
    const { pages } = build("---\nlayout: section\n---\n\n# One\n", { registry, layouts, themeCss: "" });
    expect(pages[0]!.layoutProps).toMatchObject({ tone: "accent" });
});

test("a css-only layout renders the default markup and reaches its css", () => {
    const md = "<!-- ainsi:layout split -->\n\n# T\n\n![a](x.png)\n\n- one\n- two\n";
    const { html } = build(md, { registry, layouts, themeCss: "" });
    expect(html).toContain('data-layout="split"');
    expect(html).toContain("<main><article>");
    expect(html).toContain('[data-layout="split"] article > .ainsi-full');
});

test("layout props reach a css-only layout as data attributes", () => {
    const { html } = build("<!-- ainsi:layout header align=center -->\n\n# T\n\na\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('<main data-align="center">');
});

test("a theme adds to a layout it did not write rather than replacing it", async () => {
    const themed = await loadLayouts([LAYOUTS, resolve(THEMES, "acme/layouts")]);
    const css = themed.get("header")!.css!;
    expect(css).toContain("[data-layout=\"header\"] .ainsi-full");   // the engine's
    expect(css).toContain("text-transform: uppercase");            // the theme's
});

test("a theme is a folder of variables plus an optional escape hatch", async () => {
    const diagnostics: Diagnostic[] = [];
    const theme = await loadTheme(resolve(THEMES, "acme"), diagnostics);
    expect(theme.css).toContain("--ainsi-accent:");
    expect(theme.css).toContain("@import");
    expect(diagnostics).toEqual([]);
});

test("a theme reaching inside a component is reported", async () => {
    const diagnostics: Diagnostic[] = [];
    await loadTheme(resolve(import.meta.dir, "fixtures/nosy-theme"), diagnostics);
    expect(diagnostics.some(d => d.message.includes("reaches inside a component"))).toBe(true);
});

test("only the css of layouts a deck uses is emitted", () => {
    const { html } = build("# T\n\ntext\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('[data-layout="default"]');
    expect(html).not.toContain('[data-layout="split"]');
});
