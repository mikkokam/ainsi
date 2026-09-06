/** What a component author imports. Everything else is theirs. */
export type { Component, ComponentDefinition, RenderContext } from "./registry";
export type { Entity } from "./types";
export { escape, plainText } from "./html";
import type { Entity } from "./types";
import type { RenderContext } from "./registry";

/** every entity in the span, rendered as markdown would render it */
export const flow = (ctx: RenderContext): string => ctx.entities.map(e => ctx.html(e)).join("\n");

export const kinds = (...allowed: Entity["kind"][]) => (entities: Entity[]) =>
    entities.length > 0 && entities.every(e => allowed.includes(e.kind));

export interface Image { src: string; alt: string; title?: string }

/** an image entity is a paragraph holding one image; components want the image, not the wrapper */
export function imageOf(entity: Entity): Image | undefined {
    const node = entity.node.type === "image" ? entity.node : entity.node.children?.[0];
    if (node?.type !== "image") return undefined;
    return { src: node.url, alt: node.alt ?? "", ...(node.title ? { title: node.title } : {}) };
}

export function img(image: Image, className?: string): string {
    const cls = className ? ` class="${className}"` : "";
    return `<img${cls} src="${escapeAttr(image.src)}" alt="${escapeAttr(image.alt)}">`;
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export const listOf = (entities: Entity[]): Entity | undefined => entities.find(e => e.kind === "list");

/**
 * Each item as [label, body] inline html, split at the first colon in its text. The cut is
 * made in the tree, not the rendered string, so `**Q1:** shipped` keeps its bold and a link
 * on either side stays a link. No colon: ["", the whole item].
 */
export const labelled = (list: Entity, inline: (node: any) => string): [string, string][] =>
    (list.node.children ?? []).map((li: any) => {
        const para = li.children?.find((c: any) => c.type === "paragraph") ?? li;
        const [head, tail] = cut(para);
        return head ? [inline(head).trim(), inline(tail).trim()] : ["", inline(para).trim()];
    });

function cut(node: any): [any | undefined, any] {
    const children: any[] = node.children ?? [];
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === "text" && child.value.includes(":")) {
            const at = child.value.indexOf(":");
            return [
                prune({ ...node, children: [...children.slice(0, i), { ...child, value: child.value.slice(0, at) }] }),
                prune({ ...node, children: [{ ...child, value: child.value.slice(at + 1) }, ...children.slice(i + 1)] }),
            ];
        }
        if (child.children) {
            const [head, tail] = cut(child);
            if (head) {
                return [
                    prune({ ...node, children: [...children.slice(0, i), head] }),
                    prune({ ...node, children: [tail, ...children.slice(i + 1)] }),
                ];
            }
        }
    }
    return [undefined, node];
}

/** a split leaves empty text and emptied marks behind; they would render as `<strong></strong>` */
function prune(node: any): any {
    if (!node.children) return node;
    const children = node.children.map(prune).filter((c: any) => (c.type === "text" ? c.value !== "" : !(c.children && c.children.length === 0)));
    return { ...node, children };
}
