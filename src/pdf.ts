import { openFit, type FitSession } from "./fit";
import type { Diagnostic } from "./types";

/**
 * A PDF is the deck printed by the same headless chromium the fit solver measures with. The
 * html handed in is expected to be the fitted deck without the viewer: `@page` sizes the
 * paper to the deck's ratio, so one deck page is one PDF page and no chrome is on it.
 *
 * Degrades the way `fit` does: no browser is one diagnostic and no file, never a throw.
 */
export async function pdf(html: string, path: string, session?: FitSession): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const diagnostics: Diagnostic[] = [];
    const own = session ?? await openFit(diagnostics);
    const page = own.page;
    if (!page) {
        if (!session) await own.close();
        diagnostics.push({ level: "warn", message: `no browser available; ${path} was not written` });
        return { written: false, diagnostics };
    }
    try {
        await page.setContent(html, { waitUntil: "load" });
        // a web font still loading at "load" prints as its fallback
        await page.evaluate(() => document.fonts.ready);
        await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
    } finally {
        if (!session) await own.close();
    }
    return { written: true, diagnostics };
}
