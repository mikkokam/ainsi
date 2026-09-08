import { z } from "zod";

/** What a component author imports. Everything else is theirs. */
export type { Component, ComponentDefinition, RenderContext } from "./registry";
export type { Entity } from "./types";
export { escape, plainText, signature } from "./html";
import type { Entity } from "./types";
import type { RenderContext } from "./registry";
import { PLACEHOLDER } from "./placeholder";

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
    const mark = image.src ? "" : " data-ainsi-placeholder";
    return `<img${cls}${mark} src="${escapeAttr(image.src || PLACEHOLDER)}" alt="${escapeAttr(image.alt)}">`;
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * The one size a deck may name on a component: a step on the theme's scale, never a
 * measurement. Spread into a component's props where its content is prose a reader reads;
 * a picture and a figure have their own sizes and this is not one of them.
 */
export const textSize = { text: z.enum(["small", "normal", "large"]).default("normal") };

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
        // a title written on its own line leaves a break at the head of the body, which renders as
        // a blank line above it and reads as a spacing bug in every labelled component
        while (rest[0]?.type === "break" || (rest[0]?.type === "text" && !rest[0].value.trim())) rest.shift();
        if (rest[0]?.type === "text") rest[0] = { ...rest[0], value: rest[0].value.replace(/^[^\S\n]*\n\s*/, "") };
        return [inline(first).trim(), inline({ ...para, children: rest }).trim()];
    });
