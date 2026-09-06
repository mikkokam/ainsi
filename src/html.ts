import { toHast } from "mdast-util-to-hast";
import { toHtml } from "hast-util-to-html";
import type { Entity } from "./types";

export function blockHtml(entity: Entity): string {
    const signed = entity.kind === "quote" ? signature(entity.node) : undefined;
    if (signed) {
        // `> — Name` as the last paragraph: the quote's attribution, lifted into a caption
        const [body, author] = signed;
        return `<figure class="pac-quote">${render(body)}<figcaption>${inlineHtml(author).replace(DASH, "")}</figcaption></figure>`;
    }
    return render(entity.node);
}

const render = (node: any): string =>
    // allowDangerousHtml: an html entity is html the author wrote and meant
    toHtml(toHast(marks(breaks(node)), { allowDangerousHtml: true }) as any, { allowDangerousHtml: true });

const DASH = /^\s*(—|–|--)\s*/;

/** [the blockquote without its last paragraph, that paragraph] when it opens with a dash */
export function signature(node: any): [any, any] | undefined {
    const paragraphs: any[] = node.children ?? [];
    const last = paragraphs.at(-1);
    if (paragraphs.length < 2 || last?.type !== "paragraph" || !DASH.test(plainText(last))) return undefined;
    return [{ ...node, children: paragraphs.slice(0, -1) }, last];
}

/** inline html for a node's children, so a component can place the text itself */
export function inlineHtml(node: any): string {
    const children = (marks(breaks(node))?.children ?? []).map((c: any) => toHast(c, { allowDangerousHtml: true })).filter(Boolean);
    return toHtml({ type: "root", children } as any, { allowDangerousHtml: true });
}

/** `==words==` is a highlight, the one inline mark markdown never got; `<mark>` written by hand is the same thing */
const HIGHLIGHT = /==(\S(?:[^=]*?\S)?)==/g;

export function marks(node: any): any {
    if (!node?.children) return node;
    const children = node.children.flatMap((child: any) => {
        if (child.type !== "text" || !HIGHLIGHT.test(child.value)) return [marks(child)];
        HIGHLIGHT.lastIndex = 0;
        const out: any[] = [];
        let at = 0;
        for (const hit of child.value.matchAll(HIGHLIGHT)) {
            if (hit.index! > at) out.push({ ...child, value: child.value.slice(at, hit.index) });
            out.push({ type: "html", value: "<mark>" }, { ...child, value: hit[1] }, { type: "html", value: "</mark>" });
            at = hit.index! + hit[0].length;
        }
        if (at < child.value.length) out.push({ ...child, value: child.value.slice(at) });
        return out;
    });
    return { ...node, children };
}

/**
 * A newline inside a paragraph is a line break, as in a chat box or a GitHub comment, so
 * nobody needs the two-trailing-spaces trick and Enter in the studio's editor does what it
 * looks like. Text nodes are the only place a soft break lives; code keeps its own value.
 */
export function breaks(node: any): any {
    if (!node?.children) return node;
    const children = node.children.flatMap((child: any) => {
        if (child.type !== "text" || !child.value.includes("\n")) return [breaks(child)];
        return child.value.split("\n").flatMap((line: string, i: number) =>
            (i === 0 ? [] : [{ type: "break" }]).concat(line ? [{ ...child, value: line }] : []));
    });
    return { ...node, children };
}

export function plainText(node: any): string {
    if (!node) return "";
    if (node.type === "text" || node.type === "inlineCode") return node.value;
    return (node.children ?? []).map(plainText).join("");
}

export function escape(value: string): string {
    return value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
