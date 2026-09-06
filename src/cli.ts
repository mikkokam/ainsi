#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { assemble, render as renderPages, type BuildOptions } from "./build";
import { fit, openFit, type FitSession } from "./fit";
import { parse } from "./parse";
import { pdf } from "./pdf";
import { serve } from "./serve";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadStudio, loadTheme, loadViewer } from "./load";
import type { Diagnostic, Page, Settings } from "./types";

const argv = process.argv.slice(2);
const input = argv.find(a => !a.startsWith("-") && argv[argv.indexOf(a) - 1] !== "-o" && argv[argv.indexOf(a) - 1] !== "--port" && argv[argv.indexOf(a) - 1] !== "--components");

if (!input) {
    console.error("usage: pac <deck.md> [-o out.html] [--watch] [--edit] [--no-viewer] [--fit] [--pdf] [--port 4321] [--components <dir>]");
    process.exit(1);
}

const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
};

const deck = resolve(input);
const output = resolve(flag("-o") ?? join(dirname(deck), `${basename(deck, extname(deck))}.html`));
const pdfOutput = join(dirname(deck), `${basename(deck, extname(deck))}.pdf`);
const componentRoots = argv.flatMap((a, i) => (a === "--components" && argv[i + 1] ? [resolve(argv[i + 1]!)] : []));
const editing = argv.includes("--edit");
const watching = argv.includes("--watch") || editing;
const printing = argv.includes("--pdf");
// a pdf of unfitted pages loses their overflow silently, so printing always fits first
const fitting = argv.includes("--fit") || printing;
const port = Number(flag("--port") ?? 4321);

/*
 * In watch mode the measuring browser is opened once and handed to every rebuild. A launch
 * costs hundreds of milliseconds against a build that takes single-digit ones, so a browser
 * per keystroke would be the whole cost of editing. The studio opens it the first time it
 * exports, and keeps it.
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
if (watching && fitting) await measuring();

/** What the studio splices against: offsets from the same parse the deck was built from. */
let doc = { hash: "", source: "", file: "", entities: [] as { id: string; kind: string; start: number; end: number; md: string }[] };
let currentTheme = "default";
const studio = editing ? await loadStudio() : undefined;

/** Everything the deck is made of, rebuilt from disk. Returns the html and what to watch. */
async function build(): Promise<{ html: string; roots: string[] }> {
    const source = await Bun.file(deck).text();
    const parsed = parse(source);
    const settings = parsed.doc.settings;
    currentTheme = settings.theme;
    if (editing) {
        doc = {
            hash: Bun.hash(source).toString(16),
            source,
            file: basename(deck),
            entities: parsed.doc.entities.map(e => ({
                id: e.id,
                kind: e.kind,
                start: e.node.position.start.offset,
                end: e.node.position.end.offset,
                md: e.md,
            })),
        };
    }
    const diagnostics: Diagnostic[] = [];
    const { themeDir, theme, registry, layouts } = await stack(settings.theme, diagnostics);

    let viewer = argv.includes("--no-viewer") ? undefined : await loadViewer(diagnostics);
    if (studio) {
        viewer = {
            css: [viewer?.css, studio.css].filter(Boolean).join("\n"),
            script: [viewer?.script, studio.script].filter(Boolean).join("\n"),
        };
    }
    const buildOptions = { registry, layouts, themeCss: theme.css, viewer, edit: editing };

    const assembled = assemble(source, buildOptions);
    diagnostics.push(...assembled.diagnostics);

    const result = fitting
        ? await fit(assembled.pages, assembled.title, assembled.settings, buildOptions, renderPages, session)
        : { ...renderPages(assembled.pages, assembled.title, assembled.settings, buildOptions), pages: assembled.pages };
    diagnostics.push(...result.diagnostics);

    await Bun.write(output, result.html);
    if (printing) diagnostics.push(...(await print(result.pages, assembled.title, assembled.settings, buildOptions)).diagnostics);

    for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
    console.log(`theme ${settings.theme}, ${result.pages.length} pages, ${result.pages.flatMap(p => p.blocks).length} blocks -> ${output}${printing ? `, ${pdfOutput}` : ""}`);
    for (const page of result.pages) {
        const blocks = page.blocks.map(b => `${b.component}${b.origin === "directive" ? "*" : ""}`).join(", ");
        const fitted = [page.scale === 1 ? "" : ` x${page.scale}`, page.overflow ? " OVERFLOWS" : ""].join("");
        console.log(`  page ${page.index + 1} [${page.layout}]${fitted}: ${blocks}`);
    }

    return { html: result.html, roots: [themeDir, ...componentRoots] };
}

/** the theme and the component and layout registries a build renders through */
async function stack(themeName: string, diagnostics: Diagnostic[]) {
    const themeDir = resolve(import.meta.dir, "..", "themes", themeName);
    const theme = await loadTheme(themeDir, diagnostics);
    const registry = await load([BUILTIN, ...componentRoots], diagnostics, { fresh: watching });
    const layouts = await loadLayouts([LAYOUTS, theme.layouts], diagnostics, { fresh: watching });
    return { themeDir, theme, registry, layouts };
}

/** The fitted pages printed without viewer or handles, beside the deck, over whatever is there. */
async function print(pages: Page[], title: string, settings: Settings, options: BuildOptions): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const { html } = renderPages(pages, title, settings, { ...options, viewer: undefined, edit: false });
    return pdf(html, pdfOutput, await measuring());
}

/** what the studio's export runs: the deck as it is on disk, fitted, printed, and opened */
async function exportPdf(): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const source = await Bun.file(deck).text();
    const diagnostics: Diagnostic[] = [];
    const { theme, registry, layouts } = await stack(parse(source).doc.settings.theme, diagnostics);
    const options = { registry, layouts, themeCss: theme.css };
    const assembled = assemble(source, options);
    const fitted = await fit(assembled.pages, assembled.title, assembled.settings, options, renderPages, await measuring());
    diagnostics.push(...assembled.diagnostics, ...fitted.diagnostics);
    const printed = await print(fitted.pages, assembled.title, assembled.settings, options);
    diagnostics.push(...printed.diagnostics);
    return { written: printed.written, diagnostics };
}

const first = await build();

if (!watching) {
    await session?.close();
    process.exit(0);
}

const server = serve({
    deck,
    port,
    initial: first.html,
    roots: [BUILTIN, LAYOUTS, ...first.roots],
    rebuild: async () => (await build()).html,
    route: editing ? async (request, url) => {
        if (url.pathname === "/__doc") return Response.json(doc);
        if (url.pathname === "/__themes") {
            const dir = resolve(import.meta.dir, "..", "themes");
            const themes = (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
            return Response.json({ themes, current: currentTheme });
        }
        if (url.pathname === "/__pdf" && request.method === "POST") {
            const { written, diagnostics } = await exportPdf();
            for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
            if (!written) return new Response(diagnostics.map(d => d.message).join("\n") || "pdf failed", { status: 500 });
            console.log(`-> ${pdfOutput}`);
            // the person asked from a browser on this machine, so the answer lands in their viewer
            const opener = process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", ""] : ["xdg-open"];
            Bun.spawn([...opener, pdfOutput], { stdout: "ignore", stderr: "ignore" }).unref();
            return Response.json({ path: pdfOutput });
        }
        if (url.pathname === "/__edit" && request.method === "POST") {
            const { hash, start, end, text } = await request.json();
            const source = await Bun.file(deck).text();
            // a splice against a stale offset corrupts the file rather than losing an edit
            if (Bun.hash(source).toString(16) !== hash) return new Response("stale", { status: 409 });
            const sane = Number.isInteger(start) && Number.isInteger(end)
                && start >= 0 && end >= start && end <= source.length && typeof text === "string";
            if (!sane) return new Response("bad splice", { status: 400 });
            await Bun.write(deck, source.slice(0, start) + text + source.slice(end));
            return new Response("ok");
        }
        return undefined;
    } : undefined,
});

console.log(`watching, serving ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
        await server.stop();
        await session?.close();
        process.exit(0);
    });
}
