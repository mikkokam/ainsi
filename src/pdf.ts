import { openFit, type FitSession } from "./fit";
import type { Diagnostic } from "./types";

/**
 * A PDF is the deck printed by the same headless chromium the fit solver measures with. The
 * html handed in is expected to be the fitted deck without the viewer: `@page` sizes the
 * paper to the deck's ratio, so one deck page is one PDF page and no chrome is on it.
 *
 * Degrades the way `fit` does: no browser is one diagnostic and no file, never a throw.
 */

/**
 * How much resolution a raster image keeps in the print. Chromium embeds images at their
 * source resolution, so a deck of camera photos prints tens of megabytes; before printing,
 * any image carrying more pixels than its rendered size warrants is redrawn onto a canvas
 * capped at `density` device pixels per CSS pixel and re-encoded as webp at `quality`.
 * The cap is relative to rendered size, so nothing visible at 100% is lost. Vector content
 * (text, CSS, svg) is untouched at every preset.
 */
export type PdfImages = "full" | "screen" | "compact";

export const PDF_IMAGES: PdfImages[] = ["screen", "compact", "full"];

const PRESETS: Record<Exclude<PdfImages, "full">, { density: number; quality: number }> = {
    screen: { density: 2, quality: 0.85 },   // native on a retina display
    compact: { density: 1, quality: 0.7 },   // attachment-sized; soft when zoomed
};

export async function pdf(html: string, path: string, session?: FitSession, images: PdfImages = "screen"): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const diagnostics: Diagnostic[] = [];
    const own = session ?? await openFit(diagnostics);
    const page = own.page;
    if (!page) {
        if (!session) await own.close();
        diagnostics.push({
            level: "warn",
            message: `no browser available, so ${path} was not written; run \`bun install && bunx playwright `
                + "install chromium` in the ainsi checkout, or set AINSI_CHROMIUM to an existing binary",
        });
        return { written: false, diagnostics };
    }
    try {
        await page.setContent(html, { waitUntil: "load" });
        // a web font still loading at "load" prints as its fallback
        await page.evaluate(() => document.fonts.ready);
        if (images !== "full") await downscale(page, PRESETS[images]);
        await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
    } finally {
        if (!session) await own.close();
    }
    return { written: true, diagnostics };
}

/**
 * Runs in the page so each image is capped against the size it is actually shown at, which
 * only the layout knows. Any image that fails a step — undecodable, or a taint the launch
 * flag in `fit` did not lift — prints at full resolution rather than not at all.
 */
async function downscale(page: import("playwright-core").Page, cap: { density: number; quality: number }): Promise<void> {
    await page.evaluate(async ({ density, quality }) => {
        for (const img of Array.from(document.images)) {
            try {
                // rasterising an svg here would trade infinite resolution for the cap
                if (/\.svg($|[?#])|^data:image\/svg/.test(img.currentSrc)) continue;
                await img.decode();
                const shown = img.getBoundingClientRect().width;
                if (!shown || !img.naturalWidth) continue;
                const width = Math.round(shown * density);
                if (width >= img.naturalWidth) continue;
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = Math.max(1, Math.round(img.naturalHeight * (width / img.naturalWidth)));
                const context = canvas.getContext("2d");
                if (!context) continue;
                context.drawImage(img, 0, 0, canvas.width, canvas.height);
                /*
                 * jpeg, because the pdf writer embeds it as-is; anything else it decodes
                 * and stores as a flate bitmap larger than the original. Transparency
                 * would flatten to black under jpeg, so an image with any is kept as png:
                 * still the resolution win, without the lossy byte win.
                 */
                const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
                let alpha = false;
                for (let i = 3; i < data.length; i += 4) {
                    if (data[i] !== 255) { alpha = true; break; }
                }
                const url = alpha ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality);
                img.removeAttribute("srcset");
                img.src = url;
                await img.decode();
            } catch { /* printed as-is */ }
        }
    }, cap);
}
