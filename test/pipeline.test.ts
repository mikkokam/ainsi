import { expect, test } from "bun:test";
import { images, parse } from "../src/parse";
import { paginate } from "../src/paginate";
import { group } from "../src/group";
import { BUILTIN, LAYOUTS, load, loadLayouts } from "../src/load";

const defaults = await load();
const layouts = await loadLayouts();
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
    const { doc } = parse("<!-- ainsi: timeline axis=horizontal -->\n\n- Q1: a\n- Q2: b\n");
    expect(doc.entities.map(e => e.kind)).toEqual(["list"]);
    expect(doc.directives[0]).toMatchObject({ component: "timeline", props: { axis: "horizontal" } });
});

test("an unnamespaced comment is not a directive", () => {
    const { doc } = parse("<!-- just a note -->\n\n- a\n- b\n");
    expect(doc.directives).toEqual([]);
});

test("a directive governing nothing warns rather than failing", () => {
    const { diagnostics } = parse("text\n\n<!-- ainsi: timeline -->\n");
    expect(diagnostics.some(d => d.message.includes("governs nothing"))).toBe(true);
});

test("a directive governs the one entity it precedes", () => {
    const md = "<!-- ainsi: prose size=large -->\n\na\n\nb\n\n<!-- ainsi: boxes -->\n\n- x\n- y\n";
    const [page] = blocksOf(md).pages;
    expect(page!.map(b => [b.component, b.entities.length, b.origin])).toEqual([["prose", 1, "directive"], ["prose", 1, "heuristic"], ["boxes", 1, "directive"]]);
});

test("a directive does not swallow what the heuristic would have grouped apart", () => {
    const [page] = blocksOf("<!-- ainsi: prose -->\n\na\n\n![p](x.png)\n").pages;
    expect(page!.map(b => [b.component, b.entities.length])).toEqual([["prose", 1], ["full", 1]]);
});

test("a directive grows its span until the component accepts it", () => {
    const [page] = blocksOf("<!-- ainsi: timeline -->\n\n## Plan\n\n- Q1: a\n- Q2: b\n").pages;
    expect(page!.map(b => [b.component, b.entities.length])).toEqual([["timeline", 2]]);
});

test("an end marker from an older deck is still honoured", () => {
    const md = "a\n\n<!-- ainsi: prose size=large -->\n\nb\n\n<!-- ainsi: end -->\n\nc\n";
    const [page] = blocksOf(md).pages;
    expect(page!.map(b => [b.component, b.entities.length, b.origin])).toEqual([["prose", 1, "heuristic"], ["prose", 1, "directive"], ["prose", 1, "heuristic"]]);
});

test("a directive carries its source offsets", () => {
    const md = "x\n\n<!-- ainsi: boxes -->\n\n- a\n- b\n";
    const { doc } = parse(md);
    const [d] = doc.directives;
    expect(md.slice(d!.start, d!.end)).toBe("<!-- ainsi: boxes -->");
});

test("an unknown component degrades to the heuristic", () => {
    const { pages, diagnostics } = blocksOf("<!-- ainsi: nonesuch -->\n\n- Q1: a\n- Q2: b\n");
    expect(pages[0]![0]).toMatchObject({ component: "prose", origin: "heuristic" });
    expect(diagnostics.some(d => d.message.includes("unknown component"))).toBe(true);
});

test("a component that rejects the span degrades to the heuristic", () => {
    const { pages, diagnostics } = blocksOf("<!-- ainsi: comparison -->\n\n- a\n- b\n");
    expect(pages[0]![0]!.origin).toBe("heuristic");
    expect(diagnostics.some(d => d.message.includes("does not accept"))).toBe(true);
});

test("a list is a list until a directive says otherwise", () => {
    const [page] = blocksOf("intro\n\n- Q1: a\n- Q2: b\n\n1. one\n2. two\n").pages;
    expect(page!.map(b => [b.component, b.entities.length])).toEqual([["prose", 3]]);
});

test("a table is a table until a directive names comparison", () => {
    const plain = blocksOf("| | A | B |\n| --- | --- | --- |\n| x | 1 | 2 |\n");
    expect(plain.pages[0]![0]!.component).toBe("prose");
    const named = blocksOf("<!-- ainsi: comparison -->\n| | A | B |\n| --- | --- | --- |\n| x | 1 | 2 |\n");
    expect(named.pages[0]![0]!).toMatchObject({ component: "comparison", origin: "directive" });
});

test("a thematic break starts a page; an h1 only when the deck opts in", () => {
    const md = "# One\n\na\n\n# Two\n\nb\n\n---\n\nc\n";
    const { doc } = parse(md);
    expect(paginate(doc.entities, doc.settings).length).toBe(2);
    expect(paginate(doc.entities, { ...doc.settings, h1StartsPage: true }).length).toBe(3);
});

test("blocks partition the page with no gaps or overlap", () => {
    const md = "# T\n\nintro\n\n<!-- ainsi: boxes -->\n\n- a\n- b\n\ntail\n";
    const { doc } = parse(md);
    const [page] = paginate(doc.entities, doc.settings);
    const diagnostics: Diagnostic[] = [];
    const covered = group(page!, doc.directives, defaults, diagnostics).flatMap(b => b.entities.map(e => e.id));
    expect(covered).toEqual(page!.map(e => e.id));
});

test("build emits one section per page and only the css of components used", () => {
    const { html, pages } = build("# One\n\n<!-- ainsi: boxes -->\n- a\n- b\n", { registry: defaults, layouts, themeCss: "" });
    expect(pages.length).toBe(1);
    expect(html.match(/class="ainsi-page"/g)?.length).toBe(1);
    expect(html).toContain('data-ainsi="boxes"');
    expect(html).not.toContain('data-ainsi="timeline"');
});

test("a heuristic block carries its component's schema defaults, like a directive's does", () => {
    const [plain] = blocksOf("words\n").pages;
    expect(plain![0]!.props).toEqual({ size: "normal", align: "left", caps: false, color: "ink" });
});

test("an image is its own full block; the text after it flows on, never an aside", () => {
    const [page] = blocksOf("# T\n\n![a](x.png)\n\nafter it\n").pages;
    expect(page!.map(b => b.component)).toEqual(["prose", "full", "prose"]);
});

test("a newline inside a paragraph is a line break; a blank line is still a new block", async () => {
    const registry = await load();
    const layouts = await loadLayouts();
    const { html } = build("one\nline two\n\nnext block\n", { registry, layouts, themeCss: "" });
    expect(html).toContain("<p>one<br>\nline two</p>");
    expect(html).toContain("<p>next block</p>");
    expect(build("`a\nb`\n", { registry, layouts, themeCss: "" }).html).not.toContain("<br>");
});

test("images() finds one inside a list, which is where figures and tiles put them", () => {
    const { doc } = parse("# T\n\n<!-- ainsi: figures -->\n\n- ![a](one.png)\n- ![b](two.png)\n\n![c](three.png)\n");
    expect(images(doc.entities).map(i => i.url)).toEqual(["one.png", "two.png", "three.png"]);
    expect(images(doc.entities).every(i => i.span)).toBe(true);
});

test("an image's url is rewritten through the node the walk handed back", () => {
    const { doc } = parse("- ![a](one.png)\n");
    const [found] = images(doc.entities);
    found!.set("data:image/png;base64,AAA");
    expect(images(doc.entities).map(i => i.url)).toEqual(["data:image/png;base64,AAA"]);
});
