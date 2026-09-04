import { basename, dirname, extname, join, resolve } from "node:path";
import { watch } from "node:fs";
import { assemble, render as renderPages } from "./build";
import { fit } from "./fit";
import { parse } from "./parse";
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
const port = Number(flag("--port") ?? 4321);

let current = "";

async function render(): Promise<string[]> {
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

    const result = argv.includes("--fit")
        ? await fit(assembled.pages, assembled.title, assembled.settings, buildOptions, renderPages)
        : { ...renderPages(assembled.pages, assembled.title, assembled.settings, buildOptions), pages: assembled.pages };
    diagnostics.push(...result.diagnostics);

    await Bun.write(output, result.html);
    current = result.html;

    for (const d of diagnostics) console.warn(`${d.level}: ${d.message}`);
    console.log(`theme ${settings.theme}, ${result.pages.length} pages, ${result.pages.flatMap(p => p.blocks).length} blocks -> ${output}`);
    for (const page of result.pages) {
        const blocks = page.blocks.map(b => `${b.component}${b.origin === "directive" ? "*" : ""}`).join(", ");
        const fitted = [page.scale === 1 ? "" : ` x${page.scale}`, page.overflow ? " OVERFLOWS" : ""].join("");
        console.log(`  page ${page.index + 1} [${page.layout}]${fitted}: ${blocks}`);
    }

    return [themeDir, ...componentRoots];
}

const themeRoots = await render();

if (!watching) process.exit(0);

/* ---------------------------------------------------------------- watch mode */

const clients = new Set<ReadableStreamDirectController>();

const RELOAD = `<script>new EventSource("/__reload").onmessage=()=>location.reload()</script>`;

Bun.serve({
    port,
    async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === "/__reload") {
            return new Response(new ReadableStream({
                type: "direct",
                async pull(controller: ReadableStreamDirectController) {
                    clients.add(controller);
                    controller.write(": open\n\n");
                    await controller.flush();
                    await new Promise(() => {});
                },
            }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
        }

        if (url.pathname !== "/") {
            // local assets a deck references, resolved against the deck's own folder
            const asset = Bun.file(join(dirname(deck), decodeURIComponent(url.pathname).slice(1)));
            if (await asset.exists()) return new Response(asset);
        }

        return new Response(current.replace("</body>", `${RELOAD}</body>`), {
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    },
});

console.log(`watching, serving http://localhost:${port}`);

let pending: ReturnType<typeof setTimeout> | undefined;

function schedule(what: string): void {
    clearTimeout(pending);
    // editors fire several events for one save; one rebuild is enough
    pending = setTimeout(async () => {
        console.log(`\n${what} changed`);
        try {
            await render();
            for (const client of clients) {
                try { client.write("data: reload\n\n"); await client.flush(); } catch { clients.delete(client); }
            }
        } catch (error) {
            console.error(`build failed: ${String(error)}`);
        }
    }, 40);
}

watch(dirname(deck), (_, file) => {
    if (file === basename(deck)) schedule(basename(deck));
});

for (const root of [BUILTIN, LAYOUTS, ...themeRoots]) {
    try {
        watch(root, { recursive: true }, (_, file) => schedule(`${basename(root)}/${file}`));
    } catch {
        // a theme without a layouts folder, say
    }
}
