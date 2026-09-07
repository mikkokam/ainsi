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

/*
 * The reload channel, and the page's own build number baked in beside it.
 *
 * The studio, when present, installs __ainsiReload to hold a reload while an editor is open.
 * The open handler covers the gap the stream itself cannot: a push sent while the connection
 * was down is simply gone, and the page would sit on stale html with its editor still saying
 * "saving…". On every connect, including every reconnect, the page asks what the current build
 * is and reloads if it is behind.
 */
const reloadScript = (build: number) => `<script>(()=>{const s=new EventSource("/__reload");`
    + `const go=()=>{const h=window.__ainsiReload;h?h():location.reload()};s.onmessage=go;`
    + `s.onopen=async()=>{try{const r=await fetch("/__build");if((await r.json()).build!==${build})go()}catch{}}})()</script>`;

/** SSE through an idle proxy or a browser's own bookkeeping needs traffic; a comment is enough */
const PING = 20_000;

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

export interface ServeOptions {
    /** the deck file; its folder is where the assets it references are resolved. Undefined
     *  until one is chosen: the studio can start on no deck and be pointed at one. */
    deck?: string;
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
    /** a change a route made itself; pass own for a write this server did, so the watcher's
     *  echo of it does not build the same deck a second time */
    changed(what: string, own?: boolean): void;
    /** the deck moved: assets resolve beside the new path and the watcher follows it */
    retarget(deck: string): void;
    stop(): Promise<void>;
}

export function serve(options: ServeOptions): Server {
    const { port, roots, rebuild, route } = options;
    let deck = options.deck;
    let html = options.initial;

    const clients = new Set<ReadableStreamDirectController>();
    /** bumped on every successful rebuild; a page carries the number it was served with */
    let build = 0;

    const server = Bun.serve({
        port,
        // an SSE stream is idle by design. Bun's default cuts it at 10 seconds, which the
        // browser reports as a broken response and, worse, drops any push sent before it
        // reconnects.
        idleTimeout: 0,
        async fetch(request) {
            const url = new URL(request.url);

            if (url.pathname === "/__build") return Response.json({ build });

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
                // local assets a deck references: relative to the deck's own folder first,
                // then the path taken as absolute, so ![](/Users/me/pic.png) shows too
                const path = decodeURIComponent(url.pathname);
                const beside = deck ? [join(dirname(deck), path.slice(1))] : [];
                for (const candidate of [...beside, path]) {
                    const asset = Bun.file(candidate);
                    if (await asset.exists()) return new Response(asset);
                }
            }

            return new Response(html.replace("</body>", `${reloadScript(build)}</body>`), {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        },
    });

    let pending: ReturnType<typeof setTimeout> | undefined;
    /*
     * A commit writes the deck and schedules its own rebuild, because a missed watch event
     * would leave the editor waiting forever. The write then fires the watcher too, and its
     * event lands after the rebuild has started, so the debounce does not absorb it and the
     * deck is built twice for one edit. This is how long the echo is ignored for.
     */
    const ECHO = 400;
    let echo = 0;

    function schedule(what: string, own = false): void {
        if (own) echo = Date.now() + ECHO;
        clearTimeout(pending);
        pending = setTimeout(async () => {
            console.log(`\n${what} changed`);
            try {
                html = await rebuild();
                build++;
                for (const client of clients) {
                    try { client.write("data: reload\n\n"); await client.flush(); } catch { clients.delete(client); }
                }
            } catch (error) {
                // the last good html stays served: a deck mid-edit should not blank the browser
                console.error(`build failed: ${String(error)}`);
            }
        }, SETTLE);
    }

    // an image beside the deck is linked, not copied, so a change to it shows like a source edit
    const folder = () => deck === undefined ? undefined : watch(dirname(deck), (_, file) => {
        if (!file) return;
        if (file === basename(deck!)) {
            if (Date.now() < echo) return;
            schedule(file);
        } else if (IMAGE.test(file)) schedule(file);
    });
    let deckWatcher = folder();
    const watchers: ReturnType<typeof watch>[] = [];

    for (const root of roots) {
        try {
            watchers.push(watch(root, { recursive: true }, (_, file) => schedule(`${basename(root)}/${file}`)));
        } catch {
            // a theme without a layouts folder, say
        }
    }

    const heartbeat = setInterval(() => {
        for (const client of clients) {
            try { client.write(": ping\n\n"); void client.flush(); } catch { clients.delete(client); }
        }
    }, PING);

    return {
        url: `http://localhost:${server.port}`,
        changed: schedule,
        retarget(next) {
            const moved = deck === undefined || dirname(next) !== dirname(deck);
            deck = next;
            if (!moved) return;
            deckWatcher?.close();
            deckWatcher = folder();
        },
        async stop() {
            clearTimeout(pending);
            clearInterval(heartbeat);
            deckWatcher?.close();
            for (const watcher of watchers) watcher.close();
            clients.clear();
            await server.stop(true);
        },
    };
}
