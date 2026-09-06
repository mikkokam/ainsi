/*
 * Structural edits as pure functions over the source: what the studio splices when a block
 * changes kind or component. No DOM, no fetch, so a test covers every write the popover can
 * make. Nothing here serialises HTML; every input and output is markdown.
 */

export interface Splice { start: number; end: number; text: string }

export type TextKind = "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "paragraph" | "list" | "ordered" | "quote" | "code";

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

/** `boxes` + {stretch: true, axis: "two words"} -> `<!-- pac: boxes stretch axis="two words" -->` */
export function directiveLine(component: string, props: Record<string, unknown> = {}): string {
    const tokens = Object.entries(props).map(([key, value]) => {
        if (value === true) return key;
        const text = String(value);
        return /[\s"]/.test(text) ? `${key}="${text.replace(/"/g, "")}"` : `${key}=${text}`;
    });
    return `<!-- pac: ${[component, ...tokens].join(" ")} -->`;
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
