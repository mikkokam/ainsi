export type EntityKind =
    | "heading" | "paragraph" | "list" | "table" | "image"
    | "code" | "quote" | "break" | "html";

export interface Entity {
    id: string;
    kind: EntityKind;
    depth?: number;
    ordered?: boolean;
    text: string;
    md: string;
    node: any;
}

export interface Directive {
    /** "layout" is reserved: a page-level directive, never a component */
    kind: "component" | "layout";
    component: string;
    props: Record<string, string>;
    /** id of the entity this directive precedes; null when it precedes nothing */
    before: string | null;
    /** source offsets of the comment, so an editor can replace or remove it */
    start: number;
    end: number;
}

export interface Settings {
    theme: string;
    ratio: string;
    h1StartsPage: boolean;
    /** page numbers on every page but a cover; off hides them from print, export and presenting, never from the reading view */
    numbers: boolean;
    /** the deck's house layout; a page directive is an exception lasting one page */
    layout: string;
    /** the deck's mark, a path beside the deck or a url; the theme places it */
    logo?: string;
    /** the mark the cover wears instead, when a brand has one; falls back to the mark */
    coverLogo?: string;
}

export interface Source {
    settings: Settings;
    entities: Entity[];
    directives: Directive[];
}

export interface Block {
    id: string;
    span: [string, string];
    component: string;
    props: Record<string, unknown>;
    origin: "directive" | "heuristic";
    entities: Entity[];
}

export interface Page {
    index: number;
    blocks: Block[];
    layout: string;
    layoutProps: Record<string, unknown>;
    /** the type scale the fit solver settled on; 1 unless it stepped down */
    scale: number;
    /** the ladder ran out and this page is clipped; rendered anyway, and flagged */
    overflow: boolean;
}

export interface Diagnostic {
    level: "warn" | "error";
    message: string;
}
