import type { render as renderPages, BuildOptions } from "./build";
import type { Diagnostic, Page, Settings } from "./types";

/**
 * Detects a page overflowing its fixed-aspect box and splits it at a block boundary, moving
 * the tail onto a new page under the same layout. Requires a real browser: overflow is a
 * layout fact, and no heuristic replaces measuring it. `[decision]` in DATA-MODEL.md.
 *
 * This must never be a hard dependency. `playwright-core` is a small wrapper with no browser
 * binary; `chromium.launch()` only succeeds if `playwright install chromium` has been run
 * separately. Any failure to import or launch degrades to one diagnostic and the pages are
 * returned unchanged, never thrown. A plain build never calls this at all.
 */
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
    // a page can lose at most (its block count - 1) blocks before it stops overflowing;
    // the sum over all pages bounds how many splits could ever happen
    const budget = pages.reduce((n, p) => n + Math.max(0, p.blocks.length - 1), 0);
    const unsplittable = new Set<number>();

    try {
        const browserPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });

        for (let pass = 0; pass < budget + 1; pass++) {
            const overflow = await measure(browserPage, render, current, title, settings, options, unsplittable);
            if (overflow === null) break;

            const overflowing = current[overflow]!;
            if (overflowing.blocks.length <= 1) {
                diagnostics.push({
                    level: "warn",
                    message: `page ${overflow + 1} overflows and cannot be split further (one block, "${overflowing.blocks[0]!.component}")`,
                });
                unsplittable.add(overflow);
                continue;
            }

            const tail = overflowing.blocks.at(-1)!;
            const kept = overflowing.blocks.slice(0, -1);
            const split: Page = { index: 0, blocks: [tail], layout: overflowing.layout, layoutProps: overflowing.layoutProps };

            current = [
                ...current.slice(0, overflow),
                { ...overflowing, blocks: kept },
                split,
                ...current.slice(overflow + 1),
            ];
            // indices past the split shifted by one; unsplittable marks below it are untouched
            unsplittable.forEach(i => { if (i > overflow) { unsplittable.delete(i); unsplittable.add(i + 1); } });

            diagnostics.push({
                level: "warn",
                message: `page ${overflow + 1} overflowed; split after "${kept.at(-1)?.component}", "${tail.component}" moved to a new page`,
            });
        }

        const numbered = current.map((page, index) => ({ ...page, index }));
        return { pages: numbered, html: render(numbered, title, settings, options).html, diagnostics };
    } finally {
        await browser.close();
    }
}

async function measure(
    browserPage: import("playwright-core").Page,
    render: typeof renderPages,
    pages: Page[],
    title: string,
    settings: Settings,
    options: BuildOptions,
    skip: Set<number>,
): Promise<number | null> {
    // measured without the viewer: it never affects layout height, and skipping it keeps this pass fast
    const { html } = render(pages, title, settings, { ...options, viewer: undefined });
    await browserPage.setContent(html, { waitUntil: "load" });
    return browserPage.evaluate((skipped) => {
        const sections = [...document.querySelectorAll<HTMLElement>(".pac-page")];
        for (let i = 0; i < sections.length; i++) {
            if (skipped.includes(i)) continue;
            const main = sections[i]!.querySelector("main");
            if (!main) continue;
            // scrollHeight only reports real overflow once overflow is non-"visible";
            // left as "visible" (the default) it silently equals clientHeight always
            main.style.overflow = "hidden";
            const overflows = main.scrollHeight - main.clientHeight > 1;
            main.style.overflow = "";
            if (overflows) return i;
        }
        return null;
    }, [...skip]);
}

async function launch(diagnostics: Diagnostic[]): Promise<import("playwright-core").Browser | undefined> {
    try {
        const { chromium } = await import("playwright-core");
        return await chromium.launch();
    } catch {
        diagnostics.push({
            level: "warn",
            message: "no browser available for fit checking; run `bunx playwright install chromium` to enable it. Pages are unchanged.",
        });
        return undefined;
    }
}
