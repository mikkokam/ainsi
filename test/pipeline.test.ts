import { expect, test } from "bun:test";
import { parse } from "../src/parse";
import { paginate } from "../src/paginate";
import { group } from "../src/group";
import { BUILTIN, LAYOUTS, load, loadLayouts } from "../src/load";

const defaults = await load([BUILTIN]);
const layouts = await loadLayouts([LAYOUTS]);
import { build } from "../src/build";
import type { Diagnostic } from "../src/types";

const blocksOf = (md: string) => {
    const { doc, diagnostics } = parse(md);
    const pages = paginate(doc.entities, doc.settings);
    const out = pages.map(p => group(p, doc.directives, defaults, diagnostics));
    return { pages: out, diagnostics };
};

test("paragraphs are separate entities and a list is one", () => {
    const { doc } = parse("a\n\nb\n\n- x\n- y\n");
    expect(doc.entities.map(e => e.kind)).toEqual(["paragraph", "paragraph", "list"]);
});

test("a paragraph holding only an image is an image entity", () => {
    const { doc } = parse("![alt](a.png)\n\ntext ![alt](b.png) more\n");
    expect(doc.entities.map(e => e.kind)).toEqual(["image", "paragraph"]);
});

test("entity ids survive an unrelated edit above them", () => {
    const before = parse("# Title\n\ntarget paragraph\n").doc.entities.at(-1)!.id;
    const after = parse("# Title\n\ninserted\n\ntarget paragraph\n").doc.entities.at(-1)!.id;
    expect(after).toBe(before);
});

test("duplicate text gets distinct ordinals", () => {
    const ids = parse("same\n\nsame\n").doc.entities.map(e => e.id);
    expect(ids[0]).not.toBe(ids[1]);
});

test("a directive is lifted out of the entity stream", () => {
    const { doc } = parse("<!-- pac: timeline axis=horizontal -->\n\n- Q1: a\n- Q2: b\n");
    expect(doc.entities.map(e => e.kind)).toEqual(["list"]);
    expect(doc.directives[0]).toMatchObject({ component: "timeline", props: { axis: "horizontal" } });
});

test("an unnamespaced comment is not a directive", () => {
    const { doc } = parse("<!-- just a note -->\n\n- a\n- b\n");
    expect(doc.directives).toEqual([]);
});

test("a directive governing nothing warns rather than failing", () => {
    const { diagnostics } = parse("text\n\n<!-- pac: timeline -->\n");
    expect(diagnostics.some(d => d.message.includes("governs nothing"))).toBe(true);
});

test("extent runs until the next directive", () => {
    const md = "<!-- pac: prose -->\n\na\n\nb\n\n<!-- pac: boxes -->\n\n- x\n- y\n";
    const [page] = blocksOf(md).pages;
    expect(page!.map(b => [b.component, b.entities.length])).toEqual([["prose", 2], ["boxes", 1]]);
});

test("an unknown component degrades to the heuristic", () => {
    const { pages, diagnostics } = blocksOf("<!-- pac: nonesuch -->\n\n- Q1: a\n- Q2: b\n");
    expect(pages[0]![0]).toMatchObject({ component: "timeline", origin: "heuristic" });
    expect(diagnostics.some(d => d.message.includes("unknown component"))).toBe(true);
});

test("a component that rejects the span degrades to the heuristic", () => {
    const { pages, diagnostics } = blocksOf("<!-- pac: comparison -->\n\n- a\n- b\n");
    expect(pages[0]![0]!.origin).toBe("heuristic");
    expect(diagnostics.some(d => d.message.includes("does not accept"))).toBe(true);
});

test("labelled lists beat short lists: timeline is tested before boxes", () => {
    const { pages } = blocksOf("- Q1: a\n- Q2: b\n- Q3: c\n");
    expect(pages[0]![0]!.component).toBe("timeline");
});

test("a short unlabelled list is boxes, which sizes itself", () => {
    const { pages } = blocksOf("- yksi\n- kaksi\n- kolme\n");
    expect(pages[0]![0]).toMatchObject({ component: "boxes", props: {} });
});

test("a label column plus two is a comparison, wider stays a table", () => {
    const two = blocksOf("| | A | B |\n| --- | --- | --- |\n| x | 1 | 2 |\n");
    expect(two.pages[0]![0]!.component).toBe("comparison");
    const wide = blocksOf("| a | b | c | d |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |\n");
    expect(wide.pages[0]![0]!.component).toBe("table");
});

test("h1 and thematic break both start a page candidate", () => {
    const { doc } = parse("# One\n\na\n\n# Two\n\nb\n\n---\n\nc\n");
    expect(paginate(doc.entities, doc.settings).length).toBe(3);
});

test("blocks partition the page with no gaps or overlap", () => {
    const md = "# T\n\nintro\n\n<!-- pac: boxes -->\n\n- a\n- b\n\ntail\n";
    const { doc } = parse(md);
    const [page] = paginate(doc.entities, doc.settings);
    const diagnostics: Diagnostic[] = [];
    const covered = group(page!, doc.directives, defaults, diagnostics).flatMap(b => b.entities.map(e => e.id));
    expect(covered).toEqual(page!.map(e => e.id));
});

test("build emits one section per page and only the css of components used", () => {
    const { html, pages } = build("# One\n\nlead text\n", { registry: defaults, layouts, themeCss: "" });
    expect(pages.length).toBe(1);
    expect(html.match(/class="pac-page"/g)?.length).toBe(1);
    expect(html).toContain('data-pac="lead"');
    expect(html).not.toContain('data-pac="timeline"');
});
