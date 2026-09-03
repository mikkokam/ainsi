import { parse } from "./parse";
import { paginate } from "./paginate";
import { group } from "./group";
import { blockHtml, inlineHtml, plainText } from "./html";
import { BASE_CSS } from "./base";
import type { Layouts, Registry } from "./registry";
import type { Diagnostic, Page, Settings } from "./types";

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

    // a layout directive starts a page and governs that page alone; the deck's own layout
    // is declared once in frontmatter, where the rest of the deck-wide facts already live
    const pages: Page[] = candidates.map((entities, index) => {
        let current = { name: fallback, props: {} as Record<string, unknown> };
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
        };
    });

    return { pages, title: plainText(doc.entities[0]?.node) || "Deck", settings: doc.settings, diagnostics };
}

/** Render an already-assembled page list. Fit calls this again after reshaping `pages`. */
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

    const body = numbered.map(page => {
        const content = page.blocks.map(block => registry.get(block.component)!.render({
            entities: block.entities,
            props: block.props,
            html: blockHtml,
            inline: inlineHtml,
            text: plainText,
        })).join("\n");
        const layout = layouts.get(page.layout)!;
        const rendered = layout.render({
            content,
            props: page.layoutProps,
            index: page.index + 1,
            total: numbered.length,
        });
        if (content && !rendered.includes(content)) {
            diagnostics.push({ level: "warn", message: `layout "${layout.name}" dropped the content of page ${page.index + 1}` });
        }
        return `<section class="pac-page" data-page="${page.index + 1}" data-layout="${page.layout}">
${rendered}
</section>`;
    }).join("\n");

    // dynamic tree shaking: only what this deck actually uses reaches the output
    const css = [
        ...[...usedLayouts].map(n => layouts.get(n)?.css),
        ...[...usedComponents].map(n => registry.get(n)?.css),
    ].filter(Boolean).join("\n");
    const scripts = [...usedComponents].map(n => registry.get(n)?.script).filter(Boolean).join("\n");

    const html = `<!doctype html>
<html lang="fi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
/* theme: tokens, and whatever no token should carry */
${options.themeCss ?? ""}
/* engine: page structure */
${BASE_CSS}
/* layouts and components, styled through the tokens above */
${css}
${options.viewer?.css ?? ""}
</style>
</head>
<body class="pac" style="--pac-ratio:${settings.ratio.replace(":", " / ")}">
${body}
${[scripts, options.viewer?.script].filter(Boolean).map(s => `<script type="module">${s}</script>`).join("\n")}
</body>
</html>`;

    return { html, diagnostics };
}

export function build(source: string, options: BuildOptions): BuildResult {
    const assembled = assemble(source, options);
    const rendered = render(assembled.pages, assembled.title, assembled.settings, options);
    return { html: rendered.html, pages: assembled.pages, diagnostics: [...assembled.diagnostics, ...rendered.diagnostics] };
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
