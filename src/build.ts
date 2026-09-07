import { parse } from "./parse";
import { paginate } from "./paginate";
import { group } from "./group";
import { blockHtml, inlineHtml, plainText } from "./html";
import { BASE_CSS } from "./base";
import type { Layouts, Registry } from "./registry";
import type { Diagnostic, Entity, Page, Settings } from "./types";

export interface BuildResult {
    html: string;
    pages: Page[];
    diagnostics: Diagnostic[];
}

export interface BuildOptions {
    registry: Registry;
    layouts: Layouts;
    themeCss?: string;
    /** toolbar and presentation mode; off for a headless render such as a pdf */
    viewer?: { css: string; script: string };
    /** wrap each entity in a boxless handle the studio can splice against */
    edit?: boolean;
    /** the deck's marks as urls the browser can load; the cli inlines local files here */
    logo?: string;
    coverLogo?: string;
}

/** Parse and group only, with no rendering: what the fit pass measures and may reshape. */
export function assemble(source: string, options: Pick<BuildOptions, "registry" | "layouts">): {
    pages: Page[];
    title: string;
    settings: Settings;
    diagnostics: Diagnostic[];
} {
    const { registry, layouts } = options;
    const { doc, diagnostics } = parse(source);

    const layoutDirectives = doc.directives.filter(d => d.kind === "layout" && d.before);
    const candidates = paginate(doc.entities, doc.settings, new Set(layoutDirectives.map(d => d.before!)));

    const house = layouts.get(doc.settings.layout);
    if (!house) {
        diagnostics.push({ level: "warn", message: `unknown deck layout "${doc.settings.layout}"; using default` });
    }
    const fallback = house?.name ?? "default";
    // the schema's defaults apply to a frontmatter layout too, not only to a directive's
    const filled = house?.props.safeParse({});
    const fallbackProps: Record<string, unknown> = filled?.success ? filled.data : {};

    // a layout directive starts a page and governs that page alone; the deck's own layout
    // is declared once in frontmatter, where the rest of the deck-wide facts already live
    const pages: Page[] = candidates.map((entities, index) => {
        let current = { name: fallback, props: { ...fallbackProps } };
        const ids = new Set(entities.map(e => e.id));
        const chosen = layoutDirectives.filter(d => ids.has(d.before!));
        if (chosen.length > 1) {
            diagnostics.push({ level: "warn", message: `page ${index + 1} names ${chosen.length} layouts; the last wins` });
        }
        const directive = chosen.at(-1);
        if (directive) {
            const layout = layouts.get(directive.component);
            if (!layout) {
                diagnostics.push({ level: "warn", message: `unknown layout "${directive.component}"; using "${current.name}"` });
            } else {
                const props = layout.props.safeParse(coerce(directive.props));
                if (!props.success) {
                    diagnostics.push({ level: "warn", message: `bad props for layout "${layout.name}": ${props.error.message}` });
                }
                current = { name: layout.name, props: props.success ? props.data : {} };
            }
        }
        return {
            index,
            blocks: group(entities, doc.directives, registry, diagnostics),
            layout: current.name,
            layoutProps: current.props,
            scale: 1,
            overflow: false,
        };
    });

    return { pages, title: plainText(doc.entities[0]?.node) || "Deck", settings: doc.settings, diagnostics };
}

/** Render an already-assembled page list. Fit calls this again after reshaping `pages`. */
/* the url may carry semicolons, as a Google Fonts weight list does, so the rule ends after it */
const IMPORT = /@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g;

export function render(
    pages: Page[],
    title: string,
    settings: Settings,
    options: BuildOptions,
): { html: string; diagnostics: Diagnostic[] } {
    const { registry, layouts } = options;
    const diagnostics: Diagnostic[] = [];

    // page numbers are reassigned here, not carried from assembly, so a fit split renumbers for free
    const numbered = pages.map((page, index) => ({ ...page, index }));

    const usedComponents = new Set(numbered.flatMap(p => p.blocks.map(b => b.component)));
    const usedLayouts = new Set(numbered.map(p => p.layout));

    // studio handles ride as attributes on elements the markup already has: a wrapper
    // element, even a boxless one, changes what child and sibling selectors match
    const entityHtml = options.edit
        ? (e: Entity) => handle(blockHtml(e), `data-ainsi-entity="${e.id}"`)
        : blockHtml;

    const taken = new Set<string>();
    const body = numbered.map(page => {
        const blocksHtml = page.blocks.map(block => {
            // a component that places an entity's text itself, `inline(head.node)`, still
            // yields a handle: the node is recognised by identity and the text spanned
            const inline = options.edit
                ? (node: any) => {
                    const owner = block.entities.find(e => e.node === node);
                    return owner ? `<span data-ainsi-entity="${owner.id}">${inlineHtml(node)}</span>` : inlineHtml(node);
                }
                : inlineHtml;
            const rendered = registry.get(block.component)!.render({
                entities: block.entities,
                props: block.props,
                html: entityHtml,
                inline,
                text: plainText,
            });
            // the fallback handle covers only what the component did not render entity by
            // entity, so the edit unit stays the entity and never grows to the whole block.
            // An image the component placed itself is found by its src, so the handle sits
            // on the img rather than on a root that also contains unrelated columns.
            if (!options.edit) return rendered;
            let out = rendered;
            const rest: Entity[] = [];
            for (const e of block.entities) {
                if (out.includes(`data-ainsi-entity="${e.id}"`)) continue;
                const placed = e.kind === "image" ? placeImage(out, e) : null;
                if (placed) out = placed;
                else rest.push(e);
            }
            return rest.length
                ? handle(out, `data-ainsi-span="${rest[0]!.id} ${rest.at(-1)!.id}"`)
                : out;
        });
        const content = blocksHtml.join("\n");
        const layout = layouts.get(page.layout)!;
        const rendered = layout.render({
            content,
            props: page.layoutProps,
            index: page.index + 1,
            total: numbered.length,
        });
        // per block, not the joined string: a layout may reorder blocks (split hoists the
        // figure), but every block must survive the template
        if (!blocksHtml.every(b => rendered.includes(b))) {
            diagnostics.push({ level: "warn", message: `layout "${layout.name}" dropped the content of page ${page.index + 1}` });
        }
        // the solver's two outputs ride on the section: the type scale it settled on, and
        // the admission that it ran out of ladder. Both are absent on a page that just fits.
        const step = page.scale === 1 ? "" : ` style="--ainsi-step:${page.scale}"`;
        const overflow = page.overflow ? " data-overflow" : "";
        // the page's stable address: its first heading, slugged. Page numbers move on every
        // fit split, so a link written as #page-3 would drift; a heading slug survives it.
        const heading = page.blocks.flatMap(b => b.entities).find(e => e.kind === "heading");
        const base = (heading?.text ?? "").toLowerCase().normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
            || `page-${page.index + 1}`;
        let slug = base;
        for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
        taken.add(slug);
        // the number is an element, not a pseudo, so an export lifts it as text like any other
        return `<section class="ainsi-page" id="${slug}" data-page="${page.index + 1}" data-layout="${page.layout}"${step}${overflow}>
${rendered}
<span class="ainsi-number" aria-hidden="true">${page.index + 1}</span>
</section>`;
    }).join("\n");

    // dynamic tree shaking: only what this deck actually uses reaches the output
    const css = [
        ...[...usedLayouts].map(n => layouts.get(n)?.css),
        ...[...usedComponents].map(n => registry.get(n)?.css),
    ].filter(Boolean).join("\n");
    const scripts = [...usedComponents].map(n => registry.get(n)?.script).filter(Boolean).join("\n");

    // a stylesheet honours @import only ahead of every rule, so a theme's font imports move to the top
    const imports = [...(options.themeCss ?? "").matchAll(IMPORT)].map(m => m[0]).join("\n");
    const theme = (options.themeCss ?? "").replace(IMPORT, "");
    const html = `<!doctype html>
<html lang="fi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${imports}
/* engine: page structure, and the paper a print lands on */
${BASE_CSS}
@page { size: ${paper(settings.ratio)}; margin: 0; }
/* theme: tokens, and whatever no token should carry; after the engine so its element rules win */
${theme}
/* layouts and components, styled through the tokens above */
${css}
${options.viewer?.css ?? ""}
</style>
</head>
<body class="ainsi"${options.edit ? " data-ainsi-studio" : ""}${settings.numbers ? "" : ' data-numbers="off"'} style="--ainsi-ratio:${settings.ratio.replace(":", " / ")}${logoVars(options)}">
${body}
${[scripts, options.viewer?.script].filter(Boolean).map(s => `<script type="module">${s}</script>`).join("\n")}
</body>
</html>`;

    return { html, diagnostics };
}

/** the marks as body tokens; the cover's falls back to the deck's, so a theme reads one token per place */
function logoVars(options: BuildOptions): string {
    const url = (u: string) => `url('${u.replace(/'/g, "%27")}')`;
    const cover = options.coverLogo ?? options.logo;
    return `${options.logo ? `;--ainsi-logo:${url(options.logo)}` : ""}${cover ? `;--ainsi-logo-cover:${url(cover)}` : ""}`;
}

/** the sheet a page prints on: the design width at the deck's ratio, so one page is one sheet */
function paper(ratio: string): string {
    const [w, h] = ratio.split(":").map(Number);
    const height = w && h ? Math.round((1280 * h) / w) : 720;
    return `1280px ${height}px`;
}

export function build(source: string, options: BuildOptions): BuildResult {
    const assembled = assemble(source, options);
    const rendered = render(assembled.pages, assembled.title, assembled.settings, options);
    return { html: rendered.html, pages: assembled.pages, diagnostics: [...assembled.diagnostics, ...rendered.diagnostics] };
}

/** put an attribute on the first element of a fragment; a fragment with none is left alone */
function handle(html: string, attribute: string): string {
    return html.replace(/<([a-zA-Z][^\s/>]*)/, (_, tag) => `<${tag} ${attribute}`);
}

/** hang an image entity's handle on the img tag that carries its url; null when not found */
function placeImage(html: string, entity: Entity): string | null {
    const node = entity.node.type === "image" ? entity.node : entity.node.children?.[0];
    if (node?.type !== "image") return null;
    // an empty url renders as the placeholder, so its marker is what identifies the img
    const src = node.url
        ? `src="${String(node.url).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`
        : "data-ainsi-placeholder";
    const at = html.indexOf(src);
    if (at === -1) return null;
    const open = html.lastIndexOf("<img", at);
    if (open === -1) return null;
    return `${html.slice(0, open + 4)} data-ainsi-entity="${entity.id}"${html.slice(open + 4)}`;
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
