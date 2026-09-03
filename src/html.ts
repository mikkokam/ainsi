import { toHast } from "mdast-util-to-hast";
import { toHtml } from "hast-util-to-html";
import type { Entity } from "./types";

export function blockHtml(entity: Entity): string {
    // allowDangerousHtml: an html entity is html the author wrote and meant
    return toHtml(toHast(entity.node, { allowDangerousHtml: true }) as any, { allowDangerousHtml: true });
}

/** inline html for a node's children, so a component can place the text itself */
export function inlineHtml(node: any): string {
    const children = (node?.children ?? []).map((c: any) => toHast(c)).filter(Boolean);
    return toHtml({ type: "root", children } as any);
}

export function plainText(node: any): string {
    if (!node) return "";
    if (node.type === "text" || node.type === "inlineCode") return node.value;
    return (node.children ?? []).map(plainText).join("");
}

export function escape(value: string): string {
    return value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
