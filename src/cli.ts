#!/usr/bin/env bun
import { mkdir, readdir, rename } from "node:fs/promises";
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
import { CHROME, THEMES, load, loadLayouts, loadStart, loadStudio, loadTheme, loadViewer, themeDir as themePath } from "./load";
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
async function skillsInstalled(): Promise<boolean> {
    try {
        const raw = JSON.parse(await Bun.file(join(homedir(), ".claude", "plugins", "installed_plugins.json")).text());
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
let deck: string | undefined = input ? resolve(input) : undefined;
/*
 * What the studio's file browser may reach: where the command was run, or the deck's own
 * folder when the deck lies outside it. The studio is an http server on localhost, so an
 * endpoint taking any path would let any page in the browser read any file on the machine
 * through it. To work on a deck elsewhere, start the studio there.
 */
const browseRoot = deck && !deck.startsWith(process.cwd() + "/") ? dirname(deck) : process.cwd();
const editing = !building;
const sibling = (ext: string): string => {
    const path = deck!;
    return join(dirname(path), `${basename(path, extname(path))}${ext}`);
};
const target = flag("-o");
const to = flag("--to");
if (to && !FORMATS.includes(to as typeof FORMATS[number])) fail(`--to takes ${FORMATS.join(", ")}; got "${to}"`);
if (target && to && extname(target).slice(1) !== to) fail(`-o ${target} and --to ${to} disagree`);
const pdfFlag = args.find(a => a === "--pdf" || a.startsWith("--pdf="));
const format: typeof FORMATS[number] = building && (to === "zip" || extname(target ?? "").toLowerCase() === ".zip") ? "zip"
    : building && (to === "pdf" || extname(target ?? "").toLowerCase() === ".pdf" || pdfFlag) ? "pdf" : "html";
const printing = format === "pdf";
let output = deck ? (target && format === "html" ? resolve(target) : sibling(".html")) : "";
let pdfOutput = deck ? (target && format === "pdf" ? resolve(target) : sibling(".pdf")) : "";
let pptxOutput = deck ? sibling(".pptx") : "";
let zipOutput = deck ? (target && format === "zip" ? resolve(target) : sibling(".zip")) : "";
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
let doc = {
    hash: "", source: "", file: "",
    layout: "default",
    entities: [] as { id: string; kind: string; start: number; end: number; md: string; accepted: string[] }[],
    blocks: [] as DocBlock[],
    pages: [] as DocPage[],
    components: [] as DocComponent[],
    layouts: [] as DocLayout[],
};
let currentTheme = "default";
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

/** Everything the deck is made of, rebuilt from disk. Returns the html and what to watch. */
async function build(): Promise<{ html: string; roots: string[] }> {
    const clock = stopwatch();
    const source = await Bun.file(deck!).text();
    const parsed = parse(source);
    const settings = parsed.doc.settings;
    currentTheme = settings.theme;
    clock.mark("parse");
    const diagnostics: Diagnostic[] = [];
    const { themeDir, theme, registry, layouts } = await stack(settings.theme, diagnostics);
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
    const buildOptions = { registry, layouts, themeCss: theme.css, viewer, edit: editing, logo: await logoOf(settings.logo, diagnostics), coverLogo: await logoOf(settings.coverLogo, diagnostics) };

    const assembled = assemble(source, buildOptions);
    clock.mark("assemble");
    diagnostics.push(...assembled.diagnostics);
    if (!editing) await inlineImages(assembled.pages, diagnostics);
    if (editing) {
        doc = {
            hash: Bun.hash(source).toString(16),
            source,
            file: basename(deck!),
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

    if (editing) clock.mark("describe");
    const result = fitting
        ? await fit(assembled.pages, assembled.title, assembled.settings, buildOptions, renderPages, session)
        : { ...renderPages(assembled.pages, assembled.title, assembled.settings, buildOptions), pages: assembled.pages };
    clock.mark(fitting ? "fit" : "render");
    diagnostics.push(...result.diagnostics);

    let written = output;
    if (printing) {
        const printed = await print(result.pages, assembled.title, assembled.settings, buildOptions);
        diagnostics.push(...printed.diagnostics);
        // no browser means no pdf; the summary says where the pages went, not where they would have
        written = printed.written ? pdfOutput : "";
    } else {
        await Bun.write(output, result.html);
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
    if (editing) await recordRecent(deck!, assembled.title, result.pages.length, settings.theme);

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
async function logoOf(logo: string | undefined, diagnostics: Diagnostic[]): Promise<string | undefined> {
    if (!logo) return undefined;
    if (/^(https?:|data:)/.test(logo)) return logo;
    const file = Bun.file(resolve(dirname(deck!), logo));
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
async function inlineImages(pages: Page[], diagnostics: Diagnostic[]): Promise<void> {
    const seen = new Map<string, string | undefined>();
    for (const image of images(pages.flatMap(p => p.blocks).flatMap(b => b.entities))) {
        if (/^(https?:|data:)/.test(image.url)) continue;
        if (!seen.has(image.url)) {
            const file = Bun.file(resolve(dirname(deck!), image.url));
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

/** whatever this platform calls to hand a file or a folder to the person at the machine */
const opener = (): string[] =>
    process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", ""] : ["xdg-open"];

/** point the studio at another deck: the outputs, the watch and the editor follow it */
function retarget(next: string): void {
    const first = deck === undefined;
    deck = next;
    output = sibling(".html");
    pdfOutput = sibling(".pdf");
    pptxOutput = sibling(".pptx");
    zipOutput = sibling(".zip");
    server.retarget(deck);
    server.changed(basename(deck), true);
    if (first) console.log(`-> ${deck}`);
}

/** a path the browser asked for, resolved under the browse root or refused */
function under(root: string, at: unknown): string | undefined {
    const path = resolve(root, typeof at === "string" ? at : "");
    return path === root || path.startsWith(root + "/") ? path : undefined;
}

/** the theme and the component and layout registries a build renders through */
async function stack(themeName: string, diagnostics: Diagnostic[]) {
    const themeDir = themePath(themeName, dirname(deck!));
    const theme = await loadTheme(themeDir, diagnostics);
    const registry = await load(undefined, diagnostics);
    const layouts = await loadLayouts(theme.layouts, diagnostics);
    return { themeDir, theme, registry, layouts };
}

/** The fitted pages printed without viewer or handles, beside the deck, over whatever is there. */
async function print(pages: Page[], title: string, settings: Settings, options: BuildOptions, images: PdfImages = pdfImages): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const { html } = renderPages(pages, title, settings, { ...options, viewer: undefined, edit: false });
    return pdf(html, pdfOutput, await measuring(), images);
}

/** what every export starts from: the deck as it is on disk, fitted */
async function fitted(diagnostics: Diagnostic[]) {
    const source = await Bun.file(deck!).text();
    const settings = parse(source).doc.settings;
    const { theme, registry, layouts } = await stack(settings.theme, diagnostics);
    const options = { registry, layouts, themeCss: theme.css, logo: await logoOf(settings.logo, diagnostics), coverLogo: await logoOf(settings.coverLogo, diagnostics) };
    const assembled = assemble(source, options);
    await inlineImages(assembled.pages, diagnostics);
    const result = await fit(assembled.pages, assembled.title, assembled.settings, options, renderPages, await measuring());
    diagnostics.push(...assembled.diagnostics, ...result.diagnostics);
    return { pages: result.pages, title: assembled.title, settings: assembled.settings, options };
}

/** what the studio's export runs: the deck as it is on disk, fitted, printed, and opened */
async function exportPdf(images: PdfImages): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const diagnostics: Diagnostic[] = [];
    const built = await fitted(diagnostics);
    const printed = await print(built.pages, built.title, built.settings, built.options, images);
    diagnostics.push(...printed.diagnostics);
    return { written: printed.written, diagnostics };
}

/** the same deck as an editable pptx: raster ground per page, native text boxes above it */
async function exportPptx(): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const diagnostics: Diagnostic[] = [];
    const built = await fitted(diagnostics);
    const { html } = renderPages(built.pages, built.title, built.settings, { ...built.options, viewer: undefined, edit: false });
    const written = await pptx(html, pptxOutput, await measuring());
    diagnostics.push(...written.diagnostics);
    return { written: written.written, diagnostics };
}

/*
 * A packed deck is not a rendered one: it is the markdown and what it references, so it skips
 * the pipeline entirely rather than building a page nobody asked for.
 */
if (building && format === "zip") {
    const diagnostics: Diagnostic[] = [];
    const packed = await pack(deck!, diagnostics);
    await Bun.write(zipOutput, packed.bytes);
    for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
    console.log(`${packed.name}/ -> ${zipOutput}`);
    process.exit(0);
}

/*
 * Who asked, on the page itself. The shell announces itself in AINSI_HOST and the chrome
 * branches on it: in the app the studio's own bar is the window's titlebar, in a browser it
 * floats over the deck. Stamped on what is served rather than on what build() returns, so the
 * html written beside the deck says nothing about who was looking at it.
 */
const stamp = (html: string) => (host ? html.replace("\n<body", `\n<body data-ainsi-host="${host}"`) : html);

const first = deck ? await build() : { html: await loadStart(), roots: [] as string[] };

if (!editing) {
    await session?.close();
    process.exit(0);
}

const server = serve({
    deck,
    port,
    initial: stamp(first.html),
    // the chrome and the theme, and nothing else: components and layouts are imported now, so
    // a change to one needs the process restarted and a watch over them could not honour it
    roots: [...CHROME, ...first.roots],
    rebuild: async () => stamp((await build()).html),
    route: editing ? async (request, url) => {
        // before a deck is chosen the studio is the start page, and only browsing, opening
        // and making a deck mean anything
        const CHOOSE = new Response("no deck open", { status: 409 });
        // the landing needs its own data before any deck is open, same as browse/open/new
        const LANDING = ["/__browse", "/__open", "/__new", "/__theme-previews", "/__recents", "/__pin", "/__skills"];
        if (!deck && !LANDING.includes(url.pathname)) return url.pathname.startsWith("/__") ? CHOOSE : undefined;
        if (url.pathname === "/__doc") return Response.json(doc);
        if (url.pathname === "/__theme-previews") {
            const shipped = (await readdir(THEMES, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
            const names = shipped.includes(currentTheme) ? shipped : [...shipped, currentTheme];
            const themes = await Promise.all(names.map(async name => {
                const css = await Bun.file(join(themePath(name, deck ? dirname(deck) : browseRoot), "variables.css")).text().catch(() => "");
                const kind = shipped.includes(name) ? "shipped" : name.startsWith("..") ? "../brand" : name.startsWith(".") ? "local" : "folder";
                return { id: name, name: name.charAt(0).toUpperCase() + name.slice(1), kind, ...themeTokens(css) };
            }));
            return Response.json({ themes, current: currentTheme });
        }
        if (url.pathname === "/__recents") {
            const list = await readRecents();
            const withPreviews = await Promise.all(list.map(async r => {
                const found = await Bun.file(r.path).exists();
                const css = await Bun.file(join(themePath(r.theme, dirname(r.path)), "variables.css")).text().catch(() => "");
                return { ...r, found, ...themeTokens(css) };
            }));
            withPreviews.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpened - a.lastOpened);
            return Response.json(withPreviews.slice(0, 6));
        }
        if (url.pathname === "/__pin" && request.method === "POST") {
            const { path, pinned } = await request.json();
            if (typeof path !== "string" || typeof pinned !== "boolean") return new Response("path and pinned", { status: 400 });
            const list = await readRecents();
            const entry = list.find(r => r.path === path);
            if (!entry) return new Response("not a recent", { status: 404 });
            entry.pinned = pinned;
            await writeRecents(list);
            return Response.json({ ok: true });
        }
        if (url.pathname === "/__skills") return Response.json({ installed: await skillsInstalled() });
        if (url.pathname === "/__themes") {
            const themes = (await readdir(THEMES, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
            // a deck on a theme of its own is still on it; the picker says so rather than
            // showing a list the current theme is not in
            if (!themes.includes(currentTheme)) themes.unshift(currentTheme);
            return Response.json({ themes, current: currentTheme });
        }
        if (url.pathname === "/__pdf" && request.method === "POST") {
            const wanted = url.searchParams.get("images") ?? "screen";
            if (!PDF_IMAGES.includes(wanted as PdfImages)) return new Response(`images takes ${PDF_IMAGES.join(", ")}`, { status: 400 });
            const { written, diagnostics } = await exportPdf(wanted as PdfImages);
            for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
            if (!written) return new Response(diagnostics.map(d => d.message).join("\n") || "pdf failed", { status: 500 });
            console.log(`-> ${pdfOutput}`);
            // the person asked from a browser on this machine, so the answer lands in their viewer
            Bun.spawn([...opener(), pdfOutput], { stdout: "ignore", stderr: "ignore" }).unref();
            return Response.json({ path: pdfOutput });
        }
        if (url.pathname === "/__zip" && request.method === "POST") {
            const diagnostics: Diagnostic[] = [];
            const packed = await pack(deck!, diagnostics);
            await Bun.write(zipOutput, packed.bytes);
            for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
            console.log(`${packed.name}/ -> ${zipOutput}`);
            // the deck is for sending on, so the answer is its folder open rather than the file
            Bun.spawn([...opener(), dirname(zipOutput)], { stdout: "ignore", stderr: "ignore" }).unref();
            return Response.json({ path: zipOutput });
        }
        if (url.pathname === "/__pptx" && request.method === "POST") {
            const { written, diagnostics } = await exportPptx();
            for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
            if (!written) return new Response(diagnostics.map(d => d.message).join("\n") || "pptx failed", { status: 500 });
            console.log(`-> ${pptxOutput}`);
            Bun.spawn([...opener(), pptxOutput], { stdout: "ignore", stderr: "ignore" }).unref();
            return Response.json({ path: pptxOutput });
        }
        if (url.pathname === "/__edit" && request.method === "POST") {
            const arrived = performance.now();
            const { hash, start, end, text } = await request.json();
            const source = await Bun.file(deck!).text();
            // a splice against a stale offset corrupts the file rather than losing an edit
            if (Bun.hash(source).toString(16) !== hash) return new Response("stale", { status: 409 });
            const sane = Number.isInteger(start) && Number.isInteger(end)
                && start >= 0 && end >= start && end <= source.length && typeof text === "string";
            if (!sane) return new Response("bad splice", { status: 400 });
            const wrote = performance.now();
            await Bun.write(deck!, source.slice(0, start) + text + source.slice(end));
            if (trace) console.log(`  edit: read and splice ${Math.round(wrote - arrived)} ms, write ${Math.round(performance.now() - wrote)} ms`);
            // the rebuild is scheduled here rather than left to the watcher: a missed or
            // misnamed watch event would leave the studio's editor waiting for a reload forever
            server.changed(basename(deck!), true);
            return new Response("ok");
        }
        if (url.pathname === "/__browse") {
            const at = under(browseRoot, url.searchParams.get("at") ?? (deck ? dirname(deck) : browseRoot));
            if (!at) return new Response("outside the folder the studio was started in", { status: 403 });
            const entries = await readdir(at, { withFileTypes: true });
            const listed = entries
                .filter(e => !e.name.startsWith(".") && (e.isDirectory() || e.name.endsWith(".md")))
                .map(e => ({ name: e.name, dir: e.isDirectory() }))
                .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
            return Response.json({
                at: relative(browseRoot, at),
                here: basename(at) || basename(browseRoot),
                up: at === browseRoot ? undefined : relative(browseRoot, dirname(at)),
                entries: listed,
                current: deck && at === dirname(deck) ? basename(deck) : undefined,
            });
        }
        if (url.pathname === "/__new" && request.method === "POST") {
            const { at, theme } = await request.json();
            // no folder named means beside the deck that is open: what a File menu asks for,
            // having no idea where in the tree the chooser last was
            const dir = at === undefined && deck ? dirname(deck) : under(browseRoot, at);
            if (!dir) return new Response("outside the folder the studio was started in", { status: 403 });
            retarget(await untitled(dir, typeof theme === "string" ? theme : undefined));
            return Response.json({ file: basename(deck!) });
        }
        if (url.pathname === "/__open" && request.method === "POST") {
            const { path } = await request.json();
            const next = under(browseRoot, path);
            if (!next || !next.endsWith(".md")) return new Response("a markdown deck under the studio's folder", { status: 403 });
            if (!(await Bun.file(next).exists())) return new Response(`${basename(next)} is gone`, { status: 404 });
            // the theme and component roots were handed to the watcher at startup, so a deck on
            // another theme rebuilds on its own edits but not on that theme's
            if (next !== deck) retarget(next);
            return Response.json({ file: basename(deck!) });
        }
        if (url.pathname === "/__rename" && request.method === "POST") {
            const { name } = await request.json();
            const wanted = typeof name === "string" ? name.trim() : "";
            if (!wanted || /[\\/]/.test(wanted)) return new Response("a file name, without a path", { status: 400 });
            const next = join(dirname(deck!), extname(wanted) ? wanted : `${wanted}.md`);
            if (next !== deck) {
                if (await Bun.file(next).exists()) return new Response(`${basename(next)} exists`, { status: 409 });
                // the html written beside the deck follows it, so no orphan is left under the old name
                const html = sibling(".html");
                await rename(deck!, next);
                // sibling() reads deck, and the html that follows the deck is the new name's
                deck = next;
                if (await Bun.file(html).exists() && !(await Bun.file(sibling(".html")).exists())) await rename(html, sibling(".html"));
                retarget(next);
            }
            return Response.json({ file: basename(deck!) });
        }
        return undefined;
    } : undefined,
});

console.log(`studio on ${server.url}`);

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
