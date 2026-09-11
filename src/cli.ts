#!/usr/bin/env bun
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { assemble, render as renderPages, type BuildOptions } from "./build";
import { END, group } from "./group";
import { fit, openFit, type FitSession } from "./fit";
import { images, parse } from "./parse";
import { pdf, PDF_IMAGES, type PdfImages } from "./pdf";
import { pack } from "./pack";
import { pptx } from "./pptx";
import { serve } from "./serve";
import { CHROME, THEMES, USER_THEMES, load, loadLayouts, loadStart, loadStudio, loadTheme, loadViewer, newest, themeDir as themePath } from "./load";
import type { Registry } from "./registry";
import type { Block, Diagnostic, Directive, Entity, EntityKind, Page, Settings } from "./types";
import type { ZodTypeAny } from "zod";

const argv = process.argv.slice(2);
const building = argv[0] === "build";
const args = building ? argv.slice(1) : argv;
const VALUED = new Set(["-o", "--to", "--port"]);
const FORMATS = ["html", "pdf", "zip"] as const;
const inputs = args.filter((a, i) => !a.startsWith("-") && !VALUED.has(args[i - 1] ?? ""));
const input = inputs[0];

const USAGE = [
    "usage: ainsi [deck.md] [--port 4321]",
    "           opens the studio; without a deck, on the chooser: open one here, or make one",
    "       ainsi build <deck.md> [-o out.html|out.pdf|out.zip] [--to html|pdf|zip] [--fit] [--pdf[=screen|compact|full]] [--no-viewer]",
    "           writes the file beside the deck and exits",
].join("\n");
const fail = (message: string): never => {
    console.error(message);
    process.exit(1);
};

if (inputs.length > 1) fail(`one deck at a time; got ${inputs.length}\n${USAGE}`);
if (building && !input) fail(USAGE);
// an agent or a pipe wants a file, never a server it cannot see; the answer is the command that
// gives one. A desktop shell is the third case: no terminal, and a window that will show the URL.
const host = process.env.AINSI_HOST;
if (!building && !host && !process.stdout.isTTY) fail(`ainsi ${input ?? ""} opens the studio, which needs a terminal.\nTo write a file: ainsi build ${input ?? "deck.md"}`);

const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
};

/** a fresh deck: untitled.md in the given folder, or the first untitled-N.md it does not hold, on the theme asked for */
async function untitled(dir: string, theme?: string): Promise<string> {
    for (let n = 1; ; n++) {
        const candidate = resolve(dir, n === 1 ? "untitled.md" : `untitled-${n}.md`);
        if (await Bun.file(candidate).exists()) continue;
        const front = theme && theme !== "default" ? `---\ntheme: ${theme}\n---\n\n` : "";
        await Bun.write(candidate, `${front}# Untitled\n`);
        return candidate;
    }
}

/**
 * The landing's recent-deck list. A JSON file under the user's config dir rather than
 * bun:sqlite: it is one array, read whole and written whole, never queried, and a studio
 * process is the only writer at a time — sqlite's concurrency story buys nothing here.
 */
interface Recent { title: string; file: string; path: string; lastOpened: number; pages: number; theme: string; pinned: boolean }
const RECENTS = join(homedir(), ".config", "ainsi", "recents.json");

async function readRecents(): Promise<Recent[]> {
    try {
        return JSON.parse(await Bun.file(RECENTS).text());
    } catch {
        return [];
    }
}
async function writeRecents(list: Recent[]): Promise<void> {
    await mkdir(dirname(RECENTS), { recursive: true });
    await Bun.write(RECENTS, JSON.stringify(list, null, 2));
}
/** upserts by path; pinned survives, everything else is only ever as fresh as the last build */
async function recordRecent(path: string, title: string, pages: number, theme: string): Promise<void> {
    const list = await readRecents();
    const at = list.findIndex(r => r.path === path);
    const pinned = at === -1 ? false : list[at]!.pinned;
    const entry: Recent = { title, file: basename(path), path, lastOpened: Date.now(), pages, theme, pinned };
    if (at === -1) list.push(entry); else list[at] = entry;
    await writeRecents(list);
}

/** the four tokens a theme's tile or a deck's cover strip draws from, plus its type face */
function themeTokens(css: string): { ground: string; ink: string; accent: string; rule: string; display: string } {
    const get = (name: string) => css.match(new RegExp(`--ainsi-${name}:\\s*([^;]+);`))?.[1]?.trim();
    const font = get("font") ?? "system-ui, sans-serif";
    const display = get("font-display");
    return {
        ground: get("ground") ?? "#ffffff",
        ink: get("ink") ?? "#000000",
        accent: get("accent") ?? "#000000",
        rule: get("rule") ?? "#cccccc",
        display: display === "var(--ainsi-font)" || !display ? font : display,
    };
}

/**
 * The status line reads "Claude Code skills active" or asks for them. Checked, not assumed:
 * the same installed_plugins.json Claude Code itself writes under the user's home, so a
 * missing or unreadable file just answers false rather than throwing.
 */
/** where Claude Code keeps what it has installed; the landing offers to show it */
const PLUGINS = join(homedir(), ".claude", "plugins");

async function skillsInstalled(): Promise<boolean> {
    try {
        const raw = JSON.parse(await Bun.file(join(PLUGINS, "installed_plugins.json")).text());
        return Object.keys(raw?.plugins ?? {}).some(id => id === "ainsi@ainsi" || id.startsWith("ainsi@"));
    } catch {
        return false;
    }
}

/*
 * No deck until one is named or chosen. `ainsi` on its own used to write untitled.md into
 * whatever directory it was run in, which is a file nobody asked for; it opens the chooser
 * instead, and the file is born when the person says new.
 */
const opening: string | undefined = input ? resolve(input) : undefined;
/*
 * What the studio's file browser may reach: where the command was run, or the deck's own
 * folder when the deck lies outside it, and the folder of every deck opened since. The studio
 * is an http server on localhost, so an endpoint taking any path would let any page in the
 * browser read any file on the machine through it. To work on a deck elsewhere, start the
 * studio there or open it, which is what widens this.
 */
const defaultRoot = opening && !opening.startsWith(process.cwd() + "/") ? dirname(opening) : process.cwd();
const browseRoots = new Set<string>([defaultRoot]);
/*
 * The roots exist to stop a page the studio serves from reading any file on the machine, and a
 * page cannot widen them. A native Open dialog is the other case: the person picked that file
 * themselves, and the dialog is the consent, so a deck chosen there may live anywhere. Only the
 * shell can say a path came from one, which is what this token is: printed once on stdout, which
 * only the process that launched the studio reads.
 */
const SHELL_KEY = crypto.randomUUID();
const fromShell = (request: Request): boolean => request.headers.get("x-ainsi-shell") === SHELL_KEY;
const editing = !building;
const sibling = (path: string, ext: string): string =>
    join(dirname(path), `${basename(path, extname(path))}${ext}`);
const target = flag("-o");
const to = flag("--to");
if (to && !FORMATS.includes(to as typeof FORMATS[number])) fail(`--to takes ${FORMATS.join(", ")}; got "${to}"`);
if (target && to && extname(target).slice(1) !== to) fail(`-o ${target} and --to ${to} disagree`);
const pdfFlag = args.find(a => a === "--pdf" || a.startsWith("--pdf="));
const format: typeof FORMATS[number] = building && (to === "zip" || extname(target ?? "").toLowerCase() === ".zip") ? "zip"
    : building && (to === "pdf" || extname(target ?? "").toLowerCase() === ".pdf" || pdfFlag) ? "pdf" : "html";
const printing = format === "pdf";
/** where a deck's own build lands: beside it, or wherever -o said for the format asked for */
const outputFor = (path: string, ext: string): string =>
    target && `.${format}` === ext ? resolve(target) : sibling(path, ext);
const pdfImages = (pdfFlag?.split("=")[1] ?? "screen") as PdfImages;
if (printing && !PDF_IMAGES.includes(pdfImages)) fail(`--pdf takes ${PDF_IMAGES.join(", ")}; got "${pdfImages}"`);
// a pdf of unfitted pages loses their overflow silently, so printing always fits first
const fitting = args.includes("--fit") || printing;
const port = Number(flag("--port") ?? 4321);

/*
 * The measuring browser is opened once and handed to every rebuild. A launch costs hundreds
 * of milliseconds against a build that takes single-digit ones, so a browser per keystroke
 * would be the whole cost of editing. The studio opens it the first time it exports, and
 * keeps it.
 */
let session: FitSession | undefined;
async function measuring(): Promise<FitSession> {
    if (session) return session;
    const opening: Diagnostic[] = [];
    session = await openFit(opening);
    // said once, here, rather than on every rebuild that is handed a pageless session
    for (const d of opening) console.warn(`${d.level}: ${d.message}`);
    return session;
}

/** What the studio splices against: offsets from the same parse the deck was built from. */
interface DocBlock {
    ids: string[];
    component: string;
    origin: Block["origin"];
    props: Record<string, unknown>;
    /** the components whose accepts() passes for the whole span */
    accepted: string[];
    /** what grouping picks with no directive, so the studio can drop one that agrees */
    heuristic: string;
    directive?: { start: number; end: number };
    terminator?: { start: number; end: number };
}
interface DocComponent {
    name: string;
    about: string;
    fields: Field[];
    /** the entity kinds it will take on its own, so an insert palette is derived and not copied */
    takes: EntityKind[];
}
interface Field { name: string; type: "enum" | "boolean" | "number" | "string"; options?: string[]; default?: unknown }
/** a page as the studio addresses it: its entities, its layout, and the directive that set it */
interface DocPage {
    ids: string[];
    layout: string;
    props: Record<string, unknown>;
    first: number;
    last: number;
    held: boolean;
    directive?: { start: number; end: number };
}
interface DocLayout { name: string; fields: Field[] }
interface DocEntity { id: string; kind: string; start: number; end: number; md: string; accepted: string[] }
interface Doc {
    hash: string;
    source: string;
    file: string;
    /** the deck's own theme, which is where the studio reads the current one from */
    theme: string;
    layout: string;
    entities: DocEntity[];
    blocks: DocBlock[];
    pages: DocPage[];
    components: DocComponent[];
    layouts: DocLayout[];
}
const blankDoc = (): Doc => ({
    hash: "", source: "", file: "", theme: "default", layout: "default",
    entities: [], blocks: [], pages: [], components: [], layouts: [],
});

/*
 * A deck the studio is holding. One process serves many, each in its own window, so everything
 * that used to be "the one deck" is a field here: the id its url is built from, where it is on
 * disk, and what the last build said about it.
 */
interface Open { id: string; path: string; doc: Doc }
const decks = new Map<string, Open>();
/*
 * The same decks by path. Opening one that is already open must land on the window it is
 * already in: two windows on one file is two writers, which is the split brain the Studio's
 * no-document-state rule exists to prevent.
 */
const byPath = new Map<string, Open>();
/** AINSI_TRACE=1 adds the round trip either side of a rebuild: the write, and the browser's own view of it */
const trace = !!process.env.AINSI_TRACE;

/*
 * Where a rebuild's milliseconds went. The studio holds the editor's "saving…" until the
 * reload lands, so a slow phase here is a freeze the person feels; the summary line carries
 * the split rather than a total nobody can act on.
 */
function stopwatch() {
    let last = performance.now();
    const marks: string[] = [];
    return {
        mark(what: string) {
            const now = performance.now();
            marks.push(`${what} ${Math.round(now - last)}`);
            last = now;
        },
        get split() { return marks.join(", "); },
    };
}

/**
 * Everything the deck is made of, rebuilt from disk. Returns the html and what to watch.
 * With an open record it also refreshes what the studio addresses that deck by.
 */
async function build(path: string, entry?: Open): Promise<{ html: string; roots: string[] }> {
    const clock = stopwatch();
    const dir = dirname(path);
    const source = await Bun.file(path).text();
    const parsed = parse(source);
    const settings = parsed.doc.settings;
    clock.mark("parse");
    const diagnostics: Diagnostic[] = [];
    const { themeDir, theme, registry, layouts } = await stack(settings.theme, diagnostics, dir);
    clock.mark("load");

    let viewer = args.includes("--no-viewer") ? undefined : await loadViewer(diagnostics);
    // both chromes are read and bundled per rebuild, not once: they are watched like a
    // component, so editing the studio's own css or script reloads the browser
    const studio = editing ? await loadStudio(diagnostics) : undefined;
    clock.mark("chrome");
    if (studio) {
        viewer = {
            css: [viewer?.css, studio.css].filter(Boolean).join("\n"),
            script: [viewer?.script, studio.script].filter(Boolean).join("\n"),
        };
    }
    const buildOptions = { registry, layouts, themeCss: theme.css, viewer, edit: editing, logo: await logoOf(settings.logo, diagnostics, dir), coverLogo: await logoOf(settings.coverLogo, diagnostics, dir) };

    const assembled = assemble(source, buildOptions);
    clock.mark("assemble");
    diagnostics.push(...assembled.diagnostics);
    if (!editing) await inlineImages(assembled.pages, diagnostics, dir);
    if (entry) {
        entry.doc = {
            hash: Bun.hash(source).toString(16),
            source,
            file: basename(path),
            theme: settings.theme,
            layout: settings.layout,
            entities: parsed.doc.entities.map(e => ({
                id: e.id,
                kind: e.kind,
                start: e.node.position.start.offset,
                end: e.node.position.end.offset,
                md: e.md,
                accepted: registry.all().filter(c => c.accepts([e])).map(c => c.name),
            })),
            blocks: describeBlocks(assembled.pages, parsed.doc.entities, parsed.doc.directives, registry),
            pages: describePages(assembled.pages, parsed.doc.entities, parsed.doc.directives, settings),
            components: describeComponents(registry),
            layouts: layouts.all()
                .sort((a, b) => Number(b.name === "default") - Number(a.name === "default") || a.name.localeCompare(b.name))
                .map(l => ({ name: l.name, fields: fields(l.props) })),
        };
    }

    if (entry) clock.mark("describe");
    const result = fitting
        ? await fit(assembled.pages, assembled.title, assembled.settings, buildOptions, renderPages, session)
        : { ...renderPages(assembled.pages, assembled.title, assembled.settings, buildOptions), pages: assembled.pages };
    clock.mark(fitting ? "fit" : "render");
    diagnostics.push(...result.diagnostics);

    let written = outputFor(path, ".html");
    if (printing) {
        const printed = await print(result.pages, assembled.title, assembled.settings, buildOptions, outputFor(path, ".pdf"));
        diagnostics.push(...printed.diagnostics);
        // no browser means no pdf; the summary says where the pages went, not where they would have
        written = printed.written ? outputFor(path, ".pdf") : "";
    } else {
        await Bun.write(written, result.html);
    }

    clock.mark("write");
    for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
    const where = written ? ` -> ${written}` : ", nothing written";
    console.log(`theme ${settings.theme}, ${result.pages.length} pages, ${result.pages.flatMap(p => p.blocks).length} blocks${where}`);
    if (editing) console.log(`  ${clock.split} ms`);
    for (const page of result.pages) {
        const blocks = page.blocks.map(b => `${b.component}${b.origin === "directive" ? "*" : ""}`).join(", ");
        const fitted = [page.scale === 1 ? "" : ` x${page.scale}`, page.overflow ? " OVERFLOWS" : ""].join("");
        console.log(`  page ${page.index + 1} [${page.layout}]${fitted}: ${blocks}`);
    }

    // the landing's recents card is only ever as fresh as a deck's last build, so it is
    // written here rather than re-derived when the landing is next shown
    if (editing) await recordRecent(path, assembled.title, result.pages.length, settings.theme);

    return { html: result.html, roots: [themeDir] };
}

/** every block with what governs it: its directive and end marker, and the heuristic's pick */
function describeBlocks(pages: Page[], entities: Entity[], directives: Directive[], registry: Registry): DocBlock[] {
    return pages.flatMap(page => {
        const own = page.blocks.flatMap(b => b.entities);
        const free = group(own, [], registry, []);
        return page.blocks.map(block => {
            const first = block.entities[0]!;
            const last = block.entities.at(-1)!;
            const next = entities[entities.findIndex(e => e.id === last.id) + 1];
            const directive = directives.find(d => d.before === first.id && d.kind === "component" && d.component !== END);
            const terminator = next && directives.find(d => d.before === next.id && d.component === END);
            return {
                ids: block.entities.map(e => e.id),
                component: block.component,
                origin: block.origin,
                props: block.props,
                accepted: registry.all().filter(c => c.accepts(block.entities)).map(c => c.name),
                heuristic: free.find(b => b.entities.includes(first))?.component ?? "prose",
                ...(directive ? { directive: { start: directive.start, end: directive.end } } : {}),
                ...(terminator ? { terminator: { start: terminator.start, end: terminator.end } } : {}),
            };
        });
    });
}

/** every page with its layout, the directive that set it, and whether that directive is the page break */
function describePages(pages: Page[], entities: Entity[], directives: Directive[], settings: Settings): DocPage[] {
    return pages.map(page => {
        const own = page.blocks.flatMap(b => b.entities);
        const ids = own.map(e => e.id);
        const directive = directives.filter(d => d.kind === "layout" && d.before && ids.includes(d.before)).at(-1);
        const at = entities.findIndex(e => e.id === ids[0]);
        const after = entities[entities.findIndex(e => e.id === ids.at(-1)) + 1];
        const terminator = after && directives.find(d => d.before === after.id && d.component === END);
        const opensAnyway = at === 0
            || entities[at - 1]!.kind === "break"
            || (settings.h1StartsPage && own[0]!.kind === "heading" && own[0]!.depth === 1);
        return {
            ids,
            layout: page.layout,
            props: page.layoutProps,
            first: own[0]!.node.position.start.offset as number,
            last: terminator?.end ?? (own.at(-1)!.node.position.end.offset as number),
            held: !!directive && !opensAnyway,
            ...(directive ? { directive: { start: directive.start, end: directive.end } } : {}),
        };
    });
}

/** the palette: each component's fields from its own zod schema */
function describeComponents(registry: Registry): DocComponent[] {
    return registry.all().map(c => ({
        name: c.name,
        about: c.about,
        fields: fields(c.props),
        takes: OFFERED.filter(kind => {
            // a component's own accepts() is the answer; one that throws on a bare entity is a no
            try { return c.accepts([sample(kind)]); } catch { return false; }
        }),
    }));
}

/** the kinds an insert can make, and so the only ones a palette needs to ask about */
const OFFERED: EntityKind[] = ["list", "table", "image", "paragraph", "quote", "code"];

/** the least entity of a kind that `accepts` can be asked about */
function sample(kind: EntityKind): Entity {
    const node = kind === "image" ? { type: "image", url: "" } : { type: kind, children: [] };
    return { id: `sample-${kind}`, kind, text: "", md: "", node, ...(kind === "list" ? { ordered: false } : {}) };
}

function fields(schema: ZodTypeAny): Field[] {
    const shape = (schema as any).shape as Record<string, any> | undefined;
    if (!shape) return [];
    return Object.entries(shape).map(([name, type]) => {
        let def = type._def;
        let fallback: unknown;
        while (def.typeName === "ZodDefault" || def.typeName === "ZodOptional") {
            if (def.typeName === "ZodDefault") fallback = def.defaultValue();
            def = def.innerType._def;
        }
        const kind = def.typeName === "ZodEnum" ? "enum" : def.typeName === "ZodBoolean" ? "boolean" : def.typeName === "ZodNumber" ? "number" : "string";
        return { name, type: kind, ...(kind === "enum" ? { options: def.values as string[] } : {}), ...(fallback !== undefined ? { default: fallback } : {}) };
    });
}

/** the deck's mark as a data url, read beside the deck; a remote url passes through */
async function logoOf(logo: string | undefined, diagnostics: Diagnostic[], dir: string): Promise<string | undefined> {
    if (!logo) return undefined;
    if (/^(https?:|data:)/.test(logo)) return logo;
    const file = Bun.file(resolve(dir, logo));
    if (!(await file.exists())) {
        diagnostics.push({ level: "warn", message: `logo not found beside the deck: ${logo}` });
        return undefined;
    }
    return `data:${file.type || "image/png"};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
}

/**
 * Every local image in the pages becomes a data url, read beside the deck, so the html is one
 * file and the fit pass measures the image at its real height. Remote and data urls pass
 * through. Skipped in the studio, which serves the deck's folder itself.
 */
async function inlineImages(pages: Page[], diagnostics: Diagnostic[], dir: string): Promise<void> {
    const seen = new Map<string, string | undefined>();
    for (const image of images(pages.flatMap(p => p.blocks).flatMap(b => b.entities))) {
        if (/^(https?:|data:)/.test(image.url)) continue;
        if (!seen.has(image.url)) {
            const file = Bun.file(resolve(dir, image.url));
            if (await file.exists()) {
                seen.set(image.url, `data:${file.type || "image/png"};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`);
            } else {
                diagnostics.push({ level: "warn", message: `image not found beside the deck: ${image.url}` });
                seen.set(image.url, undefined);
            }
        }
        const inlined = seen.get(image.url);
        if (inlined) image.set(inlined);
    }
}

/*
 * Every theme by name: the ones shipped here first, then yours under `~/.ainsi/themes`. A name
 * in both is the shipped one, which is the rule themeDir() resolves by, so the shelf and the
 * renderer cannot disagree about which folder a name means.
 */
async function themeNames(): Promise<{ shipped: string[]; yours: string[] }> {
    const folders = async (at: string) =>
        (await readdir(at, { withFileTypes: true }).catch(() => [])).filter(e => e.isDirectory()).map(e => e.name).sort();
    const shipped = await folders(THEMES);
    return { shipped, yours: (await folders(USER_THEMES)).filter(name => !shipped.includes(name)) };
}

/*
 * The one thing the page cannot do for itself: the native open dialog, which belongs to the
 * shell. The shell parks on /__shell and the page posts /__shell-ask, so the door is the same
 * door on both surfaces and neither side learns the other's internals. In a browser nobody is
 * parked and the page opens its own chooser instead.
 */
let parked: ((what: string) => void) | undefined;

/*
 * A tile on the landing is the page itself, built small. A drawing of a page has to be kept in
 * step with what the renderer does and never is; this goes through the same assemble and render
 * a deck does, so a theme that changed shows here as it will on the slide.
 *
 * The overrides are the difference between a page in a deck and a page in a tile: no shell
 * around it, no shadow, and the design width, which the tile scales down to its own.
 */
/* `body.ainsi` carries the deck's shell padding and outranks a bare `body`, so the class has to
   be named here or the page sits inset inside its own thumbnail and the far side is cropped */
const THUMB_CSS = "html,body,body.ainsi{margin:0;padding:0;background:transparent;overflow:hidden}"
    + ".ainsi-page{margin:0;border-radius:0;box-shadow:none;width:1280px}";
/** the last resort, for a theme with no sample to draw and no default sample to borrow */
const THEME_SAMPLE = "# Aa\n\nBody text at this theme's measure, and a second line under it.\n";

/*
 * A theme's tile is page one of a real deck written in that theme. A theme is a page's worth of
 * decisions — a display face against a body face, how a rule sits under a heading, what the
 * accent is for — and two lines of "Aa" shows almost none of them.
 *
 * Which sample belongs to which theme is read from the samples themselves, because each one
 * already says so in its own frontmatter. A theme with no sample of its own borrows the default
 * theme's deck and is rendered in its own tokens, so a theme you wrote this morning gets a real
 * page too rather than the skeleton.
 */
const SAMPLES = resolve(import.meta.dir, "..", "samples");
/*
 * The promise, not the map it will hold: the shelf asks for every tile at once, and a cache that
 * publishes the map before it has filled it hands the rest of that burst an empty one. They then
 * find no sample for their theme and fall back to the skeleton, which is a race you only see on
 * a cold landing and never when the tiles are asked for one at a time.
 */
let byTheme: Promise<Map<string, string>> | undefined;

function samples(): Promise<Map<string, string>> {
    byTheme ??= (async () => {
        const found = new Map<string, string>();
        for (const entry of await readdir(SAMPLES, { withFileTypes: true }).catch(() => [])) {
            if (!entry.isDirectory()) continue;
            const file = join(SAMPLES, entry.name, `${entry.name}.md`);
            const source = await Bun.file(file).text().catch(() => undefined);
            if (source === undefined) continue;
            const named = parse(source).doc.settings.theme;
            if (!found.has(named)) found.set(named, file);
        }
        return found;
    })();
    return byTheme;
}

/*
 * Held per theme, and stamped with the newest mtime in its folder: the landing is visited often
 * and a build per tile per visit is waste, but a theme you are editing has to redraw or the
 * shelf lies about the folder you have open in front of you.
 */
const drawn = new Map<string, { stamp: number; tile: Promise<Response> }>();

async function themeThumb(theme: string): Promise<Response> {
    const found = await samples();
    const file = found.get(theme) ?? found.get("default");
    if (!file) return thumbnail(THEME_SAMPLE, defaultRoot, theme);
    const source = await Bun.file(file).text().catch(() => undefined);
    if (source === undefined) return thumbnail(THEME_SAMPLE, defaultRoot, theme);
    return thumbnail(source, dirname(file), theme);
}

async function thumbnail(source: string, dir: string, themeName?: string): Promise<Response> {
    const diagnostics: Diagnostic[] = [];
    const parsed = parse(source);
    const settings = { ...parsed.doc.settings, theme: themeName ?? parsed.doc.settings.theme };
    const { theme, registry, layouts } = await stack(settings.theme, diagnostics, dir);
    const options = { registry, layouts, themeCss: theme.css, viewer: { css: THUMB_CSS, script: "" } };
    const assembled = assemble(source, options);
    const pages = assembled.pages.slice(0, 1);
    await inlineImages(pages, diagnostics, dir);
    const { html } = renderPages(pages, assembled.title, settings, options);
    return Response.json({ html, ratio: settings.ratio });
}

/** whatever this platform calls to hand a file or a folder to the person at the machine */
const opener = (): string[] =>
    process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", ""] : ["xdg-open"];

/** select a file in the platform's file manager, rather than just opening the folder it sits in;
 * xdg has no standard "select" verb, so Linux falls back to the folder itself */
const revealer = (path: string): string[] =>
    process.platform === "darwin" ? ["open", "-R", path]
    : process.platform === "win32" ? ["explorer", `/select,${path}`]
    : [...opener(), dirname(path)];

/**
 * Open a deck, or hand back the one already open on that file. The build comes first: a deck
 * that will not build is not a window, and the caller gets what it threw.
 */
const starting = new Map<string, Promise<Open>>();

async function openDeck(path: string): Promise<Open> {
    const found = byPath.get(path);
    if (found) return found;
    // the build is awaited, so two asks for one file have to share it: the second would land
    // between the check and the record and register a window of its own on the same deck
    const already = starting.get(path);
    if (already) return already;
    const started = (async () => {
        const entry: Open = { id: "", path, doc: blankDoc() };
        const built = await build(path, entry);
        entry.id = server.open({
            deck: path,
            initial: stamp(built.html),
            rebuild: async () => stamp((await build(entry.path, entry)).html),
            roots: built.roots,
        });
        decks.set(entry.id, entry);
        byPath.set(path, entry);
        browseRoots.add(dirname(path));
        console.log(`-> ${path}`);
        return entry;
    })();
    starting.set(path, started);
    try {
        return await started;
    } finally {
        starting.delete(path);
    }
}

/** the reverse: the window on it lands back on the chooser, and nothing beside it is watched */
function closeDeck(entry: Open): void {
    server.close(entry.id);
    decks.delete(entry.id);
    byPath.delete(entry.path);
}

/** a path the browser asked for, resolved under one of the browse roots or refused */
function under(at: unknown, fallback = defaultRoot): string | undefined {
    const asked = typeof at === "string" && at ? at : fallback;
    const path = resolve(fallback, asked);
    for (const root of browseRoots) if (path === root || path.startsWith(root + "/")) return path;
    return undefined;
}

/** the theme and the component and layout registries a build renders through */
async function stack(themeName: string, diagnostics: Diagnostic[], dir: string) {
    const themeDir = themePath(themeName, dir);
    const theme = await loadTheme(themeDir, diagnostics);
    const registry = await load(undefined, diagnostics);
    const layouts = await loadLayouts(theme.layouts, diagnostics);
    return { themeDir, theme, registry, layouts };
}

/** The fitted pages printed without viewer or handles, beside the deck, over whatever is there. */
async function print(pages: Page[], title: string, settings: Settings, options: BuildOptions, to: string, images: PdfImages = pdfImages): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const { html } = renderPages(pages, title, settings, { ...options, viewer: undefined, edit: false });
    return pdf(html, to, await measuring(), images);
}

/** what every export starts from: the deck as it is on disk, fitted */
async function fitted(path: string, diagnostics: Diagnostic[]) {
    const dir = dirname(path);
    const source = await Bun.file(path).text();
    const settings = parse(source).doc.settings;
    const { theme, registry, layouts } = await stack(settings.theme, diagnostics, dir);
    const options = { registry, layouts, themeCss: theme.css, logo: await logoOf(settings.logo, diagnostics, dir), coverLogo: await logoOf(settings.coverLogo, diagnostics, dir) };
    const assembled = assemble(source, options);
    await inlineImages(assembled.pages, diagnostics, dir);
    const result = await fit(assembled.pages, assembled.title, assembled.settings, options, renderPages, await measuring());
    diagnostics.push(...assembled.diagnostics, ...result.diagnostics);
    return { pages: result.pages, title: assembled.title, settings: assembled.settings, options };
}

/** what the studio's export runs: the deck as it is on disk, fitted, printed, and opened */
async function exportPdf(path: string, images: PdfImages): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const diagnostics: Diagnostic[] = [];
    const built = await fitted(path, diagnostics);
    const printed = await print(built.pages, built.title, built.settings, built.options, outputFor(path, ".pdf"), images);
    diagnostics.push(...printed.diagnostics);
    return { written: printed.written, diagnostics };
}

/** the same deck as an editable pptx: raster ground per page, native text boxes above it */
async function exportPptx(path: string): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const diagnostics: Diagnostic[] = [];
    const built = await fitted(path, diagnostics);
    const { html } = renderPages(built.pages, built.title, built.settings, { ...built.options, viewer: undefined, edit: false });
    const written = await pptx(html, outputFor(path, ".pptx"), await measuring());
    diagnostics.push(...written.diagnostics);
    return { written: written.written, diagnostics };
}

/*
 * A packed deck is not a rendered one: it is the markdown and what it references, so it skips
 * the pipeline entirely rather than building a page nobody asked for.
 */
if (building && format === "zip") {
    const diagnostics: Diagnostic[] = [];
    const packed = await pack(opening!, diagnostics);
    const to = outputFor(opening!, ".zip");
    await Bun.write(to, packed.bytes);
    for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
    console.log(`${packed.name}/ -> ${to}`);
    process.exit(0);
}

/*
 * Who asked, on the page itself. The shell announces itself in AINSI_HOST and the chrome
 * branches on it: in the app the studio's own bar is the window's titlebar, in a browser it
 * floats over the deck. Stamped on what is served rather than on what build() returns, so the
 * html written beside the deck says nothing about who was looking at it.
 */
const stamp = (html: string) => (host ? html.replace("\n<body", `\n<body data-ainsi-host="${host}"`) : html);

if (!editing) {
    await build(opening!);
    await session?.close();
    process.exit(0);
}

/** the routes that mean nothing without a deck, and so nothing outside a /d/<id>/ window */
const DECK_SCOPED = new Set(["/__doc", "/__edit", "/__pdf", "/__zip", "/__pptx", "/__close", "/__rename"]);

/*
 * The chooser is what the server is; a deck is a tenant it grows, under /d/<id>/, one per
 * window. Every route that acts on a deck is reached through that prefix and is handed the
 * deck it names, so a window can only ever write the deck it is showing.
 */
const server = serve({
    port,
    initial: stamp(await loadStart()),
    // the chrome, plus each deck's theme as it opens: components and layouts are imported now,
    // so a change to one needs the process restarted and a watch over them could not honour it
    roots: [...CHROME],
    rebuild: async () => stamp(await loadStart()),
    route: async (request, url, id) => {
        const entry = id ? decks.get(id) : undefined;

        if (entry) {
            const path = entry.path;
            if (url.pathname === "/__doc") return Response.json(entry.doc);
            if (url.pathname === "/__pdf" && request.method === "POST") {
                const wanted = url.searchParams.get("images") ?? "screen";
                if (!PDF_IMAGES.includes(wanted as PdfImages)) return new Response(`images takes ${PDF_IMAGES.join(", ")}`, { status: 400 });
                const { written, diagnostics } = await exportPdf(path, wanted as PdfImages);
                for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
                if (!written) return new Response(diagnostics.map(d => d.message).join("\n") || "pdf failed", { status: 500 });
                const to = outputFor(path, ".pdf");
                console.log(`-> ${to}`);
                // the person asked from a browser on this machine, so the answer lands in their viewer
                Bun.spawn([...opener(), to], { stdout: "ignore", stderr: "ignore" }).unref();
                return Response.json({ path: to });
            }
            if (url.pathname === "/__zip" && request.method === "POST") {
                const diagnostics: Diagnostic[] = [];
                const packed = await pack(path, diagnostics);
                const to = outputFor(path, ".zip");
                await Bun.write(to, packed.bytes);
                for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
                console.log(`${packed.name}/ -> ${to}`);
                // the deck is for sending on, so the answer is its folder open rather than the file
                Bun.spawn([...opener(), dirname(to)], { stdout: "ignore", stderr: "ignore" }).unref();
                return Response.json({ path: to });
            }
            if (url.pathname === "/__pptx" && request.method === "POST") {
                let outcome: { written: boolean; diagnostics: Diagnostic[] };
                try {
                    outcome = await exportPptx(path);
                } catch (err) {
                    console.error(err);
                    return new Response(err instanceof Error ? err.message : String(err), { status: 500 });
                }
                const { written, diagnostics } = outcome;
                for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
                if (!written) return new Response(diagnostics.map(d => d.message).join("\n") || "pptx failed", { status: 500 });
                const to = outputFor(path, ".pptx");
                console.log(`-> ${to}`);
                Bun.spawn([...opener(), to], { stdout: "ignore", stderr: "ignore" }).unref();
                return Response.json({ path: to });
            }
            if (url.pathname === "/__edit" && request.method === "POST") {
                const arrived = performance.now();
                const { hash, start, end, text } = await request.json();
                const source = await Bun.file(path).text();
                // a splice against a stale offset corrupts the file rather than losing an edit
                if (Bun.hash(source).toString(16) !== hash) return new Response("stale", { status: 409 });
                const sane = Number.isInteger(start) && Number.isInteger(end)
                    && start >= 0 && end >= start && end <= source.length && typeof text === "string";
                if (!sane) return new Response("bad splice", { status: 400 });
                const wrote = performance.now();
                await Bun.write(path, source.slice(0, start) + text + source.slice(end));
                if (trace) console.log(`  edit: read and splice ${Math.round(wrote - arrived)} ms, write ${Math.round(performance.now() - wrote)} ms`);
                // the rebuild is scheduled here rather than left to the watcher: a missed or
                // misnamed watch event would leave the studio's editor waiting for a reload forever
                server.changed(entry.id, basename(path), true);
                return new Response("ok");
            }
            if (url.pathname === "/__close" && request.method === "POST") {
                closeDeck(entry);
                return Response.json({ ok: true });
            }
            if (url.pathname === "/__rename" && request.method === "POST") {
                const { name } = await request.json();
                const wanted = typeof name === "string" ? name.trim() : "";
                if (!wanted || /[\\/]/.test(wanted)) return new Response("a file name, without a path", { status: 400 });
                const next = join(dirname(path), extname(wanted) ? wanted : `${wanted}.md`);
                if (next !== path) {
                    if (await Bun.file(next).exists()) return new Response(`${basename(next)} exists`, { status: 409 });
                    // the html written beside the deck follows it, so no orphan is left under the old name
                    const html = sibling(path, ".html");
                    await rename(path, next);
                    byPath.delete(path);
                    entry.path = next;
                    byPath.set(next, entry);
                    if (await Bun.file(html).exists() && !(await Bun.file(sibling(next, ".html")).exists())) await rename(html, sibling(next, ".html"));
                    // the id and so the window's url are untouched: only the file moved
                    server.move(entry.id, next);
                    server.changed(entry.id, basename(next), true);
                }
                return Response.json({ file: basename(entry.path) });
            }
        }

        // what a deck window and the chooser both reach, and what the chooser reaches alone
        if (url.pathname === "/__theme-previews") {
            const { shipped, yours } = await themeNames();
            const themes = await Promise.all([...shipped, ...yours].map(async name => {
                const css = await Bun.file(join(themePath(name, defaultRoot), "variables.css")).text().catch(() => "");
                const kind = shipped.includes(name) ? "shipped" : yours.includes(name) ? "yours"
                    : name.startsWith("..") ? "../brand" : name.startsWith(".") ? "local" : "folder";
                return { id: name, name: name.charAt(0).toUpperCase() + name.slice(1), kind, ...themeTokens(css) };
            }));
            return Response.json({ themes });
        }
        if (url.pathname === "/__themes") {
            const { shipped, yours } = await themeNames();
            // a deck on a theme of its own is still on it, and the page knows which theme that
            // is from its own /__doc, so this is the shelf and nothing about any one deck
            return Response.json({ themes: [...shipped, ...yours] });
        }
        if (url.pathname === "/__recents") {
            const list = await readRecents();
            const withPreviews = await Promise.all(list.map(async r => {
                const found = await Bun.file(r.path).exists();
                const css = await Bun.file(join(themePath(r.theme, dirname(r.path)), "variables.css")).text().catch(() => "");
                return { ...r, found, ...themeTokens(css) };
            }));
            // pinned first, then the ones still on disk: a deck that has moved is worth showing,
            // but never ahead of one you can open
            withPreviews.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.found) - Number(a.found) || b.lastOpened - a.lastOpened);
            // a row of covers is cheap: an entry is a path and what its last build said, and the
            // grid wraps, so the cap is about how far back a deck is worth looking for
            return Response.json(withPreviews.slice(0, 16));
        }
        if (url.pathname === "/__pin" && request.method === "POST") {
            const { path, pinned } = await request.json();
            if (typeof path !== "string" || typeof pinned !== "boolean") return new Response("path and pinned", { status: 400 });
            const list = await readRecents();
            const found = list.find(r => r.path === path);
            if (!found) return new Response("not a recent", { status: 404 });
            found.pinned = pinned;
            await writeRecents(list);
            return Response.json({ ok: true });
        }
        if (url.pathname === "/__skills") return Response.json({ installed: await skillsInstalled() });
        if (url.pathname === "/__thumb") {
            const theme = url.searchParams.get("theme");
            if (theme) {
                const stamp = await newest(themePath(theme, defaultRoot)).catch(() => 0);
                const held = drawn.get(theme);
                if (held?.stamp !== stamp) drawn.set(theme, { stamp, tile: themeThumb(theme) });
                return (await drawn.get(theme)!.tile).clone();
            }
            // only a deck already on the recents list: the allowlist is the list the page is
            // drawing, which is narrower than "any markdown under the root"
            const path = url.searchParams.get("deck");
            if (!path || !(await readRecents()).some(r => r.path === path)) return new Response("not a recent", { status: 403 });
            const source = await Bun.file(path).text().catch(() => undefined);
            if (source === undefined) return new Response("gone", { status: 404 });
            return thumbnail(source, dirname(path));
        }
        // what a desktop shell's menu is drawn against: which deck this window holds, if any,
        // and every deck the process is serving
        if (url.pathname === "/__state") {
            return Response.json({
                deck: entry ? basename(entry.path) : null,
                decks: [...decks.values()].map(open => ({ id: open.id, file: basename(open.path), url: `/d/${open.id}/` })),
            });
        }
        if (url.pathname === "/__shell") {
            const what = await new Promise<string | undefined>(resolve => {
                parked?.(""); // one shell at a time; an older wait is stale by definition
                parked = resolve;
                request.signal.addEventListener("abort", () => { if (parked === resolve) parked = undefined; resolve(undefined); });
            });
            return what ? Response.json({ what }) : new Response("", { status: 204 });
        }
        if (url.pathname === "/__shell-ask" && request.method === "POST") {
            const { what } = await request.json();
            if (!parked) return new Response("no shell to ask", { status: 409 });
            parked(String(what));
            parked = undefined;
            return Response.json({ ok: true });
        }
        /*
         * Folders the person is meant to edit by hand, handed to the file manager. Named rather
         * than pathed: an endpoint on localhost taking a path would open anything on the machine
         * for any page in the browser.
         */
        if (url.pathname === "/__reveal" && request.method === "POST") {
            const { what, path } = await request.json();
            // a recent's own file, selected rather than just opening its folder: the allowlist is
            // the list the page is showing, same as /__thumb, not any path a page can ask for
            if (typeof path === "string") {
                if (!(await readRecents()).some(r => r.path === path)) return new Response("not a recent", { status: 403 });
                Bun.spawn(revealer(path), { stdout: "ignore", stderr: "ignore" }).unref();
                return Response.json({ path });
            }
            const at = what === "themes" ? USER_THEMES : what === "skills" ? PLUGINS : undefined;
            if (!at) return new Response("themes, skills or path", { status: 400 });
            // yours is made on the way there; the plugins folder is Claude Code's to make
            if (what === "themes") await mkdir(at, { recursive: true });
            else if (!existsSync(at)) return new Response(`nothing at ${at} yet`, { status: 404 });
            Bun.spawn([...opener(), at], { stdout: "ignore", stderr: "ignore" }).unref();
            return Response.json({ path: at });
        }
        /* only a recent's markdown file, never what it links to: a deck that draws on images or
         * fonts beside it keeps them, so the person is told that before they confirm */
        if (url.pathname === "/__delete" && request.method === "POST") {
            const { path } = await request.json();
            if (typeof path !== "string") return new Response("path", { status: 400 });
            const list = await readRecents();
            if (!list.some(r => r.path === path)) return new Response("not a recent", { status: 403 });
            // a window on the deck that just went is a window on nothing; it lands on the chooser
            const open = byPath.get(path);
            if (open) closeDeck(open);
            await rm(path, { force: true });
            await writeRecents(list.filter(r => r.path !== path));
            return Response.json({ ok: true });
        }
        /* a theme of your own starts as a copy of the default, which is the one theme that
         * declares every token; an empty folder would render as the default anyway and teach
         * nothing about what to change */
        if (url.pathname === "/__theme-new" && request.method === "POST") {
            const { yours } = await themeNames();
            let id = "mytheme";
            for (let n = 2; yours.includes(id); n++) id = `mytheme-${n}`;
            await mkdir(USER_THEMES, { recursive: true });
            await cp(join(THEMES, "default"), join(USER_THEMES, id), { recursive: true });
            console.log(`-> ${join(USER_THEMES, id)}`);
            Bun.spawn([...opener(), join(USER_THEMES, id)], { stdout: "ignore", stderr: "ignore" }).unref();
            return Response.json({ id, path: join(USER_THEMES, id) });
        }
        if (url.pathname === "/__browse") {
            const at = under(url.searchParams.get("at"), entry ? dirname(entry.path) : defaultRoot);
            if (!at) return new Response("outside the folders the studio can reach", { status: 403 });
            const entries = await readdir(at, { withFileTypes: true });
            const listed = entries
                .filter(e => !e.name.startsWith(".") && (e.isDirectory() || e.name.endsWith(".md")))
                .map(e => ({ name: e.name, dir: e.isDirectory() }))
                .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
            return Response.json({
                at,
                here: basename(at) || at,
                up: browseRoots.has(at) ? undefined : dirname(at),
                entries: listed,
                // every deck of this folder that already has a window; opening one goes there
                open: [...byPath.keys()].filter(p => dirname(p) === at).map(p => basename(p)),
            });
        }
        /*
         * Opening and making a deck answer with the deck, never with a reload: the window that
         * asked may not be the window it belongs in, and on the desktop it never is.
         */
        if (url.pathname === "/__new" && request.method === "POST") {
            const { at, theme } = await request.json();
            // no folder named means beside the deck the window is on: what a File menu asks for,
            // having no idea where in the tree the chooser last was
            const dir = under(at, entry ? dirname(entry.path) : defaultRoot);
            if (!dir) return new Response("outside the folders the studio can reach", { status: 403 });
            const made = await openDeck(await untitled(dir, typeof theme === "string" ? theme : undefined));
            return Response.json({ id: made.id, url: `/d/${made.id}/`, file: basename(made.path) });
        }
        if (url.pathname === "/__open" && request.method === "POST") {
            const { path } = await request.json();
            // a path the shell carried out of a native dialog answers for itself; anything the
            // page asked for stays inside the roots, and opening widens them by that folder
            const next = fromShell(request) && typeof path === "string" ? resolve(path) : under(path);
            if (!next || !next.endsWith(".md")) return new Response("a markdown deck under a folder the studio can reach", { status: 403 });
            if (!(await Bun.file(next).exists())) return new Response(`${basename(next)} is gone`, { status: 404 });
            const found = await openDeck(next).catch((error: unknown) => String(error));
            if (typeof found === "string") return new Response(found, { status: 500 });
            return Response.json({ id: found.id, url: `/d/${found.id}/`, file: basename(found.path) });
        }

        // a deck's own endpoint, asked for at the root: there is no deck there to act on
        if (DECK_SCOPED.has(url.pathname)) return new Response("no deck open", { status: 409 });
        return undefined;
    },
});

if (host) console.log(`shell key ${SHELL_KEY}`);
console.log(`studio on ${server.url}`);
if (opening) {
    const started = await openDeck(opening);
    console.log(`deck on ${server.url}/d/${started.id}/`);
}
async function shutdown(): Promise<never> {
    await server.stop();
    await session?.close();
    process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, shutdown);

/*
 * A desktop host holds the studio open through stdin and writes nothing down it. Its end
 * closing is the window being gone, including when the host was killed outright and no signal
 * ever reached here, and a studio nobody can open should not keep its port or its browser.
 */
if (host) void (async () => {
    for await (const _ of Bun.stdin.stream()) { /* nothing is ever said, only the closing */ }
    await shutdown();
})();
