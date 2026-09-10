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

/** the run of directive lines a target's span opens with, as text */
const runOf = (source: string, target: Target): string =>
    target.directive ? source.slice(target.directive.start, target.start) : "";

const LAYOUT = /<!--\s*ainsi\s*:?\s*layout\b/;

/**
 * A layout directive sets the page it sits on, so it may neither travel with a block that
 * moves nor be pushed down the page by one landing above it: either puts a page boundary in
 * the middle of the page it opened. A move that would do it is refused rather than performed,
 * because the alternative is reordering a directive run the author wrote.
 */
export function strands(source: string, block: Target, target: Target, side: "before" | "after"): boolean {
    if (LAYOUT.test(runOf(source, block))) return true;
    return side === "before" && LAYOUT.test(runOf(source, target));
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

/*
 * A markdown table as a grid, and back.
 *
 * The rendering varies: bar-table draws bars, comparison draws columns, matrix draws a field.
 * The source never does. So an editor works on this shape and serves every component that
 * takes a table, and nothing here knows which one is drawing it.
 */
export type Align = "left" | "center" | "right";
export interface Grid { head: string[]; rows: string[][]; align: Align[] }

/** a cell's own text, with the pipes it escaped put back as pipes */
const cells = (line: string): string[] =>
    line.replace(/^\s*\|/, "").replace(/\|\s*$/, "")
        .split(/(?<!\\)\|/)
        .map(cell => cell.trim().replace(/\\\|/g, "|"));

const ALIGN = /^:?-{1,}:?$/;

export function toGrid(md: string): Grid | undefined {
    const lines = md.trim().split("\n").filter(line => line.trim());
    if (lines.length < 2) return undefined;
    const head = cells(lines[1]!);
    if (!head.length || !head.every(cell => ALIGN.test(cell))) return undefined;
    const align = head.map<Align>(cell =>
        cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
    const width = align.length;
    const fit = (row: string[]) => Array.from({ length: width }, (_, i) => row[i] ?? "");
    return { head: fit(cells(lines[0]!)), rows: lines.slice(2).map(line => fit(cells(line))), align };
}

export function toMarkdown(grid: Grid): string {
    const escape = (cell: string) => cell.replace(/\|/g, "\\|").trim();
    const body = [grid.head, ...grid.rows].map(row => row.map(escape));
    const rule = grid.align.map(a => (a === "center" ? ":---:" : a === "right" ? "---:" : "---"));
    // padded to the widest cell in each column, so the source reads as a table in a plain editor
    const width = grid.align.map((_, i) => Math.max(rule[i]!.length, ...body.map(row => row[i]?.length ?? 0)));
    const pad = (cell: string, i: number, a: Align) => {
        const room = width[i]! - cell.length;
        if (a === "right") return " ".repeat(room) + cell;
        if (a === "center") return " ".repeat(Math.floor(room / 2)) + cell + " ".repeat(Math.ceil(room / 2));
        return cell + " ".repeat(room);
    };
    const line = (row: string[]) => `| ${row.map((cell, i) => pad(cell, i, grid.align[i]!)).join(" | ")} |`;
    return [line(body[0]!), line(rule.map((cell, i) => pad(cell, i, grid.align[i]!))), ...body.slice(1).map(line)].join("\n");
}

/*
 * A markdown list as its items, and back.
 *
 * Same bargain as the table: what draws it varies, timeline draws a spine and boxes draws
 * panels, and the source is a list of items either way. What this cannot round-trip faithfully
 * it refuses, so a list holding a paragraph or a nested block falls back to the raw editor
 * rather than being flattened by an editor that did not understand it.
 */
export interface Items { ordered: boolean; items: { depth: number; text: string }[] }

const ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*)$/;

export function toItems(md: string): Items | undefined {
    const lines = md.trim().split("\n");
    if (!lines.length) return undefined;
    // every line, blanks included: a list written loose renders differently from a tight one,
    // and an editor that dropped the blanks would tighten it without saying so
    const parsed = lines.map(line => ITEM.exec(line));
    if (parsed.some(match => !match)) return undefined;

    // the shallowest indent is depth zero, and every deeper one counts in units of it
    const indents = parsed.map(match => match![1]!.replace(/\t/g, "  ").length);
    const step = Math.min(...indents.filter(n => n > 0).concat(2));
    return {
        ordered: /^\s*\d/.test(lines[0]!),
        items: parsed.map((match, i) => ({ depth: Math.round(indents[i]! / step), text: match![2]!.trim() })),
    };
}

export function toList(list: Items): string {
    const counts: number[] = [];
    return list.items.map(({ depth, text }) => {
        counts.length = depth + 1;
        counts[depth] = (counts[depth] ?? 0) + 1;
        const marker = list.ordered ? `${counts[depth]}.` : "-";
        return `${"  ".repeat(depth)}${marker} ${text}`;
    }).join("\n");
}

/*
 * The deck's own settings: the frontmatter, edited a line at a time. A comment, a key this
 * build has never heard of and the order the lines were written in all survive an edit, which
 * is what a panel of fields over someone else's file has to promise.
 */
export const MATTER = /^---\n([\s\S]*?)\n---\n*/;   // the blank lines after it go with it; the commit writes its own

/** every key the parser reads, with what it means when the line is absent */
export const SETTINGS = [
    { key: "theme", name: "theme", kind: "choice", fallback: "default" },
    { key: "layout", name: "layout", kind: "choice", fallback: "default" },
    { key: "ratio", name: "ratio", kind: "choice", fallback: "16:9" },
    { key: "numbers", name: "page numbers", kind: "switch", fallback: "on", options: ["on", "off"] },
    { key: "h1StartsPage", name: "h1 starts a page", kind: "switch", fallback: "false", options: ["true", "false"] },
    { key: "logo", name: "logo", kind: "picture", fallback: "" },
    { key: "coverLogo", name: "cover logo", kind: "picture", fallback: "" },
] as const;

/** the ratios worth offering; a deck may still say any w:h and the field keeps it */
export const RATIOS = ["16:9", "16:10", "3:2", "4:3", "1:1"];

/** the value on a `key: value` line, or the fallback when the deck does not say */
export function matterValue(lines: string[], key: string, fallback: string): string {
    const line = lines.find(one => one.startsWith(`${key}:`));
    return line === undefined ? fallback : line.slice(key.length + 1).trim();
}


/** a frontmatter line this panel does not own: a comment, or a key from a build that knew more */
export const isOther = (line: string): boolean => !SETTINGS.some(setting => line.startsWith(`${setting.key}:`));

/*
 * The block back, a line at a time: a key at its fallback loses its line, a key that changed
 * keeps its place in the file, and a key that is new goes at the end. Everything this panel
 * does not own is copied through untouched, which is what makes it safe to open on a deck
 * whose frontmatter says more than this build knows about.
 */
export function writeMatter(lines: string[], values: Map<string, string>): string {
    const out = lines.filter(line => {
        const owner = SETTINGS.find(setting => line.startsWith(`${setting.key}:`));
        return !owner || values.get(owner.key) !== owner.fallback;
    }).map(line => {
        const owner = SETTINGS.find(setting => line.startsWith(`${setting.key}:`));
        return owner ? `${owner.key}: ${values.get(owner.key)}` : line;
    });
    for (const setting of SETTINGS) {
        const value = values.get(setting.key)!;
        if (value === setting.fallback || lines.some(line => line.startsWith(`${setting.key}:`))) continue;
        out.push(`${setting.key}: ${value}`);
    }
    return out.join("\n");
}
