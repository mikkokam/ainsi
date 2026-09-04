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
 * This must never be a hard dependency. `playwright-core` is a small wrapper with no browser
 * binary; `chromium.launch()` only succeeds if `playwright install chromium` has been run
 * separately, or `PAC_CHROMIUM` points at an existing binary. Any failure to import or launch
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

export async function fit(
    pages: Page[],
    title: string,
    settings: Settings,
    options: BuildOptions,
    render: typeof renderPages,
): Promise<{ pages: Page[]; html: string; diagnostics: Diagnostic[] }> {
    const diagnostics: Diagnostic[] = [];
    const browser = await launch(diagnostics);
    if (!browser) {
        return { pages, html: render(pages, title, settings, options).html, diagnostics };
    }

    let current = pages;
    const exhausted = new Set<number>();

    try {
        const browserPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const measurer = measure(browserPage, render, title, settings, options);
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
        await browser.close();
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
): Measurer {
    // measured without the viewer: it never affects layout height, and skipping it keeps
    // every pass fast
    const show = async (pages: Page[]): Promise<void> => {
        const { html } = render(pages, title, settings, { ...options, viewer: undefined });
        await browserPage.setContent(html, { waitUntil: "load" });
    };

    /*
     * scrollHeight only reports real overflow once overflow is non-"visible"; left as
     * "visible" (the default) it silently equals clientHeight however much is clipped.
     */
    const read = (skip: number[]) => browserPage.evaluate((skipped: number[]) => {
        const found: number[] = [];
        const sections = [...document.querySelectorAll<HTMLElement>(".pac-page")];
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
                const declared = Number.parseFloat(getComputedStyle(document.body).getPropertyValue("--pac-step-min"));
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
        const executablePath = process.env.PAC_CHROMIUM;
        return await chromium.launch(executablePath ? { executablePath } : {});
    } catch {
        diagnostics.push({
            level: "warn",
            message: "no browser available for fit checking; run `bunx playwright install chromium`, or set "
                + "PAC_CHROMIUM to an existing binary, to enable it. Pages are unchanged.",
        });
        return undefined;
    }
}
