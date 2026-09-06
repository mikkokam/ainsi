/** What a component author imports. Everything else is theirs. */
export type { Component, ComponentDefinition, RenderContext } from "./registry";
export type { Entity } from "./types";
export { escape, plainText, signature } from "./html";
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
 * Each item as [label, body] inline html. A label is a leading bold run, `- **Q1** shipped`,
 * the one markdown idiom for a lead-in that reads the same everywhere; nothing else in the
 * text is read as structure. No leading bold: ["", the whole item].
 */
export const labelled = (list: Entity, inline: (node: any) => string): [string, string][] =>
    (list.node.children ?? []).map((li: any) => {
        const para = li.children?.find((c: any) => c.type === "paragraph") ?? li;
        const [first, ...rest] = para.children ?? [];
        if (first?.type !== "strong") return ["", inline(para).trim()];
        return [inline(first).trim(), inline({ ...para, children: rest }).trim()];
    });
