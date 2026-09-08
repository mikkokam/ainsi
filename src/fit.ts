import type { render as renderPages, BuildOptions } from "./build";
import type { Block, Diagnostic, Entity, Page, Settings } from "./types";

/**
 * The fit solver. A page is measured in its real output box and, while it overflows, walks
 * down the ladder in `DATA-MODEL.md`: step the type scale down within the range the theme
 * allows, split at a block boundary, then split inside a block that declares itself
 * splittable. A page that exhausts all of it renders overflowing and is flagged rather than
 * silently clipped.
 *
 * Requires a real browser: overflow is a layout fact, and no heuristic replaces measuring it.
 * This must never be a hard dependency. `playwright-core` is a dev dependency, so a default
 * install does not have it at all; where it is present it is a wrapper with no browser binary,
 * and `chromium.launch()` only succeeds if `playwright install chromium` has been run
 * separately, or `AINSI_CHROMIUM` points at an existing binary. Any failure to import or launch
 * degrades to one diagnostic and the pages are returned unchanged, never thrown. A plain
 * build never calls this at all.
 */

/** One rung of the type ladder. Discrete, so a deck's pages land on a few shared sizes. */
const STEP = 0.04;

/** Where the scale stops when a theme declares no floor of its own. */
const FLOOR = 0.8;

interface Measurer {
    /** every page of the deck that overflows, in order */
    overflowing(pages: Page[], skip: Set<number>): Promise<number[]>;
    /** whether one page would fit on its own, for testing a candidate cut */
    fits(page: Page): Promise<boolean>;
    /** how far this theme lets the type shrink */
    floor(pages: Page[]): Promise<number>;
}

/**
 * A measuring browser held open across builds. A one-shot build lets `fit` open and close its
 * own and never sees this; watch mode opens one at startup and hands it to every rebuild,
 * because launching chromium costs far more than the build it is measuring.
 *
 * `page` is absent when no browser could be launched. That is a settled fact rather than a
 * failure to retry: the diagnostic is pushed once, here, and a rebuild that is handed a
 * pageless session degrades quietly instead of warning on every keystroke.
 */
export interface FitSession {
    readonly page: import("playwright-core").Page | undefined;
    close(): Promise<void>;
}

export async function openFit(diagnostics: Diagnostic[]): Promise<FitSession> {
    const browser = await launch(diagnostics);
    if (!browser) return { page: undefined, close: async () => {} };
    const page = await browser.newPage({ viewport: VIEWPORT });
    await hold(page);
    return { page, close: () => browser.close() };
}

interface Held {
    status: number;
    contentType: string;
    body: Buffer;
}

/**
 * Hold the outcome of every remote request for the life of the session. Measuring is a great
 * many `setContent` calls — a pass per rung, and a bisection per split — and a deck with
 * remote images would go to the network again on each one. That is almost all of the wall
 * clock and none of the work: the image is the same image, and what is being measured is how
 * tall it makes the page. Held across builds too, so in watch mode an edit pays no network.
 *
 * A failure is an outcome worth holding as much as a response is. An unreachable host costs
 * seconds per attempt while the connection gives up, and a deck whose images are offline
 * would otherwise pay that on every candidate the solver measures rather than once.
 *
 * Only the content type is carried over. Replaying a stored `content-encoding` against a body
 * playwright has already decoded is how this kind of cache usually breaks.
 */
async function hold(page: import("playwright-core").Page): Promise<void> {
    const held = new Map<string, Held | null>();          // null: tried once, and it failed
    await page.route(/^https?:/, async route => {
        const url = route.request().url();

        if (held.has(url)) {
            const hit = held.get(url);
            return hit ? route.fulfill(hit) : route.abort().catch(() => {});
        }

        const response = await route.fetch().catch(() => undefined);
        if (!response) {
            held.set(url, null);
            return route.abort().catch(() => {});
        }

        const entry: Held = {
            status: response.status(),
            contentType: response.headers()["content-type"] ?? "application/octet-stream",
            body: await response.body(),
        };
        held.set(url, entry);
        return route.fulfill(entry);
    });
}

/** The measuring box: the design width of a page, and height enough that nothing else clips. */
const VIEWPORT = { width: 1280, height: 900 };

/** How long a page may wait for its pictures and its faces before it is used anyway. */
const SETTLE = 90_000;

/**
 * Put the html in a page and wait for what changes its layout: the pictures, and the faces the
 * type is set in. `setContent` with `waitUntil: "load"` does both in one call and throws the
 * whole export away when one remote image is slow, which is the ordinary case for a deck that
 * links its photographs rather than embedding them. Here a slow picture costs a warning and a
 * measurement taken without it, never the export.
 *
 * Returns false when the wait ran out. Only the first call pays it: `hold` keeps every remote
 * response for the session, so a picture that arrived once is in memory for every pass after.
 *
 * A failed image counts as settled, because `complete` is true once a load has errored, so a
 * deck with a dead url waits for the request to fail rather than for the budget to run out.
 */
export async function place(page: import("playwright-core").Page, html: string): Promise<boolean> {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    try {
        await page.waitForFunction(() => [...document.images].every(image => image.complete), undefined, { timeout: SETTLE });
        await page.evaluate(() => document.fonts.ready);
        return true;
    } catch {
        return false;
    }
}

export async function fit(
    pages: Page[],
    title: string,
    settings: Settings,
    options: BuildOptions,
    render: typeof renderPages,
    session?: FitSession,
): Promise<{ pages: Page[]; html: string; diagnostics: Diagnostic[] }> {
    const diagnostics: Diagnostic[] = [];
    // a session handed in is the caller's to close; one opened here is ours
    const own = session ?? await openFit(diagnostics);
    const browserPage = own.page;
    if (!browserPage) {
        if (!session) await own.close();
        return { pages, html: render(pages, title, settings, options).html, diagnostics };
    }

    let current = pages;
    const exhausted = new Set<number>();

    try {
        const measurer = measure(browserPage, render, title, settings, options, diagnostics);
        const floor = await measurer.floor(current);

        // every pass either shrinks a page's type, cuts one page in two, or gives up on one.
        // Pages can only ever be cut down to one entity each, so all three are bounded.
        const entities = current.reduce((n, p) => n + p.blocks.reduce((m, b) => m + b.entities.length, 0), 0);
        const budget = entities * (Math.ceil((1 - floor) / STEP) + 2) + 8;

        for (let pass = 0; pass < budget; pass++) {
            const overflowing = await measurer.overflowing(current, exhausted);
            if (!overflowing.length) break;

            // rung 1: the type scale, on every page that still has room to shrink. Applied to
            // all of them at once because it moves no page index, so a deck with several
            // dense pages steps them down together rather than one pass each.
            const stepped = new Set(overflowing.filter(i => below(current[i]!.scale, floor) !== null));
            if (stepped.size) {
                current = current.map((page, i) => (stepped.has(i) ? { ...page, scale: below(page.scale, floor)! } : page));
                continue;
            }

            // rungs 3 and 4 renumber the pages after them, so one cut per pass keeps the
            // index arithmetic here to a single shift.
            const at = overflowing[0]!;
            const page = current[at]!;

            const cut = await split(page, options, measurer);
            if (!cut) {
                diagnostics.push({
                    level: "warn",
                    message: `page ${at + 1} overflows at the smallest type this theme allows and cannot be split `
                        + `further ("${page.blocks[0]!.component}"); it is rendered clipped and marked`,
                });
                current = replace(current, at, [{ ...page, overflow: true }]);
                exhausted.add(at);
                continue;
            }

            diagnostics.push({ level: "warn", message: `page ${at + 1} overflowed; ${cut.why}` });
            current = replace(current, at, cut.pages);
            // one page became two, so every mark past it moved down by one
            for (const i of [...exhausted].sort((a, b) => b - a)) {
                if (i > at) { exhausted.delete(i); exhausted.add(i + 1); }
            }
        }

        const numbered = current.map((page, index) => ({ ...page, index }));
        return { pages: numbered, html: render(numbered, title, settings, options).html, diagnostics };
    } finally {
        if (!session) await own.close();
    }
}

/**
 * Rung 3, then rung 4: the page keeps the largest prefix that actually fits and the rest
 * becomes one following page, which re-enters the ladder and is cut again if it has to be.
 * The alternative, moving one block at a time and letting the outer loop repeat, gives every
 * moved block a page of its own; what a reader wants is full pages.
 *
 * The prefix is measured rather than guessed, and fitting is monotone in how much a page
 * carries, so the search is a bisection. It is measured at full type size, not at the size
 * the whole page shrank to on the way down the ladder: the scale rung exists to save a page
 * from being split at all, and once a split is happening anyway, packing the head at the
 * smallest type the theme allows only guarantees it has to shrink again. Both halves start
 * the ladder over, so each ends up at the size its own content asks for.
 */
async function split(
    page: Page,
    options: BuildOptions,
    measurer: Measurer,
): Promise<{ pages: Page[]; why: string } | null> {
    const full = { ...page, scale: 1 };
    const fresh = (blocks: Block[]): Page => ({ ...page, blocks, scale: 1, overflow: false });

    if (page.blocks.length > 1) {
        // candidate k keeps the first k blocks; k = blocks.length - 1 always changes something
        const kept = await largest(page.blocks.length - 1, k => measurer.fits({ ...full, blocks: page.blocks.slice(0, k) }));
        if (kept > 0) {
            const head = page.blocks.slice(0, kept);
            const tail = page.blocks.slice(kept);
            return {
                pages: [fresh(head), fresh(tail)],
                why: `split after "${head.at(-1)!.component}", ${tail.length} block${tail.length > 1 ? "s" : ""} `
                    + `moved to a new page`,
            };
        }
        // not even the first block alone fits: fall through and cut inside it
    }

    const block = page.blocks[0];
    const component = block && options.registry.get(block.component);
    if (!block || !component?.splittable || block.entities.length < 2) return null;

    // inside a block the cut is an entity boundary: a paragraph for prose, never mid-flow
    const kept = await largest(block.entities.length - 1, n =>
        measurer.fits({ ...full, blocks: [reblock(block, block.entities.slice(0, n))] }));
    if (kept === 0) return null;

    const head = block.entities.slice(0, kept);
    const tail = block.entities.slice(kept);
    const rest = page.blocks.slice(1);
    return {
        pages: [fresh([reblock(block, head)]), fresh([reblock(block, tail), ...rest])],
        why: `split inside "${block.component}" at a ${tail[0]!.kind} boundary, `
            + `${head.length} of ${block.entities.length} kept`,
    };
}

/**
 * The largest n in 1..max that fits, or 0 if none does. Bisection is sound because a page
 * carrying a prefix of another page's content can never be the taller of the two.
 */
async function largest(max: number, fits: (n: number) => Promise<boolean>): Promise<number> {
    let low = 1;
    let high = max;
    let best = 0;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (await fits(mid)) { best = mid; low = mid + 1; } else { high = mid - 1; }
    }
    return best;
}

/** The same block over fewer entities: its id and span are derived, so they follow the cut. */
function reblock(block: Block, entities: Entity[]): Block {
    return { ...block, id: entities[0]!.id, span: [entities[0]!.id, entities.at(-1)!.id], entities };
}

function replace(pages: Page[], at: number, with_: Page[]): Page[] {
    return [...pages.slice(0, at), ...with_, ...pages.slice(at + 1)];
}

/** The next rung down, or null at the floor. Rounded so pages share a handful of sizes. */
function below(scale: number, floor: number): number | null {
    const next = Math.round((scale - STEP) * 100) / 100;
    return next < floor - 1e-9 ? null : next;
}

function measure(
    browserPage: import("playwright-core").Page,
    render: typeof renderPages,
    title: string,
    settings: Settings,
    options: BuildOptions,
    diagnostics: Diagnostic[],
): Measurer {
    // measured without the viewer: it never affects layout height, and skipping it keeps
    // every pass fast
    let warned = false;
    const show = async (pages: Page[]): Promise<void> => {
        const { html } = render(pages, title, settings, { ...options, viewer: undefined });
        if (await place(browserPage, html) || warned) return;
        warned = true;
        diagnostics.push({
            level: "warn",
            message: "pictures were still loading after 90s, so the pages were measured without them; "
                + "a page that overflows in the export is why",
        });
    };

    /*
     * scrollHeight only reports real overflow once overflow is non-"visible"; left as
     * "visible" (the default) it silently equals clientHeight however much is clipped.
     */
    const read = (skip: number[]) => browserPage.evaluate((skipped: number[]) => {
        const found: number[] = [];
        const sections = [...document.querySelectorAll<HTMLElement>(".ainsi-page")];
        for (let i = 0; i < sections.length; i++) {
            if (skipped.includes(i)) continue;
            const main = sections[i]!.querySelector("main");
            if (!main) continue;
            main.style.overflow = "hidden";
            const overflows = main.scrollHeight - main.clientHeight > 1;
            main.style.overflow = "";
            if (overflows) found.push(i);
        }
        return found;
    }, skip);

    return {
        async overflowing(pages, skip) {
            await show(pages);
            return read([...skip]);
        },
        // a candidate is rendered on its own: one page is far less to lay out than the deck,
        // and a bisection asks several times per split
        async fits(page) {
            await show([{ ...page, index: 0 }]);
            return (await read([])).length === 0;
        },
        /*
         * How far the theme lets type shrink, read from the rendered deck rather than from
         * the theme file, because that is where a token's cascade is actually resolved. A
         * theme that declares no floor gets the engine's.
         */
        async floor(pages) {
            await show(pages);
            return browserPage.evaluate((fallback: number) => {
                const declared = Number.parseFloat(getComputedStyle(document.body).getPropertyValue("--ainsi-step-min"));
                return Number.isFinite(declared) && declared > 0 && declared <= 1 ? declared : fallback;
            }, FLOOR);
        },
    };
}

async function launch(diagnostics: Diagnostic[]): Promise<import("playwright-core").Browser | undefined> {
    try {
        const { chromium } = await import("playwright-core");
        // an escape hatch for a machine that has a browser but not playwright's own copy of
        // one, which is every CI image with chromium already installed
        const executablePath = process.env.AINSI_CHROMIUM;
        // pdf export redraws cross-origin images onto a canvas to downscale them; with web
        // security on, that taints the canvas and the pixels cannot be read back. Every page
        // this browser ever renders is our own build, never foreign content.
        return await chromium.launch({ args: ["--disable-web-security"], ...(executablePath ? { executablePath } : {}) });
    } catch {
        diagnostics.push({
            level: "warn",
            message: "no browser available for fit checking; run `bun install && bunx playwright install "
                + "chromium` in the ainsi checkout, or set AINSI_CHROMIUM to an existing binary, to enable it. Pages are unchanged.",
        });
        return undefined;
    }
}
