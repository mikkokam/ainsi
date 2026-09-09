import { expect, test } from "bun:test";
import { BUILTIN, LAYOUTS, load, loadLayouts } from "../src/load";
import { assemble } from "../src/build";
import { parse } from "../src/parse";
import { addPage, alertOf, directiveLine, markerOf, move, movePage, relayout, remove, removePage, render, retag, withAlert, type Target } from "../src/studio/edits";

const registry = await load(BUILTIN);
const layouts = await loadLayouts([LAYOUTS]);

const apply = (source: string, splice: { start: number; end: number; text: string }) =>
    source.slice(0, splice.start) + splice.text + source.slice(splice.end);

const blocksOf = (md: string) =>
    assemble(md, { registry, layouts }).pages.flatMap(p => p.blocks.map(b => [b.component, b.entities.length]));

/** the target the studio builds for an entity: its slice plus what governs and bounds it */
function targetOf(source: string, index: number): Target {
    const { doc } = parse(source);
    const entity = doc.entities[index]!;
    const next = doc.entities[index + 1];
    const directive = doc.directives.find(d => d.before === entity.id && d.component !== "end");
    const terminator = next && doc.directives.find(d => d.before === next.id && d.component === "end");
    return {
        start: entity.node.position.start.offset,
        end: entity.node.position.end.offset,
        md: entity.md,
        kind: entity.kind,
        ...(directive ? { directive: { start: directive.start, end: directive.end } } : {}),
        ...(terminator ? { terminator: { start: terminator.start, end: terminator.end } } : {}),
    };
}

test("retag keeps the words and swaps the syntax", () => {
    expect(retag("## Title here", "heading", "paragraph")).toBe("Title here");
    expect(retag("one line\nsecond line", "paragraph", "heading1")).toBe("# one line second line");
    expect(retag("- a\n- b\n  continued\n- c", "list", "paragraph")).toBe("a\nb continued\nc");
    expect(retag("a\nb", "paragraph", "list")).toBe("- a\n- b");
    expect(retag("> said\n> twice", "quote", "heading3")).toBe("### said twice");
    expect(retag("1. x\n2. y", "list", "quote")).toBe("> x\n> y");
    expect(retag("a\nb", "paragraph", "ordered")).toBe("1. a\n2. b");
    expect(retag("x", "paragraph", "heading5")).toBe("##### x");
    expect(retag("- a\n- b", "list", "code")).toBe("```\n- a\n- b\n```");
    expect(retag("```js\nlet x\n```", "code", "paragraph")).toBe("let x");
});

test("a new list beside a list takes a marker of its own, so the two stay apart", () => {
    expect(markerOf("- a\n- b")).toBe("-");
    expect(markerOf("3. a\n4. b")).toBe("1.");
    expect(retag("intro", "paragraph", "list", ["-"])).toBe("* intro");
    expect(retag("intro", "paragraph", "ordered", ["1."])).toBe("1) intro");
    const source = "intro\n\n- a\n- b\n";
    const after = source.replace("intro", retag("intro", "paragraph", "list", [markerOf("- a\n- b")]));
    expect(parse(after).doc.entities.map(e => e.kind)).toEqual(["list", "list"]);
});

test("a directive line carries only the props it is given, quoted when needed", () => {
    expect(directiveLine("boxes")).toBe("<!-- ainsi: boxes -->");
    expect(directiveLine("boxes", { stretch: true })).toBe("<!-- ainsi: boxes stretch -->");
    expect(directiveLine("timeline", { axis: "vertical", note: "two words" })).toBe('<!-- ainsi: timeline axis=vertical note="two words" -->');
});

test("adding a directive before a lone entity is one line, and the engine reads it back", () => {
    const source = "# Page\n\n- a\n- b\n";
    const after = apply(source, render(targetOf(source, 1), "timeline", { axis: "vertical" }));
    expect(after).toBe("# Page\n\n<!-- ainsi: timeline axis=vertical -->\n- a\n- b\n");
    expect(blocksOf(after)).toEqual([["prose", 1], ["timeline", 1]]);
});

test("replacing a directive rewrites the line in place", () => {
    const source = "<!-- ainsi: timeline -->\n\n- a\n- b\n";
    const after = apply(source, render(targetOf(source, 0), "boxes"));
    expect(after).toBe("<!-- ainsi: boxes -->\n- a\n- b\n");
    expect(blocksOf(after)).toEqual([["boxes", 1]]);
});

test("a directive inside a run governs one entity and needs no marker", () => {
    const source = "a\n\nb\n\nc\n";
    const tagged = apply(source, render(targetOf(source, 1), "prose", { size: "large" }));
    expect(tagged).toBe("a\n\n<!-- ainsi: prose size=large -->\nb\n\nc\n");
    expect(blocksOf(tagged)).toEqual([["prose", 1], ["prose", 1], ["prose", 1]]);
    const untagged = apply(tagged, render(targetOf(tagged, 1), null));
    expect(untagged).toBe("a\n\nb\n\nc\n");
});

test("a marker left by an older studio goes with its directive", () => {
    const source = "a\n\n<!-- ainsi: prose size=large -->\nb\n\n<!-- ainsi: end -->\n\nc\n";
    expect(apply(source, render(targetOf(source, 1), null))).toBe("a\n\nb\n\nc\n");
});

test("removing a block takes its directive, its marker and the gap after it", () => {
    const source = "a\n\n<!-- ainsi: prose size=large -->\nb\n\n<!-- ainsi: end -->\n\nc\n";
    expect(apply(source, remove(source, targetOf(source, 1)))).toBe("a\n\nc\n");
});

test("an alert is a marker line on a quote: set, changed, removed, and text becomes a quote first", () => {
    expect(withAlert("> said", "quote", "tip")).toBe("> [!TIP]\n> said");
    expect(withAlert("> [!TIP]\n> said", "quote", "caution")).toBe("> [!CAUTION]\n> said");
    expect(withAlert("> [!TIP]\n> said", "quote", null)).toBe("> said");
    expect(withAlert("plain words", "paragraph", "note")).toBe("> [!NOTE]\n> plain words");
    expect(alertOf("> [!WARNING]\n> x")).toBe("warning");
    expect(alertOf("> x")).toBeUndefined();
    expect(parse(withAlert("plain words", "paragraph", "note")).doc.entities.map(e => e.kind)).toEqual(["quote"]);
});

test("alert is a kind of its own: in from any text, out through the marker", () => {
    expect(retag("plain", "paragraph", "alert")).toBe("> [!NOTE]\n> plain");
    expect(retag("> [!TIP]\n> said", "quote", "alert")).toBe("> [!TIP]\n> said");
    expect(retag("> [!TIP]\n> said", "quote", "paragraph")).toBe("said");
    expect(retag("> [!TIP]\n> said\n> twice", "quote", "list")).toBe("- said\n- twice");
    expect(retag("> [!TIP]\n> said", "quote", "quote")).toBe("> said");
});

/** the page target the studio builds: the first entity's offset plus the governing directive */
function pageOf(source: string, index: number) {
    const { doc } = parse(source);
    const { pages } = assemble(source, { registry, layouts });
    const ids = pages[index]!.blocks.flatMap(b => b.entities.map(e => e.id));
    const directive = doc.directives.filter(d => d.kind === "layout" && d.before && ids.includes(d.before)).at(-1);
    const first = doc.entities.find(e => e.id === ids[0])!;
    const last = doc.entities.find(e => e.id === ids.at(-1))!;
    const after = doc.entities[doc.entities.findIndex(e => e.id === ids.at(-1)) + 1];
    const terminator = after && doc.directives.find(d => d.before === after.id && d.component === "end");
    const at = doc.entities.findIndex(e => e.id === ids[0]);
    const opensAnyway = at === 0 || doc.entities[at - 1]!.kind === "break";
    return {
        first: first.node.position.start.offset as number,
        last: terminator?.end ?? (last.node.position.end.offset as number),
        held: !!directive && !opensAnyway,
        ...(directive ? { directive: { start: directive.start, end: directive.end } } : {}),
    };
}

test("relayout writes one directive line before the page's first entity", () => {
    const source = "# One\n\na\n\n---\n\n# Two\n\nb\n";
    const after = apply(source, relayout(source, pageOf(source, 1), "default", "section", { tone: "inverse" })!);
    expect(after).toBe("# One\n\na\n\n---\n\n<!-- ainsi: layout section tone=inverse -->\n# Two\n\nb\n");
    const { pages } = assemble(after, { registry, layouts });
    expect(pages.map(p => p.layout)).toEqual(["default", "section"]);
    expect(pages[1]!.layoutProps).toMatchObject({ tone: "inverse" });
});

test("relayout says nothing when the file already says it", () => {
    const source = "# One\n\na\n";
    expect(relayout(source, pageOf(source, 0), "default", "default")).toBeUndefined();
});

test("relayout rewrites an existing directive in place", () => {
    const source = "---\n\n<!-- ainsi: layout header -->\n\n# Two\n\nb\n".replace("---\n\n", "# One\n\n---\n\n");
    const after = apply(source, relayout(source, pageOf(source, 1), "default", "split", { side: "right" })!);
    expect(after).toContain("<!-- ainsi: layout split side=right -->");
    expect(after).not.toContain("layout header");
});

test("relayout removes a directive the deck's own layout makes redundant, when a break holds the page", () => {
    const source = "# One\n\n---\n\n<!-- ainsi: layout header -->\n\n# Two\n";
    const after = apply(source, relayout(source, pageOf(source, 1), "default", "default")!);
    expect(after).toBe("# One\n\n---\n\n# Two\n");
    expect(assemble(after, { registry, layouts }).pages.length).toBe(2);
});

test("relayout keeps a directive that is itself the page break, as an explicit default", () => {
    const source = "# One\n\n<!-- ainsi: layout header -->\n\n# Two\n";
    const after = apply(source, relayout(source, pageOf(source, 1), "default", "default")!);
    expect(after).toBe("# One\n\n<!-- ainsi: layout default -->\n\n# Two\n");
    expect(assemble(after, { registry, layouts }).pages.length).toBe(2);
});

test("addPage breaks after the page's last entity, past a closing end marker, and before the next page", () => {
    const source = "# One\n\n<!-- ainsi: boxes -->\n- a\n- b\n<!-- /ainsi -->\n\n---\n\n# Three";
    const after = apply(source, addPage(pageOf(source, 0), "# Two\n"));
    const { pages } = assemble(after, { registry, layouts });
    expect(pages.map(p => p.blocks[0]!.entities[0]!.md)).toEqual(["# One", "# Two", "# Three"]);
    expect(pages[0]!.blocks.map(b => b.component)).toEqual(["prose", "boxes"]);

    const last = apply(source, addPage(pageOf(source, 1), "# Four"));
    expect(assemble(last, { registry, layouts }).pages.length).toBe(3);
});

test("removePage takes the page, its directive and the break after it", () => {
    const source = "# One\n\n---\n\n<!-- ainsi:layout section -->\n# Two\n\nsaid\n\n---\n\n# Three";
    const after = apply(source, removePage(source, pageOf(source, 1)));
    expect(after).toBe("# One\n\n---\n\n# Three");
});

test("removePage takes the break before a last page, and leaves frontmatter's closing line alone", () => {
    const two = "# One\n\n---\n\n# Two";
    expect(apply(two, removePage(two, pageOf(two, 1)))).toBe("# One");
    const only = "---\ntheme: default\n---\n\n# Only";
    expect(apply(only, removePage(only, pageOf(only, 0)))).toBe("---\ntheme: default\n---");
});

test("move swaps a block with its neighbour and keeps what separated them", () => {
    const source = "# Page\n\nfirst\n\nsecond\n";
    const down = apply(source, move(source, targetOf(source, 1), targetOf(source, 2)));
    expect(down).toBe("# Page\n\nsecond\n\nfirst\n");
    expect(apply(source, move(source, targetOf(source, 2), targetOf(source, 1)))).toBe(down);
});

test("a moved block takes its directive and its end marker along", () => {
    const source = "<!-- ainsi: boxes -->\n- a\n- b\n\n<!-- ainsi: end -->\n\nafter\n";
    const after = apply(source, move(source, targetOf(source, 0), targetOf(source, 1)));
    expect(after).toBe("after\n\n<!-- ainsi: boxes -->\n- a\n- b\n\n<!-- ainsi: end -->\n");
    expect(blocksOf(after)).toEqual([["prose", 1], ["boxes", 1]]);
});

test("movePage swaps two pages and keeps the break between them", () => {
    const source = "# One\n\na\n\n---\n\n<!-- ainsi: layout section -->\n# Two\n\nb\n";
    const after = apply(source, movePage(source, pageOf(source, 0), pageOf(source, 1)));
    expect(after).toBe("<!-- ainsi: layout section -->\n# Two\n\nb\n\n---\n\n# One\n\na\n");
    const { pages } = assemble(after, { registry, layouts });
    expect(pages.map(p => p.layout)).toEqual(["section", "default"]);
});

test("movePage writes the break a layout directive was holding open, so the pages stay two", () => {
    const source = "# One\n\n<!-- ainsi: layout header -->\n# Two\n";
    const after = apply(source, movePage(source, pageOf(source, 0), pageOf(source, 1)));
    expect(after).toBe("<!-- ainsi: layout header -->\n# Two\n\n---\n\n# One\n");
    expect(assemble(after, { registry, layouts }).pages.length).toBe(2);
});

test("move parts blocks that were glued together, so neither absorbs the other", () => {
    const source = "# One\nsaid\n\n- a\n- b\n";
    const after = apply(source, move(source, targetOf(source, 1), targetOf(source, 0)));
    expect(after).toBe("said\n\n# One\n\n- a\n- b\n");
    expect(parse(after).doc.entities.map(e => e.kind)).toEqual(["paragraph", "heading", "list"]);
});

test("a moved page takes the directives standing above its first entity", () => {
    const source = "# One\n\n---\n\n<!-- ainsi: agenda -->\n1. a\n2. b\n";
    const after = apply(source, movePage(source, pageOf(source, 1), pageOf(source, 0)));
    expect(after).toBe("<!-- ainsi: agenda -->\n1. a\n2. b\n\n---\n\n# One\n");
    const { pages } = assemble(after, { registry, layouts });
    expect(pages.map(p => p.blocks[0]!.component)).toEqual(["agenda", "prose"]);
});

test("a moved page leaves the end marker that closes the page before it", () => {
    const source = "<!-- ainsi: boxes -->\n- a\n- b\n\n<!-- ainsi: end -->\n\n---\n\n# Two\n";
    const after = apply(source, movePage(source, pageOf(source, 1), pageOf(source, 0)));
    expect(after).toBe("# Two\n\n---\n\n<!-- ainsi: boxes -->\n- a\n- b\n\n<!-- ainsi: end -->\n");
});
