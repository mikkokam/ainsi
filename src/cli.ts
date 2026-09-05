import { basename, dirname, extname, join, resolve } from "node:path";
import { assemble, render as renderPages } from "./build";
import { fit, openFit, type FitSession } from "./fit";
import { parse } from "./parse";
import { serve } from "./serve";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadTheme, loadViewer } from "./load";
import type { Diagnostic } from "./types";

const argv = process.argv.slice(2);
const input = argv.find(a => !a.startsWith("-") && argv[argv.indexOf(a) - 1] !== "-o" && argv[argv.indexOf(a) - 1] !== "--port" && argv[argv.indexOf(a) - 1] !== "--components");

if (!input) {
    console.error("usage: bun run src/cli.ts <deck.md> [-o out.html] [--watch] [--no-viewer] [--fit] [--port 4321] [--components <dir>]");
    process.exit(1);
}

const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
};

const deck = resolve(input);
const output = resolve(flag("-o") ?? join(dirname(deck), `${basename(deck, extname(deck))}.html`));
const componentRoots = argv.flatMap((a, i) => (a === "--components" && argv[i + 1] ? [resolve(argv[i + 1]!)] : []));
const watching = argv.includes("--watch");
const fitting = argv.includes("--fit");
const port = Number(flag("--port") ?? 4321);

/*
 * In watch mode the measuring browser is opened once and handed to every rebuild. A launch
 * costs hundreds of milliseconds against a build that takes single-digit ones, so a browser
 * per keystroke would be the whole cost of editing.
 */
let session: FitSession | undefined;
if (watching && fitting) {
    const opening: Diagnostic[] = [];
    session = await openFit(opening);
    // said once, here, rather than on every rebuild that is handed a pageless session
    for (const d of opening) console.warn(`${d.level}: ${d.message}`);
}

/** Everything the deck is made of, rebuilt from disk. Returns the html and what to watch. */
async function build(): Promise<{ html: string; roots: string[] }> {
    const source = await Bun.file(deck).text();
    const settings = parse(source).doc.settings;
    const themeDir = resolve(import.meta.dir, "..", "themes", settings.theme);

    const diagnostics: Diagnostic[] = [];
    const theme = await loadTheme(themeDir, diagnostics);
    const registry = await load([BUILTIN, ...componentRoots], diagnostics, { fresh: watching });
    const layouts = await loadLayouts([LAYOUTS, theme.layouts], diagnostics, { fresh: watching });

    const viewer = argv.includes("--no-viewer") ? undefined : await loadViewer(diagnostics);
    const buildOptions = { registry, layouts, themeCss: theme.css, viewer };

    const assembled = assemble(source, buildOptions);
    diagnostics.push(...assembled.diagnostics);

    const result = fitting
        ? await fit(assembled.pages, assembled.title, assembled.settings, buildOptions, renderPages, session)
        : { ...renderPages(assembled.pages, assembled.title, assembled.settings, buildOptions), pages: assembled.pages };
    diagnostics.push(...result.diagnostics);

    await Bun.write(output, result.html);

    for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
    console.log(`theme ${settings.theme}, ${result.pages.length} pages, ${result.pages.flatMap(p => p.blocks).length} blocks -> ${output}`);
    for (const page of result.pages) {
        const blocks = page.blocks.map(b => `${b.component}${b.origin === "directive" ? "*" : ""}`).join(", ");
        const fitted = [page.scale === 1 ? "" : ` x${page.scale}`, page.overflow ? " OVERFLOWS" : ""].join("");
        console.log(`  page ${page.index + 1} [${page.layout}]${fitted}: ${blocks}`);
    }

    return { html: result.html, roots: [themeDir, ...componentRoots] };
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
});

console.log(`watching, serving ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
        await server.stop();
        await session?.close();
        process.exit(0);
    });
}
