import { watch } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * The dev server: serve the decks that are open, watch what each is made of, rebuild on a change
 * and tell the browser to reload. It knows nothing about markdown, components or themes — it is
 * handed a `rebuild` per deck that returns html, which is what keeps it a transport rather than a
 * second copy of the pipeline.
 *
 * One process holds many decks. Each is served under `/d/<id>/` and carries its own html, build
 * number, watcher and set of listening pages, so a rebuild of one deck reloads only the windows
 * on it. The chooser is the root, and it is a tenant like any other: the shared roots (the
 * chrome, every theme in use) rebuild all of them, because a theme edit changes all of them.
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
const reloadScript = (prefix: string, build: number) => `<script>(()=>{const s=new EventSource("${prefix}/__reload");`
    + `const go=()=>{const h=window.__ainsiReload;h?h():location.reload()};s.onmessage=go;`
    + `s.onopen=async()=>{try{const r=await fetch("${prefix}/__build");if((await r.json()).build!==${build})go()}catch{}}})()</script>`;

/** SSE through an idle proxy or a browser's own bookkeeping needs traffic; a comment is enough */
const PING = 20_000;

/*
 * A commit writes the deck and schedules its own rebuild, because a missed watch event would
 * leave the editor waiting forever. The write then fires the watcher too, and its event lands
 * after the rebuild has started, so the debounce does not absorb it and the deck is built twice
 * for one edit. This is how long the echo is ignored for.
 */
const ECHO = 400;

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** `/d/<id>` and whatever follows it; the id is opaque, so a deck's path never reaches a url */
const SCOPED = /^\/d\/([^/]+)(\/.*)?$/;

/** the id in a url: short, random and meaningless, because a path there leaks the filesystem */
const token = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(6))).toString("base64url");

export interface ServeOptions {
    port: number;
    /** the chooser's html, served at `/` until the first rebuild replaces it */
    initial: string;
    /** directories watched for every open deck at once; a missing one is skipped */
    roots: string[];
    /** produce the chooser again. What it throws is reported and the last html kept. */
    rebuild(): Promise<string>;
    /** extra routes, tried before assets and the deck. `id` is set for a request under
     *  `/d/<id>/`, and `url` has that prefix already stripped; undefined falls through */
    route?(request: Request, url: URL, id?: string): Promise<Response | undefined>;
}

export interface OpenOptions {
    /** the deck file; its folder is where the assets it references are resolved */
    deck: string;
    /** the html to serve until the first rebuild replaces it */
    initial: string;
    rebuild(): Promise<string>;
    /** directories this deck adds to the shared watch, its theme's among them */
    roots?: string[];
}

export interface Server {
    readonly url: string;
    /** serve a deck of its own; the id is the one its url is built from */
    open(options: OpenOptions): string;
    /** the deck was renamed: assets resolve beside the new path and the watcher follows it.
     *  The id and so the window's url are unchanged, which is the point of an opaque id. */
    move(id: string, deck: string): void;
    /** stop serving a deck; a window still on its url is sent back to the chooser */
    close(id: string): void;
    /** a change to what a deck is made of. `id` is "" for the chooser. Pass `own` for a write
     *  this server did, so the watcher's echo of it does not build the same deck a second time */
    changed(id: string, what: string, own?: boolean): void;
    stop(): Promise<void>;
}

interface Tenant {
    id: string;
    /** what its own urls hang off: "" for the chooser, `/d/<id>` for a deck */
    prefix: string;
    deck?: string;
    html: string;
    /*
     * Bumped on every successful rebuild; a page carries the number it was served with and
     * reloads on reconnect when the server has moved past it. Seeded from the clock rather
     * than from zero, so a server that restarted is never mistaken for the one that served
     * the page: under `bun --watch` every source edit is a restart, and a fresh count would
     * land back on the number the open page already has.
     */
    build: number;
    clients: Set<ReadableStreamDirectController>;
    pending?: ReturnType<typeof setTimeout>;
    echo: number;
    watcher?: ReturnType<typeof watch>;
    rebuild(): Promise<string>;
}

export function serve(options: ServeOptions): Server {
    const { port, roots, rebuild, route } = options;

    const landing: Tenant = {
        id: "", prefix: "", html: options.initial, build: Date.now(),
        clients: new Set(), echo: 0, rebuild,
    };
    const decks = new Map<string, Tenant>();
    const tenants = () => [landing, ...decks.values()];

    /*
     * A window on a deck that has been closed. A page goes back to the chooser, but an endpoint
     * says so: a redirect followed by fetch answers 200 from the chooser, and a studio told its
     * write landed when nothing was written is worse than one told it failed.
     */
    const gone = (rest: string): Response => rest.startsWith("/__")
        ? new Response("that deck is closed", { status: 409 })
        : new Response(null, { status: 302, headers: { location: "/" } });

    const server = Bun.serve({
        port,
        // an SSE stream is idle by design. Bun's default cuts it at 10 seconds, which the
        // browser reports as a broken response and, worse, drops any push sent before it
        // reconnects.
        idleTimeout: 0,
        async fetch(request) {
            const url = new URL(request.url);
            const path = decodeURIComponent(url.pathname);

            let tenant = landing;
            let rest = path;
            const scoped = SCOPED.exec(path);
            if (scoped) {
                const found = decks.get(scoped[1]!);
                // a window whose deck was closed belongs on the chooser, not on a 404
                if (!found) return gone(scoped[2] ?? "/");
                // without the trailing slash the browser resolves `assets/logo.png` against
                // `/d/`, so the deck's own folder is one redirect away rather than a broken page
                if (scoped[2] === undefined) return new Response(null, { status: 302, headers: { location: `${url.pathname}/` } });
                tenant = found;
                rest = scoped[2];
            }

            if (rest === "/__build") return Response.json({ build: tenant.build });

            if (rest === "/__reload") {
                const clients = tenant.clients;
                return new Response(new ReadableStream({
                    type: "direct",
                    async pull(controller: ReadableStreamDirectController) {
                        clients.add(controller);
                        controller.write(": open\n\n");
                        await controller.flush();
                        // parked on the disconnect rather than on nothing. A navigated-away
                        // page leaves a controller that may take any number of pushes to
                        // error, or never error at all, and a pull that never returns is one
                        // stop() waits on for as long as the browser holds the connection.
                        await new Promise<void>(done => request.signal.addEventListener("abort", () => {
                            clients.delete(controller);
                            done();
                        }));
                    },
                }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
            }

            if (route) {
                const scopedUrl = new URL(url);
                scopedUrl.pathname = rest;
                const handled = await route(request, scopedUrl, tenant.deck ? tenant.id : undefined);
                if (handled) return handled;
            }

            if (rest !== "/") {
                // local assets a deck references: relative to the deck's own folder first, then
                // the path taken as absolute, so ![](/Users/me/pic.png) shows too. An absolute
                // one is resolved against the origin by the browser, so it arrives unprefixed.
                const beside = tenant.deck ? [join(dirname(tenant.deck), rest.slice(1))] : [];
                for (const candidate of [...beside, path]) {
                    const asset = Bun.file(candidate);
                    if (await asset.exists()) return new Response(asset);
                }
            }

            return new Response(tenant.html.replace("</body>", `${reloadScript(tenant.prefix, tenant.build)}</body>`), {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        },
    });

    /*
     * Every client is written to on its own, never in one awaited loop. A flush to a page that
     * has gone away can hang rather than throw, and in a loop that hang holds up the push the
     * live page is waiting on, which surfaces as a reload that never arrives.
     */
    function post(tenant: Tenant, message: string): void {
        for (const client of tenant.clients) {
            void (async () => {
                try { client.write(message); await client.flush(); } catch { tenant.clients.delete(client); }
            })();
        }
    }

    function schedule(tenant: Tenant, what: string, own = false): void {
        if (own) tenant.echo = Date.now() + ECHO;
        clearTimeout(tenant.pending);
        tenant.pending = setTimeout(async () => {
            console.log(`\n${what} changed`);
            try {
                tenant.html = await tenant.rebuild();
                tenant.build++;
                post(tenant, "data: reload\n\n");
            } catch (error) {
                // the last good html stays served: a deck mid-edit should not blank the browser
                console.error(`build failed: ${String(error)}`);
            }
        }, SETTLE);
    }

    // an image beside the deck is linked, not copied, so a change to it shows like a source edit
    function follow(tenant: Tenant): void {
        const deck = tenant.deck;
        if (!deck) return;
        tenant.watcher = watch(dirname(deck), (_, file) => {
            if (!file) return;
            if (file === basename(deck)) {
                if (Date.now() < tenant.echo) return;
                schedule(tenant, file);
            } else if (IMAGE.test(file)) schedule(tenant, file);
        });
    }

    /*
     * The shared watch. A theme folder joins it when the first deck on that theme opens and stays
     * for the session: a watcher costs nothing next to the chance that the deck that dropped it
     * was not the only one on that theme.
     */
    const watching = new Set<string>();
    const watchers: ReturnType<typeof watch>[] = [];

    function share(root: string): void {
        if (watching.has(root)) return;
        watching.add(root);
        try {
            watchers.push(watch(root, { recursive: true }, (_, file) => {
                for (const tenant of tenants()) schedule(tenant, `${basename(root)}/${file}`);
            }));
        } catch {
            // a theme without a layouts folder, say
        }
    }

    for (const root of roots) share(root);

    const heartbeat = setInterval(() => { for (const tenant of tenants()) post(tenant, ": ping\n\n"); }, PING);

    const find = (id: string): Tenant | undefined => (id === "" ? landing : decks.get(id));

    return {
        url: `http://localhost:${server.port}`,
        open({ deck, initial, rebuild, roots }) {
            let id = token();
            while (decks.has(id)) id = token();
            const tenant: Tenant = {
                id, prefix: `/d/${id}`, deck, html: initial, build: Date.now(),
                clients: new Set(), echo: 0, rebuild,
            };
            decks.set(id, tenant);
            follow(tenant);
            for (const root of roots ?? []) share(root);
            return id;
        },
        move(id, deck) {
            const tenant = decks.get(id);
            if (!tenant) return;
            const moved = dirname(deck) !== dirname(tenant.deck!);
            tenant.deck = deck;
            if (!moved) return;
            tenant.watcher?.close();
            follow(tenant);
        },
        close(id) {
            const tenant = decks.get(id);
            if (!tenant) return;
            clearTimeout(tenant.pending);
            tenant.watcher?.close();
            tenant.clients.clear();
            decks.delete(id);
        },
        changed(id, what, own) {
            const tenant = find(id);
            if (tenant) schedule(tenant, what, own);
        },
        async stop() {
            clearInterval(heartbeat);
            for (const tenant of tenants()) {
                clearTimeout(tenant.pending);
                tenant.watcher?.close();
                tenant.clients.clear();
            }
            decks.clear();
            for (const watcher of watchers) watcher.close();
            await server.stop(true);
        },
    };
}
