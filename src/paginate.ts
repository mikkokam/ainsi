import type { Entity, Settings } from "./types";

/**
 * Page candidates only. Breaks, h1 and layout directives are authored, so they resolve
 * before grouping, which the `lead` heuristic needs. The fit solver may split a candidate
 * further; it never merges two.
 */
export function paginate(entities: Entity[], settings: Settings, layoutStarts: Set<string> = new Set()): Entity[][] {
    const pages: Entity[][] = [];
    let current: Entity[] = [];

    const flush = () => { if (current.length) pages.push(current); current = []; };

    for (const entity of entities) {
        if (entity.kind === "break") { flush(); continue; }
        if (layoutStarts.has(entity.id)) flush();
        if (settings.h1StartsPage && entity.kind === "heading" && entity.depth === 1) flush();
        current.push(entity);
    }
    flush();
    return pages;
}
