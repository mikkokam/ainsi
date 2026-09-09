import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Layouts, Registry, type Component, type ComponentDefinition, type Entry, type Layout, type LayoutDefinition } from "./registry";
import { MARK } from "./mark";
import type { Diagnostic } from "./types";
import { COMPONENTS } from "./components/index";
import { LAYOUTS as SHIPPED } from "./layouts/index";

const SCRIPTS = ["script.tsx", "script.ts", "script.jsx", "script.js"];

/**
 * A component is a folder, and `components/index.ts` is the list of them. That list is the
 * manifest: it cannot drift from what exists because it is what runs, and nothing here reads
 * a directory or imports what it found in one.
 *
 * A script still goes through the bundler, which needs the folder on disk. That is a build of
 * a known input rather than discovery, and it moves into the build with the chrome.
 */
export async function load(entries: Entry<ComponentDefinition>[] = COMPONENTS, diagnostics: Diagnostic[] = [], root = BUILTIN): Promise<Registry> {
    const registry = new Registry();

    for (const entry of entries) {
        const { name, definition } = entry;
        // a text import keeps the file's trailing newline; a stylesheet is trimmed either way
        const css = entry.css?.trim() || undefined;
        if (!definition?.render) {
            diagnostics.push({ level: "warn", message: `${name} exports no render; skipped` });
            continue;
        }
        if (css) checkScope(name, css, diagnostics);

        registry.register({
            ...definition,
            name,
            ...(css ? { css } : {}),
            ...(await bundle(join(root, name), name, diagnostics)),
        } as Component);
    }

    return registry;
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
 * A layout takes a whole page where a component takes a run of entities, so it keeps its own
 * registry. The engine ships the four, in `layouts/index.ts`; a theme adds nothing but css,
 * against a name the engine already has.
 */
export async function loadLayouts(themeLayouts?: string, diagnostics: Diagnostic[] = []): Promise<Layouts> {
    const layouts = new Layouts();

    // default first: every other layout inherits it unless it ships its own render
    for (const entry of [...SHIPPED].sort((a, b) => Number(b.name === "default") - Number(a.name === "default"))) {
        const { name, definition } = entry;
        const css = entry.css?.trim() || undefined;
        const inherited = definition.render ? definition : { ...layouts.get("default"), ...definition };
        if (!inherited?.render) {
            diagnostics.push({ level: "warn", message: `layout ${name} has no render and no default to inherit; skipped` });
            continue;
        }
        if (css) checkLayoutScope(name, css, diagnostics);
        layouts.register({ ...inherited, name, ...(css ? { css } : {}) } as Layout);
    }

    if (themeLayouts) await themeOverrides(themeLayouts, layouts, diagnostics);
    return layouts;
}

/*
 * A theme's layouts folder is css and nothing else. It is read at run time because it is data,
 * and a theme beside a deck is a deck's own; what it may not do is arrive with code, so an
 * index.ts in there is reported rather than run.
 */
async function themeOverrides(dir: string, layouts: Layouts, diagnostics: Diagnostic[]): Promise<void> {
    let names: string[];
    try {
        names = (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        return;                                     // a theme with no layouts/ is the normal case
    }

    for (const name of names.sort()) {
        const own = await readIfPresent(join(dir, name, "style.css"));
        if (await Bun.file(join(dir, name, "index.ts")).exists()) {
            diagnostics.push({ level: "warn", message: `theme layout ${name}/ ships an index.ts, which is not loaded; a theme is css` });
        }
        const base = layouts.get(name);
        if (!base) {
            diagnostics.push({ level: "warn", message: `theme styles a layout the engine does not have: ${name}` });
            continue;
        }
        if (!own) continue;
        checkLayoutScope(name, own, diagnostics);
        // a theme's layout css adds to the engine's rather than replacing it
        layouts.register({ ...base, name, css: [base.css, own].filter(Boolean).join("\n") } as Layout);
    }
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
export const loadStart = async () => (await Bun.file(join(import.meta.dir, "studio", "start.html")).text()).replace("__MARK__", MARK);

/** Studio chrome: the editing layer the dev server injects. Never in a deck. */
export const loadStudio = (diagnostics: Diagnostic[] = []) => chrome("studio", diagnostics);

/*
 * Held until the folder changes. The studio's script pulls in CodeMirror, which is fifteen
 * milliseconds of bundling against a rebuild that is otherwise about ten, and a rebuild runs
 * on every commit. The cache is what lets the folder be watched without paying for the watch.
 */
const bundled = new Map<string, { stamp: number; chrome: { css: string; script: string } }>();

async function chrome(name: string, diagnostics: Diagnostic[]): Promise<{ css: string; script: string }> {
    const dir = resolve(import.meta.dir, name);
    const stamp = await newest(dir);
    const held = bundled.get(name);
    if (held && held.stamp === stamp) return held.chrome;

    const css = (await readIfPresent(join(dir, "style.css"))) ?? "";
    const built = await Bun.build({
        entrypoints: [join(dir, "script.ts")],
        target: "browser",
        format: "iife",
        minify: true,
    });
    if (!built.success) {
        // not cached: the next rebuild should try again rather than serve the failure back
        diagnostics.push({ level: "warn", message: `${name} failed to build; no chrome emitted` });
        return { css, script: "" };
    }

    const result = { css, script: (await built.outputs[0]!.text()).trim() };
    bundled.set(name, { stamp, chrome: result });
    return result;
}

/** the newest mtime in a folder, its own included so a deletion counts; chrome is one level deep */
async function newest(dir: string): Promise<number> {
    const stamps = await Promise.all([dir, ...(await readdir(dir)).map(entry => join(dir, entry))]
        .map(path => stat(path).then(s => s.mtimeMs).catch(() => 0)));
    return Math.max(...stamps);
}

export const BUILTIN = resolve(import.meta.dir, "components");
export const LAYOUTS = resolve(import.meta.dir, "layouts");
/** the chrome folders, so a dev server editing them rebuilds the way it does for a component */
export const CHROME = [resolve(import.meta.dir, "viewer"), resolve(import.meta.dir, "studio")];
