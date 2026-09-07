import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Layouts, Registry, type Component, type ComponentDefinition, type Layout, type LayoutDefinition } from "./registry";
import type { Diagnostic } from "./types";

const SCRIPTS = ["script.tsx", "script.ts", "script.jsx", "script.js"];

/**
 * A component is a folder. Its name is the folder name, so nothing inside restates it.
 * Point this at as many roots as you like; later roots override earlier ones by name.
 */
export interface LoadOptions {
    /** bypass the module cache, so a watcher picks up an edited component */
    fresh?: boolean;
}

export async function load(roots: string[], diagnostics: Diagnostic[] = [], options: LoadOptions = {}): Promise<Registry> {
    const registry = new Registry();

    for (const root of roots) {
        const dir = resolve(root);
        let entries: string[];
        try {
            entries = (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
        } catch {
            diagnostics.push({ level: "warn", message: `component root not found: ${dir}` });
            continue;
        }

        for (const name of entries.sort()) {
            const folder = join(dir, name);
            const entry = join(folder, "index.ts");
            if (!(await Bun.file(entry).exists())) {
                diagnostics.push({ level: "warn", message: `${name}/ has no index.ts; skipped` });
                continue;
            }

            const module = await import(fresh(entry, options));
            const definition: ComponentDefinition | undefined = module.default;
            if (!definition?.render) {
                diagnostics.push({ level: "warn", message: `${name}/index.ts default-exports no render; skipped` });
                continue;
            }

            const css = await readIfPresent(join(folder, "style.css"));
            if (css) checkScope(name, css, diagnostics);

            registry.register({
                ...definition,
                name,
                ...(css ? { css } : {}),
                ...(await bundle(folder, name, diagnostics)),
            } as Component, { replace: true });
        }
    }

    return registry;
}

function fresh(path: string, options: LoadOptions): string {
    return options.fresh ? `${path}?t=${Date.now()}` : path;
}

async function readIfPresent(path: string): Promise<string | undefined> {
    const file = Bun.file(path);
    return (await file.exists()) ? (await file.text()).trim() : undefined;
}

/**
 * Scoping is by convention and checked here rather than left to hope: every selector names
 * this component's class and nobody else's, so two components cannot collide. Ambient state
 * a component reacts to, such as `body[data-present] [data-current] .ainsi-boxes__box`, is
 * fine; another component's class is not.
 */
function checkScope(name: string, css: string, diagnostics: Diagnostic[]): void {
    const own = `.ainsi-${name}`;
    for (const selector of selectors(css)) {
        const classes = [...selector.matchAll(/\.ainsi-[a-z0-9_-]+/g)].map(m => m[0]);
        const foreign = classes.filter(c => c !== own && !c.startsWith(`${own}__`) && !c.startsWith(`${own}--`));
        if (!classes.length || foreign.length) {
            const why = classes.length ? `names ${foreign[0]}` : `names no ${own}`;
            diagnostics.push({
                level: "warn",
                message: `${name}/style.css escapes its scope: "${selector}" ${why}`,
            });
        }
    }
}

/**
 * script.ts exports `mount(root)`. The engine generates the entry that finds this
 * component's roots and calls it, so a component never queries the document itself.
 */
async function bundle(folder: string, name: string, diagnostics: Diagnostic[]): Promise<{ script?: string }> {
    for (const candidate of SCRIPTS) {
        const path = join(folder, candidate);
        if (!(await Bun.file(path).exists())) continue;

        const entry = join(folder, `.ainsi-entry-${name}.ts`);
        await Bun.write(entry, `import { mount } from "./${candidate}";
for (const root of document.querySelectorAll('[data-ainsi="${name}"]')) mount(root as HTMLElement);
`);
        try {
            const built = await Bun.build({ entrypoints: [entry], target: "browser", format: "iife", minify: true });
            if (!built.success) {
                diagnostics.push({ level: "warn", message: `${name}/${candidate} failed to build; no script emitted` });
                return {};
            }
            return { script: (await built.outputs[0]!.text()).trim() };
        } finally {
            await Bun.file(entry).delete().catch(() => {});
        }
    }
    return {};
}

/**
 * A layout is a folder too, but a separate registry: a component takes a span of entities,
 * a layout takes a whole page. The engine ships the defaults so a deck naming one cannot be
 * broken by a theme that lacks it; a theme replaces one by using the same folder name.
 */
export async function loadLayouts(roots: string[], diagnostics: Diagnostic[] = [], options: LoadOptions = {}): Promise<Layouts> {
    const layouts = new Layouts();

    for (const root of roots) {
        const dir = resolve(root);
        let entries: string[];
        try {
            entries = (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
        } catch {
            continue;                                   // a theme with no layouts/ is the normal case
        }

        // default first: every other layout inherits it unless it ships its own index.ts
        for (const name of entries.sort((a, b) => Number(b === "default") - Number(a === "default"))) {
            const folder = join(dir, name);
            const entry = join(folder, "index.ts");
            const inherited = layouts.get(name);

            let definition: LayoutDefinition | undefined = inherited ?? layouts.get("default");
            if (await Bun.file(entry).exists()) {
                // an index.ts without a render declares props only; the template is inherited
                const own = (await import(fresh(entry, options))).default;
                definition = own?.render ? own : definition ? { ...definition, ...own } : undefined;
            }
            if (!definition?.render) {
                diagnostics.push({ level: "warn", message: `layout ${name}/ has no index.ts and no default to inherit; skipped` });
                continue;
            }

            const own = await readIfPresent(join(folder, "style.css"));
            if (own) checkLayoutScope(name, own, diagnostics);
            // a theme's layout css adds to the engine's rather than replacing it
            const css = [inherited?.css, own].filter(Boolean).join("\n");

            layouts.register({ ...definition, name, ...(css ? { css } : {}) } as Layout);
        }
    }

    return layouts;
}

/**
 * A layout may restyle any component on its own page, so what it must name is the page, not
 * a class. Ambient state may come first; another layout's name may not appear at all.
 */
function checkLayoutScope(name: string, css: string, diagnostics: Diagnostic[]): void {
    const own = `[data-layout="${name}"]`;
    for (const selector of selectors(css)) {
        const layouts = [...selector.matchAll(/\[data-layout="[a-z0-9_-]+"\]/g)].map(m => m[0]);
        if (layouts.length !== 1 || layouts[0] !== own) {
            diagnostics.push({
                level: "warn",
                message: `layout ${name}/style.css escapes its page: "${selector}" does not name ${own} and only ${own}`,
            });
        }
    }
}

export const DEFAULT_THEME = resolve(import.meta.dir, "..", "themes", "default");
export const THEMES = resolve(import.meta.dir, "..", "themes");

/**
 * A bare name is one of the themes shipped here; anything with a slash or a leading dot is a
 * folder of the deck's own, resolved beside the deck the way its images and logo are, so a
 * deck and the theme it is written against move as one thing.
 */
export function themeDir(name: string, deckDir: string): string {
    return name.startsWith(".") || name.includes("/") ? resolve(deckDir, name) : join(THEMES, name);
}

/**
 * A theme is a folder: tokens, an optional escape hatch, and optional layout overrides. The
 * default theme's tokens sit under every other theme's, so a theme declares only what it
 * changes and a token added to the contract never leaves an older theme short.
 */
export async function loadTheme(dir: string, diagnostics: Diagnostic[] = []): Promise<{ css: string; layouts: string }> {
    const root = resolve(dir);
    const own = await readIfPresent(join(root, "variables.css"));
    if (!own) diagnostics.push({ level: "warn", message: `theme has no variables.css: ${root}` });
    const base = root === DEFAULT_THEME ? undefined : await readIfPresent(join(DEFAULT_THEME, "variables.css"));
    const variables = [base, own].filter(Boolean).join("\n\n");

    const styles = await readIfPresent(join(root, "styles.css"));
    if (styles) {
        for (const selector of selectors(styles)) {
            if (selector.includes("__")) {
                diagnostics.push({
                    level: "warn",
                    message: `theme styles.css reaches inside a component: "${selector}"; use a token or a layout`,
                });
            }
        }
    }

    return { css: [variables, styles].filter(Boolean).join("\n\n"), layouts: join(root, "layouts") };
}

function selectors(css: string): string[] {
    const stripped = css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/@import[^;]+;/g, "")
        // keyframe stops are not selectors and have no scope to escape
        .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const found: string[] = [];
    for (const [, , selector] of stripped.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
        for (const one of selector!.split(",")) {
            const trimmed = one.trim();
            if (trimmed && !trimmed.startsWith("--") && !trimmed.startsWith("%")) found.push(trimmed);
        }
    }
    return found;
}

/** Viewer chrome: a toolbar and presentation mode. Not content, so not a component. */
export const loadViewer = (diagnostics: Diagnostic[] = []) => chrome("viewer", diagnostics);

/** The page the studio shows before a deck is chosen: open one, or make one. */
export const loadStart = () => Bun.file(join(import.meta.dir, "studio", "start.html")).text();

/** Studio chrome: the editing layer the dev server injects. Never in a deck. */
export const loadStudio = (diagnostics: Diagnostic[] = []) => chrome("studio", diagnostics);

async function chrome(name: string, diagnostics: Diagnostic[]): Promise<{ css: string; script: string }> {
    const dir = resolve(import.meta.dir, name);
    const css = (await readIfPresent(join(dir, "style.css"))) ?? "";

    const built = await Bun.build({
        entrypoints: [join(dir, "script.ts")],
        target: "browser",
        format: "iife",
        minify: true,
    });
    if (!built.success) {
        diagnostics.push({ level: "warn", message: `${name} failed to build; no chrome emitted` });
        return { css, script: "" };
    }
    return { css, script: (await built.outputs[0]!.text()).trim() };
}

export const BUILTIN = resolve(import.meta.dir, "components");
export const LAYOUTS = resolve(import.meta.dir, "layouts");
