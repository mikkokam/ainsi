import type { ZodTypeAny } from "zod";
import type { Entity } from "./types";

export interface RenderContext {
    entities: Entity[];
    props: Record<string, unknown>;
    /** block-level html for one entity, inline marks preserved */
    html: (entity: Entity) => string;
    /** inline html for the children of an mdast node */
    inline: (node: any) => string;
    /** plain text of an mdast node */
    text: (node: any) => string;
}

/** what a component folder's index.ts default-exports; the name comes from the folder */
export interface ComponentDefinition {
    /** one line on what the component takes and does with it; the studio shows it where the component is picked */
    about: string;
    accepts: (entities: Entity[]) => boolean;
    props: ZodTypeAny;
    splittable: boolean;
    /** variants the fit solver may step through, loosest first */
    density: string[];
    render: (ctx: RenderContext) => string;
}

export interface Component extends ComponentDefinition {
    /** the folder name; never restated inside the folder */
    name: string;
    /** style.css, emitted once per deck if any block uses this component */
    css?: string;
    /** script.ts or script.js, bundled and scoped to this component's roots */
    script?: string;
}

export interface LayoutContext {
    /** every block of the page, already rendered; a layout places it and stops there */
    content: string;
    props: Record<string, unknown>;
    index: number;
    total: number;
}

/** what a layout folder's index.ts default-exports; the name comes from the folder */
export interface LayoutDefinition {
    props: ZodTypeAny;
    render: (ctx: LayoutContext) => string;
}

export interface Layout extends LayoutDefinition {
    name: string;
    css?: string;
}

/** A component or layout as the engine is handed it: what it is called, what it does, its css. */
export interface Entry<D> { name: string; definition: D; css?: string }

export class Registry {
    private readonly map = new Map<string, Component>();

    register(component: Component, options: { replace?: boolean } = {}): this {
        if (this.map.has(component.name) && !options.replace) {
            throw new Error(`duplicate component: ${component.name}`);
        }
        this.map.set(component.name, component);
        return this;
    }

    get(name: string): Component | undefined {
        return this.map.get(name);
    }

    names(): string[] {
        return [...this.map.keys()];
    }

    all(): Component[] {
        return [...this.map.values()];
    }
}

export class Layouts {
    private readonly map = new Map<string, Layout>();

    register(layout: Layout): this {
        this.map.set(layout.name, layout);
        return this;
    }

    get(name: string): Layout | undefined {
        return this.map.get(name);
    }

    names(): string[] {
        return [...this.map.keys()];
    }

    all(): Layout[] {
        return [...this.map.values()];
    }
}

/** a directive's props as written, with `true`, `false` and numbers read as themselves */
export function coerce(props: Record<string, string>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
        if (v === "true" || v === "false") out[k] = v === "true";
        else if (/^-?\d+(\.\d+)?$/.test(v)) out[k] = Number(v);
        else out[k] = v;
    }
    return out;
}

/*
 * Every props schema passes unknown keys through, because a block carries keys a directive never
 * wrote. That is also how `columns color=accent` parses clean and then does nothing: the schema
 * accepts it, the renderer never reads it, and the deck keeps a prop that has never once had an
 * effect. The schema cannot report that; this can, for the keys a person actually typed.
 */
export function strayProps(schema: ZodTypeAny, props: Record<string, string>): string[] {
    const shape = (schema as { shape?: Record<string, unknown> }).shape;
    if (!shape) return [];
    return Object.keys(props).filter(key => !(key in shape));
}
