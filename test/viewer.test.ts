import { expect, test } from "bun:test";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadViewer } from "../src/load";
import { build } from "../src/build";

const registry = await load([BUILTIN]);
const layouts = await loadLayouts([LAYOUTS]);
const viewer = await loadViewer();
const md = "# One\n\na\n\n---\n\n# Two\n\nb\n";

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
    expect(rule).toContain(".pac-toolbar, .pac-overview, .pac-keys { display: none; }");
});

test("the viewer carries the shortcut card and the grid answers the keyboard", () => {
    expect(viewer.script).toContain("pac:keys");
    expect(viewer.script).toContain("pac-keys");
    expect(viewer.css).toContain(".pac-keys");
    for (const key of ["ArrowRight", "ArrowDown", "Home", "End", "Enter"]) expect(viewer.script).toContain(`"${key}"`);
});

test("a page's address is its first heading, slugged", () => {
    const { html } = build("# Hyvä Alku\n\na\n\n---\n\n# Two\n\nb\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('id="hyva-alku"');
    expect(html).toContain('id="two"');
});

test("duplicate headings and headingless pages still get distinct addresses", () => {
    const { html } = build("# Same\n\na\n\n---\n\n# Same\n\nb\n\n---\n\nno heading here\n", { registry, layouts, themeCss: "" });
    expect(html).toContain('id="same"');
    expect(html).toContain('id="same-2"');
    expect(html).toContain('id="page-3"');
});

test("icons are inlined rather than fetched", () => {
    expect(viewer.script).toContain("<svg");
    expect(viewer.script).not.toMatch(/https?:\/\//);
});

test("the deck prints one page per sheet, sized to its ratio, with no chrome or reading marks", () => {
    const { html } = build("---\nratio: 4:3\n---\n\n# One\n\na\n", { registry, layouts, themeCss: "", viewer });
    expect(html).toContain("@page { size: 1280px 960px; margin: 0; }");
    const print = html.slice(html.indexOf("@media print {"), html.indexOf("@media screen"));
    expect(print).toContain("break-after: page");
    expect(print).toContain(".pac-page::after { display: none; }");
});

test("the reading view is a screen affair: a print laid out on narrow paper must not reflow", () => {
    const { html } = build(md, { registry, layouts, themeCss: "", viewer });
    expect(html).not.toMatch(/@media \(max-width/);
});

test("the deck's mark rides on the body as a token; a deck without one sets nothing", () => {
    const marked = build("---\nlogo: x.png\n---\n\n# T\n\na\n", { registry, layouts, themeCss: "", logo: "data:image/png;base64,AAAA" }).html;
    expect(marked).toContain("--pac-logo:url('data:image/png;base64,AAAA');--pac-logo-cover:url('data:image/png;base64,AAAA')");
    const two = build("# T\n\na\n", { registry, layouts, themeCss: "", logo: "data:a", coverLogo: "data:b" }).html;
    expect(two).toContain("--pac-logo:url('data:a');--pac-logo-cover:url('data:b')");
    expect(build(md, { registry, layouts, themeCss: "" }).html).not.toContain("--pac-logo");
});
