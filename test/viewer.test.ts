import { expect, test } from "bun:test";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadViewer } from "../src/load";
import { build } from "../src/build";

const registry = await load([BUILTIN]);
const layouts = await loadLayouts([LAYOUTS]);
const viewer = await loadViewer();
const md = "# One\n\na\n\n# Two\n\nb\n";

test("the viewer bundles to one self-contained script", () => {
    expect(viewer.script).toBeTruthy();
    expect(viewer.script).not.toContain("import ");
    expect(viewer.script).toContain("pac-toolbar");
});

test("the deck carries the toolbar and presentation styles", () => {
    const { html } = build(md, { registry, layouts, themeCss: "", viewer });
    expect(html).toContain(".pac-toolbar");
    expect(html).toContain("[data-present]");
});

test("chrome is injected at runtime, never written into the markup", () => {
    const { html } = build(md, { registry, layouts, themeCss: "", viewer });
    const body = html.slice(html.indexOf("<body"), html.indexOf("<script"));
    expect(body).not.toContain("pac-toolbar");
});

test("the viewer is omitted entirely when it is not wanted", () => {
    const { html } = build(md, { registry, layouts, themeCss: "" });
    expect(html).not.toContain("pac-toolbar");
    expect(html).not.toContain("body[data-present] .pac-page");   // present-mode rules
    expect(html).not.toContain("<script");
});

test("pages are numbered in the scroll view and not while presenting", () => {
    const { html } = build(md, { registry, layouts, themeCss: "" });
    expect(html).toContain('body.pac:not([data-present]) .pac-page::after');
    expect(html).toContain("content: attr(data-page)");
    expect(html).toContain('data-page="2"');
});

test("chrome never prints", () => {
    expect(viewer.css).toContain("@media print");
    const rule = viewer.css.slice(viewer.css.indexOf("@media print"));
    expect(rule).toContain(".pac-toolbar, .pac-overview { display: none; }");
});

test("a page's address is its first heading, slugged", () => {
    const { html } = build("# Hyvä Alku\n\na\n\n# Two\n\nb\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('id="hyva-alku"');
    expect(html).toContain('id="two"');
});

test("duplicate headings and headingless pages still get distinct addresses", () => {
    const { html } = build("# Same\n\na\n\n# Same\n\nb\n\n---\n\nno heading here\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('id="same"');
    expect(html).toContain('id="same-2"');
    expect(html).toContain('id="page-3"');
});

test("icons are inlined rather than fetched", () => {
    expect(viewer.script).toContain("<svg");
    expect(viewer.script).not.toMatch(/https?:\/\//);
});
