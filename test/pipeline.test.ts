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

test("a directive governs the one entity it precedes", () => {
    const md = "<!-- pac: prose size=large -->\n\na\n\nb\n\n<!-- pac: boxes -->\n\n- x\n- y\n";
    const [page] = blocksOf(md).pages;
    expect(page!.map(b => [b.component, b.entities.length, b.origin])).toEqual([["prose", 1, "directive"], ["prose", 1, "heuristic"], ["boxes", 1, "directive"]]);
});

test("a directive does not swallow what the heuristic would have grouped apart", () => {
    const [page] = blocksOf("<!-- pac: prose -->\n\na\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n").pages;
    expect(page!.map(b => [b.component, b.entities.length])).toEqual([["prose", 1], ["comparison", 1]]);
});

test("a directive grows its span until the component accepts it", () => {
    const [page] = blocksOf("<!-- pac: timeline -->\n\n## Plan\n\n- Q1: a\n- Q2: b\n").pages;
    expect(page!.map(b => [b.component, b.entities.length])).toEqual([["timeline", 2]]);
});

test("an end marker from an older deck is still honoured", () => {
    const md = "a\n\n<!-- pac: prose size=large -->\n\nb\n\n<!-- pac: end -->\n\nc\n";
    const [page] = blocksOf(md).pages;
    expect(page!.map(b => [b.component, b.entities.length, b.origin])).toEqual([["prose", 1, "heuristic"], ["prose", 1, "directive"], ["prose", 1, "heuristic"]]);
});

test("a directive carries its source offsets", () => {
    const md = "x\n\n<!-- pac: boxes -->\n\n- a\n- b\n";
    const { doc } = parse(md);
    const [d] = doc.directives;
    expect(md.slice(d!.start, d!.end)).toBe("<!-- pac: boxes -->");
});

test("an unknown component degrades to the heuristic", () => {
    const { pages, diagnostics } = blocksOf("<!-- pac: nonesuch -->\n\n- Q1: a\n- Q2: b\n");
    expect(pages[0]![0]).toMatchObject({ component: "prose", origin: "heuristic" });
    expect(diagnostics.some(d => d.message.includes("unknown component"))).toBe(true);
});

test("a component that rejects the span degrades to the heuristic", () => {
    const { pages, diagnostics } = blocksOf("<!-- pac: comparison -->\n\n- a\n- b\n");
    expect(pages[0]![0]!.origin).toBe("heuristic");
    expect(diagnostics.some(d => d.message.includes("does not accept"))).toBe(true);
});

test("a list is a list until a directive says otherwise", () => {
    const [page] = blocksOf("intro\n\n- Q1: a\n- Q2: b\n\n1. one\n2. two\n").pages;
    expect(page!.map(b => [b.component, b.entities.length])).toEqual([["prose", 3]]);
});

test("a label column plus two is a comparison, wider stays a plain table", () => {
    const two = blocksOf("| | A | B |\n| --- | --- | --- |\n| x | 1 | 2 |\n");
    expect(two.pages[0]![0]!.component).toBe("comparison");
    const wide = blocksOf("| a | b | c | d |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |\n");
    expect(wide.pages[0]![0]!.component).toBe("prose");
});

test("a thematic break starts a page; an h1 only when the deck opts in", () => {
    const md = "# One\n\na\n\n# Two\n\nb\n\n---\n\nc\n";
    const { doc } = parse(md);
    expect(paginate(doc.entities, doc.settings).length).toBe(2);
    expect(paginate(doc.entities, { ...doc.settings, h1StartsPage: true }).length).toBe(3);
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

test("a heuristic block carries its component's schema defaults, like a directive's does", () => {
    const [page] = blocksOf("# T\n\n![a](x.png)\n\nbeside it\n").pages;
    const aside = page!.find(b => b.component === "aside")!;
    expect(aside.origin).toBe("heuristic");
    expect(aside.props).toEqual({ side: "right" });
    const [plain] = blocksOf("words\n").pages;
    expect(plain![0]!.props).toEqual({ size: "normal" });
});

test("a newline inside a paragraph is a line break; a blank line is still a new block", async () => {
    const registry = await load([BUILTIN]);
    const layouts = await loadLayouts([LAYOUTS]);
    const { html } = build("one\nline two\n\nnext block\n", { registry, layouts, themeCss: "" });
    expect(html).toContain("<p>one<br>\nline two</p>");
    expect(html).toContain("<p>next block</p>");
    expect(build("`a\nb`\n", { registry, layouts, themeCss: "" }).html).not.toContain("<br>");
});
