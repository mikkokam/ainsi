import { expect, test } from "bun:test";
import { BUILTIN, LAYOUTS, load, loadLayouts } from "../src/load";
import { assemble } from "../src/build";
import { parse } from "../src/parse";
import { alertOf, directiveLine, markerOf, remove, render, retag, withAlert, type Target } from "../src/studio/edits";

const registry = await load([BUILTIN]);
const layouts = await loadLayouts([LAYOUTS]);

const apply = (source: string, splice: { start: number; end: number; text: string }) =>
    source.slice(0, splice.start) + splice.text + source.slice(splice.end);

const blocksOf = (md: string) =>
    assemble(md, { registry, layouts, themeCss: "" }).pages.flatMap(p => p.blocks.map(b => [b.component, b.entities.length]));

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
    expect(directiveLine("boxes")).toBe("<!-- pac: boxes -->");
    expect(directiveLine("boxes", { stretch: true })).toBe("<!-- pac: boxes stretch -->");
    expect(directiveLine("timeline", { axis: "vertical", note: "two words" })).toBe('<!-- pac: timeline axis=vertical note="two words" -->');
});

test("adding a directive before a lone entity is one line, and the engine reads it back", () => {
    const source = "# Page\n\n- a\n- b\n";
    const after = apply(source, render(targetOf(source, 1), "timeline", { axis: "vertical" }));
    expect(after).toBe("# Page\n\n<!-- pac: timeline axis=vertical -->\n- a\n- b\n");
    expect(blocksOf(after)).toEqual([["prose", 1], ["timeline", 1]]);
});

test("replacing a directive rewrites the line in place", () => {
    const source = "<!-- pac: timeline -->\n\n- a\n- b\n";
    const after = apply(source, render(targetOf(source, 0), "boxes"));
    expect(after).toBe("<!-- pac: boxes -->\n- a\n- b\n");
    expect(blocksOf(after)).toEqual([["boxes", 1]]);
});

test("a directive inside a run governs one entity and needs no marker", () => {
    const source = "a\n\nb\n\nc\n";
    const tagged = apply(source, render(targetOf(source, 1), "prose", { size: "large" }));
    expect(tagged).toBe("a\n\n<!-- pac: prose size=large -->\nb\n\nc\n");
    expect(blocksOf(tagged)).toEqual([["prose", 1], ["prose", 1], ["prose", 1]]);
    const untagged = apply(tagged, render(targetOf(tagged, 1), null));
    expect(untagged).toBe("a\n\nb\n\nc\n");
});

test("a marker left by an older studio goes with its directive", () => {
    const source = "a\n\n<!-- pac: prose size=large -->\nb\n\n<!-- pac: end -->\n\nc\n";
    expect(apply(source, render(targetOf(source, 1), null))).toBe("a\n\nb\n\nc\n");
});

test("removing a block takes its directive, its marker and the gap after it", () => {
    const source = "a\n\n<!-- pac: prose size=large -->\nb\n\n<!-- pac: end -->\n\nc\n";
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
