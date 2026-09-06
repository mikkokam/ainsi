import type { Block, Diagnostic, Directive, Entity } from "./types";
import type { Component, Registry } from "./registry";
import { alertKind } from "./components/alert/index";

/** a boundary and nothing else; decks written before directives governed one entity carry it */
export const END = "end";

/** Directives win where they apply; everything else falls to the heuristics. */
export function group(
    page: Entity[],
    directives: Directive[],
    registry: Registry,
    diagnostics: Diagnostic[],
): Block[] {
    const starts = new Map<string, Directive>();
    for (const d of directives) if (d.kind === "component" && d.before) starts.set(d.before, d);

    const blocks: Block[] = [];
    let i = 0;

    while (i < page.length) {
        const directive = starts.get(page[i]!.id);
        if (directive && directive.component !== END) {
            const component = registry.get(directive.component);
            const end = component ? extent(page, i, starts, component) : i + 1;
            const span = page.slice(i, end);
            if (!component) {
                diagnostics.push({
                    level: "warn",
                    message: `unknown component "${directive.component}"; falling back to the heuristic`,
                });
            } else if (!component.accepts(span)) {
                diagnostics.push({
                    level: "warn",
                    message: `component "${directive.component}" does not accept ${span.map(e => e.kind).join("+")}; falling back`,
                });
            } else {
                const props = component.props.safeParse(coerce(directive.props));
                if (!props.success) {
                    diagnostics.push({ level: "warn", message: `bad props for "${directive.component}": ${props.error.message}` });
                }
                blocks.push(make(span, directive.component, props.success ? props.data : {}, "directive"));
                i = end;
                continue;
            }
        }

        const [component, taken, props] = heuristic(page, i, blocks.length === 0, starts);
        // through the schema, so a heuristic block carries the same defaults a directive's does
        const parsed = registry.get(component)?.props.safeParse(props);
        blocks.push(make(page.slice(i, i + taken), component, parsed?.success ? parsed.data : props, "heuristic"));
        i += taken;
    }

    return blocks;
}

/**
 * A directive governs the entity it precedes, grown one entity at a time only until the
 * component accepts the span, and never past the next directive. So `prose size=large`
 * sizes one paragraph, and `timeline` before a heading and a list takes both.
 */
function extent(page: Entity[], from: number, starts: Map<string, Directive>, component: Component): number {
    let end = from + 1;
    while (!component.accepts(page.slice(from, end)) && end < page.length && !starts.has(page[end]!.id)) end++;
    return end;
}

function make(entities: Entity[], component: string, props: Record<string, unknown>, origin: Block["origin"]): Block {
    return {
        id: entities[0]!.id,
        span: [entities[0]!.id, entities[entities.length - 1]!.id],
        component,
        props,
        origin,
        entities,
    };
}

/**
 * Returns [component, entities consumed, props]. A list is a list: bullets or numbers as
 * written, until a directive names a component. Tables and images still pick a form,
 * because plain rendering of those rarely fits a page.
 */
function heuristic(
    page: Entity[],
    i: number,
    atPageTop: boolean,
    starts: Map<string, Directive>,
): [string, number, Record<string, unknown>] {
    const e = page[i]!;
    const next = page[i + 1];

    if (e.kind === "heading" && atPageTop && next?.kind === "paragraph" && !page[i + 2] && !starts.has(next.id)) {
        return ["lead", 2, {}];
    }

    if (alertKind(e)) return ["alert", 1, {}];

    if (e.kind === "table") {
        return [isComparison(e) ? "comparison" : "table", 1, {}];
    }

    if (e.kind === "image") {
        if (next?.kind === "paragraph") return ["aside", 2, {}];
        return ["full", 1, {}];
    }

    // prose absorbs the run of ordinary blocks so a page is not one block per paragraph,
    // but never past an entity a directive claims or one another heuristic could match
    const absorbed: Entity["kind"][] = ["paragraph", "heading", "quote", "code", "html", "list"];
    let taken = 1;
    while (page[i + taken] && absorbed.includes(page[i + taken]!.kind) && !starts.has(page[i + taken]!.id) && !alertKind(page[i + taken]!)) taken++;
    return ["prose", taken, {}];
}

function text(node: any): string {
    if (node.type === "text" || node.type === "inlineCode") return node.value;
    return (node.children ?? []).map(text).join("");
}

/** two columns, or a label column plus two, is a comparison; anything wider stays a table */
function isComparison(entity: Entity): boolean {
    const head: any[] = entity.node.children?.[0]?.children ?? [];
    if (head.length === 2) return true;
    return head.length === 3 && text(head[0]).trim() === "";
}

function coerce(props: Record<string, string>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
        if (v === "true" || v === "false") out[k] = v === "true";
        else if (/^-?\d+(\.\d+)?$/.test(v)) out[k] = Number(v);
        else out[k] = v;
    }
    return out;
}
