import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { assemble, render } from "../src/build";
import { fit } from "../src/fit";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadTheme } from "../src/load";
import type { Page } from "../src/types";

const registry = await load([BUILTIN]);
const layouts = await loadLayouts([LAYOUTS]);
const theme = await loadTheme(resolve(import.meta.dir, "../themes/default"));
// real theme tokens, not "": with none, --ainsi-size and --ainsi-pad are invalid var() calls
// that fall back to the property's initial value, and nothing can ever overflow a page
// sized by 16px text and zero padding
const options = { registry, layouts, themeCss: theme.css };

/** the same deck under a theme that allows the fit solver a different amount of shrinking */
const withFloor = (floor: number) => ({ ...options, themeCss: `${theme.css}\n:root { --ainsi-step-min: ${floor}; }` });

const run = (md: string, opts = options) => {
    const assembled = assemble(md, opts);
    return fit(assembled.pages, assembled.title, assembled.settings, opts, render)
        .then(result => ({ ...result, before: assembled.pages }));
};

const paragraphs = (n: number) => Array.from({ length: n }, (_, i) =>
    `Paragraph number ${i}, long enough on its own to add real vertical height to the page, several words to be sure of it.`,
).join("\n\n");

/** one-liners: finer steps than the paragraphs above, for a split whose pages all fit at full size */
const lines = (n: number) => Array.from({ length: n }, (_, i) => `Line number ${i}, short.`).join("\n\n");

const OVERFLOWING = `# T

intro

<!-- ainsi: timeline -->
- **Q1** a real sentence here about q1
- **Q2** a real sentence here about q2
- **Q3** a real sentence here about q3
- **Q4** a real sentence here about q4

<!-- ainsi: comparison -->
| | A | B |
| --- | --- | --- |
| Row one | 1 | 2 |
| Row two | 3 | 4 |
| Row three | 5 | 6 |

> a long quoted remark that takes its own line and its own visual space on the page

closing
`;

/**
 * A real browser is required to prove overflow is actually detected and split, so these are
 * skipped rather than failed when neither `bunx playwright install chromium` has been run nor
 * AINSI_CHROMIUM points at a binary. A skip here is exactly the degrade a real build gives: fit
 * is optional everywhere, including in the test suite that checks it.
 */
const chromium: boolean = await import("playwright-core")
    .then(({ chromium }) => chromium
        .launch(process.env.AINSI_CHROMIUM ? { executablePath: process.env.AINSI_CHROMIUM } : {})
        .then(b => b.close().then(() => true)).catch(() => false))
    .catch(() => false);

test.skipIf(!chromium)("fit splits a page that overflows, at a block boundary", async () => {
    const { pages, before, diagnostics } = await run(OVERFLOWING);

    expect(pages.length).toBeGreaterThan(1);
    expect(diagnostics.some(d => d.message.includes("overflowed; split after"))).toBe(true);

    const covered = pages.flatMap(p => p.blocks.map(b => b.id));
    expect(covered.sort()).toEqual(before.flatMap(p => p.blocks.map(b => b.id)).sort());   // splitting loses nothing
});

test.skipIf(!chromium)("fit renumbers pages after a split", async () => {
    const { pages } = await run(OVERFLOWING);
    expect(pages.map(p => p.index)).toEqual(pages.map((_, i) => i));
});

test.skipIf(!chromium)("a page that already fits is left untouched", async () => {
    const { pages, before, diagnostics } = await run("# T\n\na\n");
    expect(pages).toEqual(before);
    expect(diagnostics).toEqual([]);
});

/* -------------------------------------------------------------- rung 1: the type scale */

test.skipIf(!chromium)("a page that only needs smaller type keeps the block it would have lost", async () => {
    // calibrated to overflow by a little: enough that the page does not fit as it stands,
    // not so much that shrinking within the theme's range cannot rescue it
    const { pages, diagnostics } = await run(`# Just over the line\n\n${paragraphs(7)}\n`);

    expect(pages.length).toBe(1);
    expect(pages[0]!.scale).toBeLessThan(1);
    expect(pages[0]!.overflow).toBe(false);
    expect(diagnostics).toEqual([]);                       // shrinking is a fit, not a complaint
});

test.skipIf(!chromium)("how far type may shrink is the theme's call, not the engine's", async () => {
    const md = `# Just over the line\n\n${paragraphs(7)}\n`;

    const generous = await run(md, withFloor(0.7));
    expect(generous.pages.length).toBe(1);

    // a theme that forbids shrinking gets the next rung down instead, and says so
    const strict = await run(md, withFloor(1));
    expect(strict.pages.length).toBeGreaterThan(1);
    expect(strict.pages.every(p => p.scale === 1)).toBe(true);
});

test.skipIf(!chromium)("a page split back into shape gets its full type size again", async () => {
    // the whole page shrank to the floor on the way down the ladder; the halves carry less
    // and have no reason to keep the size the whole one needed
    const { pages } = await run(`# T\n\n${lines(18)}\n`);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every(p => p.scale === 1)).toBe(true);
});

/* ------------------------------------------------- rung 4: inside a splittable component */

test.skipIf(!chromium)("a prose block too tall for a page splits at a paragraph boundary", async () => {
    const { pages, before, diagnostics } = await run(`# T\n\n${paragraphs(20)}\n`);

    expect(pages.length).toBeGreaterThan(1);
    expect(diagnostics.some(d => d.message.includes(`split inside "prose" at a paragraph boundary`))).toBe(true);
    expect(pages.every(p => p.overflow)).toBe(false);

    // every entity survives the cut, once, in source order
    const covered = pages.flatMap(p => p.blocks.flatMap(b => b.entities.map(e => e.id)));
    expect(covered).toEqual(before.flatMap(p => p.blocks.flatMap(b => b.entities.map(e => e.id))));
});

test.skipIf(!chromium)("a cut page is filled, not emptied one paragraph at a time", async () => {
    const { pages } = await run(`# T\n\n${paragraphs(20)}\n`);
    // the point of measuring the cut rather than peeling the tail: no page carries a lone
    // paragraph while the one before it had room for it
    const counts = pages.map(p => p.blocks.reduce((n, b) => n + b.entities.length, 0));
    expect(Math.min(...counts.slice(0, -1))).toBeGreaterThan(1);
});

test.skipIf(!chromium)("a page that no rung can rescue is flagged, not silently clipped", async () => {
    const wall = `Sentence ${Array.from({ length: 400 }, (_, i) => `number ${i} of one very long paragraph`).join(", ")}.`;
    const { pages, html, diagnostics } = await run(wall);

    expect(pages.length).toBe(1);                          // one entity: nowhere left to cut
    expect(pages[0]!.overflow).toBe(true);
    expect(pages[0]!.scale).toBe(0.8);                     // it went all the way down first
    expect(diagnostics.some(d => d.message.includes("cannot be split further"))).toBe(true);
    expect(html).toContain("data-overflow");
});

/* ------------------------------------------------------- what the solver puts in the html */

const SETTINGS = { theme: "default", ratio: "16:9", h1StartsPage: false, layout: "default" };
const markup = (page: Page) => {
    const { html } = render([page], "T", SETTINGS, options);
    return html.slice(html.indexOf("<body"));           // the stylesheet declares --ainsi-step too
};

test("a page the solver did not touch carries no trace of it", () => {
    const html = markup({ index: 0, blocks: [], layout: "default", layoutProps: {}, scale: 1, overflow: false });
    expect(html).not.toContain("--ainsi-step");
    expect(html).not.toContain("data-overflow");
});

test("a scaled page carries its scale, and a clipped one admits it", () => {
    const html = markup({ index: 0, blocks: [], layout: "default", layoutProps: {}, scale: 0.88, overflow: true });
    expect(html).toContain('style="--ainsi-step:0.88"');
    expect(html).toContain("data-overflow");
});

/* ------------------------------------------------------------------- degrading gracefully */

test("fit never throws when no browser is available, and pages pass through unchanged", async () => {
    const assembled = assemble(OVERFLOWING, options);
    const module = await import("playwright-core");
    const original = module.chromium.launch;
    module.chromium.launch = (() => { throw new Error("no browser installed"); }) as any;
    try {
        const result = await fit(assembled.pages, assembled.title, assembled.settings, options, render);
        expect(result.pages).toEqual(assembled.pages);
        expect(result.diagnostics.some(d => d.message.includes("no browser available"))).toBe(true);
    } finally {
        module.chromium.launch = original;
    }
});

test("a plain build never imports playwright at all", async () => {
    // build.ts and fit.ts are separate modules for exactly this reason: importing build
    // must not pull in a browser dependency that a normal deck build never needs
    const source = await Bun.file(`${import.meta.dir}/../src/build.ts`).text();
    expect(source).not.toContain("playwright");
});
