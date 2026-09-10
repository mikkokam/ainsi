/*
 * Structural edits as pure functions over the source: what the studio splices when a block
 * changes kind or component. No DOM, no fetch, so a test covers every write the popover can
 * make. Nothing here serialises HTML; every input and output is markdown.
 */

export interface Splice { start: number; end: number; text: string }

export type TextKind = "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "paragraph" | "list" | "ordered" | "quote" | "alert" | "code";

/** the entity kinds that are words with syntax around them; table and image carry what text cannot */
export const textShaped = (kind: string): boolean => ["heading", "paragraph", "list", "quote", "code"].includes(kind);

/** the slice's lines with their leading syntax stripped; a list gives one line per item */
function lines(md: string, kind: string): string[] {
    switch (kind) {
        case "heading":
            return [md.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "")];
        case "quote":
            return md.split("\n").map(line => line.replace(/^>\s?/, ""));
        case "code":
            return md.split("\n").filter(line => !/^\s*(```|~~~)/.test(line));
        case "list": {
            const items: string[] = [];
            for (const line of md.split("\n")) {
                const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
                if (item) items.push(item[1]!);
                else if (items.length) items[items.length - 1] += ` ${line.trim()}`;
            }
            return items;
        }
        default:
            return md.split("\n");
    }
}

/** the marker a list opens with; two adjacent lists with the same one are one list to markdown */
export function markerOf(md: string): string | undefined {
    return /^\s*([-*+]|\d+[.)])\s/.exec(md)?.[1]?.replace(/\d+/, "1");
}

/**
 * The same words as another kind of block. `neighbours` are the markers of the lists on
 * either side, so a new list takes one they do not use and stays a list of its own.
 */
export function retag(md: string, kind: string, to: TextKind, neighbours: (string | undefined)[] = []): string {
    if (to === "alert") return withAlert(md, kind, alertOf(md) ?? "note");
    if (kind === "quote" && alertOf(md)) md = withAlert(md, kind, null);   // out of an alert: the marker goes first
    const body = lines(md, kind).map(line => line.trim()).filter(Boolean);
    const free = (choices: string[]) => choices.find(c => !neighbours.includes(c)) ?? choices[0]!;
    switch (to) {
        case "heading1": return `# ${body.join(" ")}`;
        case "heading2": return `## ${body.join(" ")}`;
        case "heading3": return `### ${body.join(" ")}`;
        case "heading4": return `#### ${body.join(" ")}`;
        case "heading5": return `##### ${body.join(" ")}`;
        case "list": { const m = free(["-", "*", "+"]); return body.map(line => `${m} ${line}`).join("\n"); }
        case "ordered": { const m = free(["1.", "1)"]); return body.map((line, i) => `${m.replace("1", String(i + 1))} ${line}`).join("\n"); }
        case "quote": return body.map(line => `> ${line}`).join("\n");
        case "code": return ["```", ...(kind === "code" ? lines(md, kind) : md.split("\n")), "```"].join("\n");   // the source as written, fenced
        default: return body.join("\n");
    }
}

/** `boxes` + {stretch: true, axis: "two words"} -> `<!-- ainsi: boxes stretch axis="two words" -->` */
export function directiveLine(component: string, props: Record<string, unknown> = {}): string {
    const tokens = Object.entries(props).map(([key, value]) => {
        if (value === true) return key;
        const text = String(value);
        return /[\s"]/.test(text) ? `${key}="${text.replace(/"/g, "")}"` : `${key}=${text}`;
    });
    return `<!-- ainsi: ${[component, ...tokens].join(" ")} -->`;
}

export interface Target {
    /** the entity's own slice */
    start: number;
    end: number;
    md: string;
    kind: string;
    /** the comment already governing it, when there is one */
    directive?: { start: number; end: number };
    /** an end marker left by an earlier studio, taken along when the directive goes */
    terminator?: { start: number; end: number };
}

/**
 * One splice from the directive (or the entity) to the terminator (or the entity): the
 * directive line and the body. A null component removes the directive and leaves the body.
 */
export function render(target: Target, component: string | null, props: Record<string, unknown> = {}): Splice {
    const start = target.directive?.start ?? target.start;
    const end = target.terminator?.end ?? target.end;
    if (!component) return { start, end, text: target.md };
    return { start, end, text: `${directiveLine(component, props)}\n${target.md}` };
}

/** the block, its directive and its marker, and the blank lines that separated it from the next */
export function remove(source: string, target: Target): Splice {
    const start = target.directive?.start ?? target.start;
    let end = target.terminator?.end ?? target.end;
    while (end < source.length && /\s/.test(source[end]!)) end++;
    return { start, end, text: "" };
}

export interface PageTarget {
    /** offset of the page's first entity */
    first: number;
    /** offset just past the page's last entity, or past the end marker closing its last block */
    last: number;
    /** the layout directive already governing the page, when there is one */
    directive?: { start: number; end: number };
    /** the page starts here only because of that directive; removing it would merge pages */
    held?: boolean;
}

/**
 * One splice that sets a page's layout and props. The deck's own layout with no props means
 * no directive: an existing one is removed unless it is what breaks the page, and a missing
 * one is not written. Undefined means the file already says this.
 */
export function relayout(source: string, page: PageTarget, deck: string, name: string, props: Record<string, unknown> = {}): Splice | undefined {
    const line = directiveLine(`layout ${name}`, props);
    const bare = name === deck && Object.keys(props).length === 0;
    if (!page.directive) return bare ? undefined : { start: page.first, end: page.first, text: `${line}\n` };
    if (!bare || page.held) return { start: page.directive.start, end: page.directive.end, text: line };
    let end = page.directive.end;
    while (end < page.first && /\s/.test(source[end]!)) end++;
    return { start: page.directive.start, end, text: "" };
}

/** A new page after this one: a break and the text, spliced past the page's last entity so a following break or directive keeps its place. */
export function addPage(page: PageTarget, text: string): Splice {
    return { start: page.last, end: page.last, text: `\n\n---\n\n${text.trim()}` };
}

/**
 * The page, its directive and the break that separated it: the one after, or for the last
 * page the one before. A break is `---` on its own line after a blank line; frontmatter's
 * closing `---` follows a key line and stays.
 */
export function removePage(source: string, page: PageTarget): Splice {
    let start = page.directive?.start ?? page.first;
    let end = page.last;
    while (end < source.length && /\s/.test(source[end]!)) end++;
    const after = /^---[ \t]*(?:\n|$)/.exec(source.slice(end));
    if (after) {
        end += after[0].length;
        while (end < source.length && /\s/.test(source[end]!)) end++;
        return { start, end, text: "" };
    }
    while (start > 0 && /\s/.test(source[start - 1]!)) start--;
    const before = /(?:^|\n[ \t]*\n)---[ \t]*$/.exec(source.slice(0, start));
    if (before) {
        start -= 3;
        while (start > 0 && /\s/.test(source[start - 1]!)) start--;
    }
    return { start, end, text: "" };
}

/** GitHub's alert kinds; the marker is the quote's first line, so a kind change is a rewrite of that line */
export const ALERT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
const ALERT = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\S\n]*\n?/;

export const alertOf = (md: string): string | undefined => ALERT.exec(md)?.[1]?.toLowerCase();

/** the same words as an alert of `to`, or as a plain quote when `to` is null; text becomes a quote first */
export function withAlert(md: string, kind: string, to: string | null): string {
    const quote = kind === "quote" ? md.replace(ALERT, "") : retag(md, kind, "quote");
    const body = quote.trim() ? quote : ">";
    return to ? `> [!${to.toUpperCase()}]\n${body}` : body;
}

export interface Span { start: number; end: number }

/** what a block occupies: its directive line through the marker closing it */
const spanOf = (target: Target): Span => ({ start: target.directive?.start ?? target.start, end: target.terminator?.end ?? target.end });

/**
 * What a page occupies: every directive line standing above its first entity through its last.
 * A `PageTarget` starts at the entity, so a component directive governing the page's opening
 * block sits outside it, and a page moved or edited by that offset would leave it behind.
 * An end marker there closes the page before and stays with it.
 */
export function pageSpan(source: string, page: PageTarget): Span {
    let start = page.directive?.start ?? page.first;
    for (;;) {
        let at = start;
        while (at > 0 && /\s/.test(source[at - 1]!)) at--;
        const line = /(<!--\s*ainsi\b[^>]*-->)[ \t]*$/.exec(source.slice(0, at));
        if (!line || /^<!--\s*ainsi\s*:?\s*end\b/.test(line[1]!)) return { start, end: page.last };
        start = at - line[1]!.length;
    }
}

/**
 * Two neighbouring spans swapped, as one splice over the pair rather than two writes: the
 * write path takes one range against one hash, and a move landing half of itself is a
 * corrupted file. `between` decides what separates them afterwards; keeping it is the default.
 */
function swap(source: string, one: Span, two: Span, between: (was: string) => string = was => was): Splice {
    const [a, b] = one.start <= two.start ? [one, two] : [two, one];
    const text = source.slice(b.start, b.end) + between(source.slice(a.end, b.start)) + source.slice(a.start, a.end);
    return { start: a.start, end: b.end, text };
}

/**
 * A block and its neighbour swapped, either way round. The gap between them is kept, unless
 * it holds no blank line: a heading and the paragraph glued under it are two blocks, and
 * swapping them without one would make a list swallow the paragraph as a continuation line.
 */
/*
 * A block lifted out and put down after another, however far away it is. `move` swaps two
 * neighbours, which is what the up and down buttons want; a drag lands anywhere, so the whole
 * region between the two is rewritten in one splice rather than a swap repeated.
 */
export function moveTo(source: string, block: Target, target: Target, side: "before" | "after" = "after", gap = "\n\n"): Splice | undefined {
    const from = spanOf(block);
    const to = spanOf(target);
    if (from.start === to.start) return undefined;
    const held = source.slice(from.start, from.end);
    const onto = source.slice(to.start, to.end);

    if (from.start < to.start) {
        // downwards: what followed it closes up, and the block lands beside the target
        const between = source.slice(from.end, to.start).replace(/^\s+/, "");
        const text = side === "after" ? `${between}${onto}${gap}${held}` : `${between}${held}${gap}${onto}`;
        return settled(source, { start: from.start, end: to.end, text });
    }
    // upwards: the block lands beside the target, and what was between follows it
    const between = source.slice(to.end, from.start);
    const text = side === "after" ? `${onto}${gap}${held}${between}` : `${held}${gap}${onto}${between}`;
    return settled(source, { start: to.start, end: from.end, text: text.replace(/\s+$/, "") });
}

/** a move that changes nothing is not a move: dropping a block just above the one it already
 *  sits above is the ordinary way to land here, and it should not write the file */
function settled(source: string, splice: Splice): Splice | undefined {
    return source.slice(splice.start, splice.end) === splice.text ? undefined : splice;
}

export function move(source: string, block: Target, neighbour: Target): Splice {
    return swap(source, spanOf(block), spanOf(neighbour), was => (/\n[ \t]*\n/.test(was) ? was : "\n\n"));
}

/**
 * Two pages swapped. A page whose layout directive is its only break leaves an implicit one
 * behind when it moves down, so the pair gets an explicit `---` unless the page now second
 * carries a directive of its own. Writing a break where one already resolved changes nothing.
 */
export function movePage(source: string, page: PageTarget, neighbour: PageTarget): Splice {
    const [a, b] = page.first <= neighbour.first ? [page, neighbour] : [neighbour, page];
    return swap(source, pageSpan(source, a), pageSpan(source, b), was => (a.held || /(^|\n)---[ \t]*(\n|$)/.test(was) ? was : "\n\n---\n\n"));
}
