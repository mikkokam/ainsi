import { watch } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * The dev server: serve the deck, watch what it is made of, rebuild on a change and tell the
 * browser to reload. It knows nothing about markdown, components or themes — it is handed a
 * `rebuild` that returns html and a list of directories to watch, which is what keeps it a
 * transport rather than a second copy of the pipeline.
 *
 * It lives apart from `cli.ts` because it is the surface anything interactive grows on: an
 * editor that writes a directive back to the deck is a route added here, not a rewrite of the
 * argument parsing.
 */

/** editors fire several events for one save; one rebuild is enough */
const SETTLE = 40;

// the studio, when present, installs __pacReload to hold a reload while an editor is open
const RELOAD = `<script>new EventSource("/__reload").onmessage=()=>{const h=window.__pacReload;h?h():location.reload()}</script>`;

export interface ServeOptions {
    /** the deck file; its folder is where the assets it references are resolved */
    deck: string;
    port: number;
    /** the html to serve until the first rebuild replaces it */
    initial: string;
    /** directories watched alongside the deck itself; a missing one is skipped */
    roots: string[];
    /** produce the deck's html again. What it throws is reported and the last html kept. */
    rebuild(): Promise<string>;
    /** extra routes, tried before assets and the deck; undefined falls through */
    route?(request: Request, url: URL): Promise<Response | undefined>;
}

export interface Server {
    readonly url: string;
    stop(): Promise<void>;
}

export function serve(options: ServeOptions): Server {
    const { deck, port, roots, rebuild, route } = options;
    let html = options.initial;

    const clients = new Set<ReadableStreamDirectController>();

    const server = Bun.serve({
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

            if (route) {
                const handled = await route(request, url);
                if (handled) return handled;
            }

            if (url.pathname !== "/") {
                // local assets a deck references, resolved against the deck's own folder
                const asset = Bun.file(join(dirname(deck), decodeURIComponent(url.pathname).slice(1)));
                if (await asset.exists()) return new Response(asset);
            }

            return new Response(html.replace("</body>", `${RELOAD}</body>`), {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        },
    });

    let pending: ReturnType<typeof setTimeout> | undefined;

    function schedule(what: string): void {
        clearTimeout(pending);
        pending = setTimeout(async () => {
            console.log(`\n${what} changed`);
            try {
                html = await rebuild();
                for (const client of clients) {
                    try { client.write("data: reload\n\n"); await client.flush(); } catch { clients.delete(client); }
                }
            } catch (error) {
                // the last good html stays served: a deck mid-edit should not blank the browser
                console.error(`build failed: ${String(error)}`);
            }
        }, SETTLE);
    }

    const watchers = [watch(dirname(deck), (_, file) => {
        if (file === basename(deck)) schedule(basename(deck));
    })];

    for (const root of roots) {
        try {
            watchers.push(watch(root, { recursive: true }, (_, file) => schedule(`${basename(root)}/${file}`)));
        } catch {
            // a theme without a layouts folder, say
        }
    }

    return {
        url: `http://localhost:${server.port}`,
        async stop() {
            clearTimeout(pending);
            for (const watcher of watchers) watcher.close();
            clients.clear();
            await server.stop(true);
        },
    };
}
