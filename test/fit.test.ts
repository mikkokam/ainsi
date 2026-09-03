import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { assemble, render } from "../src/build";
import { fit } from "../src/fit";
import { BUILTIN, LAYOUTS, load, loadLayouts, loadTheme } from "../src/load";

const registry = await load([BUILTIN]);
const layouts = await loadLayouts([LAYOUTS]);
const theme = await loadTheme(resolve(import.meta.dir, "../themes/default"));
// real theme tokens, not "": with none, --pac-size and --pac-pad are invalid var() calls
// that fall back to the property's initial value, and nothing can ever overflow a page
// sized by 16px text and zero padding
const options = { registry, layouts, themeCss: theme.css };

const OVERFLOWING = `# T

intro

- Q1: a real sentence here about q1
- Q2: a real sentence here about q2
- Q3: a real sentence here about q3
- Q4: a real sentence here about q4

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
 * skipped rather than failed when `bunx playwright install chromium` has not been run. A
 * skip here is exactly the degrade a real build gives: fit is optional everywhere, including
 * in the test suite that checks it.
 */
const chromium: boolean = await import("playwright-core")
    .then(({ chromium }) => chromium.launch().then(b => b.close().then(() => true)).catch(() => false))
    .catch(() => false);

test.skipIf(!chromium)("fit splits a page that overflows, at a block boundary", async () => {
    const assembled = assemble(OVERFLOWING, options);
    const result = await fit(assembled.pages, assembled.title, assembled.settings, options, render);

    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.diagnostics.some(d => d.message.includes("overflowed; split after"))).toBe(true);

    const covered = result.pages.flatMap(p => p.blocks.map(b => b.id));
    const original = assembled.pages.flatMap(p => p.blocks.map(b => b.id));
    expect(covered.sort()).toEqual(original.sort());   // splitting loses nothing
});

test.skipIf(!chromium)("fit renumbers pages after a split", async () => {
    const assembled = assemble(OVERFLOWING, options);
    const result = await fit(assembled.pages, assembled.title, assembled.settings, options, render);
    expect(result.pages.map(p => p.index)).toEqual(result.pages.map((_, i) => i));
});

test.skipIf(!chromium)("a page that overflows as one block is reported, not silently dropped", async () => {
    const long = Array.from({ length: 20 }, (_, i) =>
        `Paragraph number ${i}, long enough on its own to add real vertical height to the page, several words to be sure of it.`,
    ).join("\n\n");
    const assembled = assemble(`# T\n\n${long}\n`, options);
    const result = await fit(assembled.pages, assembled.title, assembled.settings, options, render);
    expect(result.pages.length).toBe(1);   // prose absorbs every paragraph into one block; nothing to split at
    expect(result.diagnostics.some(d => d.message.includes("cannot be split further"))).toBe(true);
});

test.skipIf(!chromium)("a page that already fits is left untouched", async () => {
    const assembled = assemble("# T\n\na\n", options);
    const result = await fit(assembled.pages, assembled.title, assembled.settings, options, render);
    expect(result.pages).toEqual(assembled.pages);
    expect(result.diagnostics).toEqual([]);
});

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
