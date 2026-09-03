/** What a component author imports. Everything else is theirs. */
export type { Component, ComponentDefinition, RenderContext } from "./registry";
export type { Entity } from "./types";
export { escape, plainText } from "./html";
import { plainText as plain } from "./html";
import type { Entity } from "./types";
import type { RenderContext } from "./registry";

/** `Q1: Datamalli` -> ["Q1", "Datamalli"]; no colon -> ["", text] */
export function split(text: string): [string, string] {
    const at = text.indexOf(":");
    return at === -1 ? ["", text.trim()] : [text.slice(0, at).trim(), text.slice(at + 1).trim()];
}

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

export const items = (list: Entity): string[] =>
    (list.node.children ?? []).map((li: any) => plain(li));
