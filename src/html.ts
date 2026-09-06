import { toHast } from "mdast-util-to-hast";
import { toHtml } from "hast-util-to-html";
import type { Entity } from "./types";

export function blockHtml(entity: Entity): string {
    // allowDangerousHtml: an html entity is html the author wrote and meant
    return toHtml(toHast(breaks(entity.node), { allowDangerousHtml: true }) as any, { allowDangerousHtml: true });
}

/** inline html for a node's children, so a component can place the text itself */
export function inlineHtml(node: any): string {
    const children = (breaks(node)?.children ?? []).map((c: any) => toHast(c)).filter(Boolean);
    return toHtml({ type: "root", children } as any);
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
