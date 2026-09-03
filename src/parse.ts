import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { toString as mdToString } from "mdast-util-to-string";
import { parse as parseYaml } from "yaml";
import type { Diagnostic, Directive, Entity, EntityKind, Settings, Source } from "./types";

const DEFAULTS: Settings = { theme: "default", ratio: "16:9", h1StartsPage: true, layout: "default" };

const DIRECTIVE = /^<!--\s*pac\s*:\s*([\s\S]*?)\s*-->$/;
const LAYOUT = "layout";

const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml"]);

/** `timeline axis=horizontal cols="two words"` -> name + props */
export function parseDirectiveBody(body: string): Omit<Directive, "before"> | null {
    const tokens = body.match(/[^\s"]+="[^"]*"|[^\s"]+/g);
    if (!tokens || tokens.length === 0) return null;
    const layout = tokens[0] === LAYOUT;
    const component = layout ? tokens[1] : tokens[0];
    if (!component || component.includes("=")) return null;
    const props: Record<string, string> = {};
    for (const token of tokens.slice(layout ? 2 : 1)) {
        const eq = token.indexOf("=");
        if (eq === -1) { props[token] = "true"; continue; }
        props[token.slice(0, eq)] = token.slice(eq + 1).replace(/^"|"$/g, "");
    }
    return { kind: layout ? "layout" : "component", component, props };
}

function kindOf(node: any): EntityKind | null {
    switch (node.type) {
        case "heading": return "heading";
        case "list": return "list";
        case "table": return "table";
        case "code": return "code";
        case "blockquote": return "quote";
        case "thematicBreak": return "break";
        case "html": return "html";
        case "paragraph":
            // a paragraph holding nothing but an image is an image entity, not a flow
            return node.children?.length === 1 && node.children[0].type === "image" ? "image" : "paragraph";
        default: return null;
    }
}

export function parse(source: string): { doc: Source; diagnostics: Diagnostic[] } {
    const diagnostics: Diagnostic[] = [];
    const tree: any = processor.parse(source);

    let settings: Settings = { ...DEFAULTS };
    const entities: Entity[] = [];
    const directives: Directive[] = [];
    const pending: Omit<Directive, "before">[] = [];
    const seen = new Map<string, number>();

    for (const node of tree.children as any[]) {
        if (node.type === "yaml") {
            try {
                settings = { ...DEFAULTS, ...(parseYaml(node.value) ?? {}) };
            } catch (e) {
                diagnostics.push({ level: "warn", message: `frontmatter is not valid YAML: ${String(e)}` });
            }
            continue;
        }

        if (node.type === "html" && node.value.trim().startsWith("<!--")) {
            const match = DIRECTIVE.exec(node.value.trim());
            if (!match) continue;                       // an ordinary comment, not ours
            const parsed = parseDirectiveBody(match[1]!);
            if (!parsed) {
                diagnostics.push({ level: "warn", message: `directive names no component: ${node.value.trim()}` });
                continue;
            }
            pending.push(parsed);
            continue;
        }

        const kind = kindOf(node);
        if (!kind) continue;

        const text = mdToString(node);
        const key = `${kind}:${text}`;
        const ordinal = seen.get(key) ?? 0;
        seen.set(key, ordinal + 1);

        const entity: Entity = {
            id: `e:${hash(key)}:${ordinal}`,
            kind,
            text,
            md: source.slice(node.position.start.offset, node.position.end.offset),
            node,
            ...(kind === "heading" ? { depth: node.depth } : {}),
            ...(kind === "list" ? { ordered: !!node.ordered } : {}),
        };
        entities.push(entity);

        while (pending.length) directives.push({ ...pending.shift()!, before: entity.id });
    }

    for (const orphan of pending) {
        diagnostics.push({ level: "warn", message: `directive "${orphan.component}" governs nothing; ignored` });
    }

    return { doc: { settings, entities, directives }, diagnostics };
}

function hash(input: string): string {
    return Bun.hash(input).toString(16).padStart(16, "0").slice(0, 6);
}
