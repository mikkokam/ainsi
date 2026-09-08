import PptxGenJS from "pptxgenjs";
import { openFit, place, type FitSession } from "./fit";
import type { Diagnostic } from "./types";

/**
 * An editable PPTX is the deck in three layers: everything non-text screenshotted as one
 * background picture per page (panels, rules, pseudo-content, shadows — exactly as chromium
 * painted them), each photograph screenshotted again on its own so it arrives as a picture a
 * client can select, move or replace, and every run of text lifted out as a native PowerPoint
 * text box at the same coordinates, same size, colour, weight and alignment. The client gets a
 * file where any line can be clicked and retyped, and the design cannot be broken because it is
 * pixels underneath.
 *
 * The html handed in is the fitted deck without the viewer, like `pdf` gets: the ground must
 * be the design-width render, or em-based layouts wrap differently than the deck shows.
 *
 * Degrades the way `fit` does: no browser is one diagnostic and no file, never a throw.
 */

/** The design box a page is rendered in; matches the fit solver's measuring viewport. */
const VIEWPORT = { width: 1280, height: 900 };

/** Slide width in inches. 13.333in at 96dpi is exactly 1280px, so px map 1:1 to PPT px. */
const SLIDE_W = 40 / 3;

interface Run {
    text: string;
    fontPx: number;
    /** the full CSS stack; resolved to the rendered platform font after the walk */
    family: string;
    bold: boolean;
    italic: boolean;
    /** hex without # */
    color: string;
    /** an inline chip's fill (mark, code) rides the run as a highlight, never the ground */
    highlight?: string;
}

interface Box {
    /** px, page-relative */
    x: number; y: number; w: number; h: number;
    align: string;
    /** clockwise degrees: vertical writing-mode plus any transform */
    rotate: number;
    /** CSS line-height in px, written as exact spacing: PPT's "multiple" would stack on the font's own ~1.2 */
    linePx: number;
    bullet: boolean;
    runs: Run[];
}

/** A photograph lifted out of the ground: px page-relative box and a base64 png. */
interface Photo {
    x: number; y: number; w: number; h: number;
    png: string;
}

/** The theme's mark on a page, rasterised: px page-relative box and a base64 png. */
interface Mark {
    x: number; y: number; w: number; h: number;
    png: string;
}

interface PageDump {
    /** rendered page size px, so coordinates normalise however the page actually laid out */
    pw: number;
    ph: number;
    boxes: Box[];
    photos: Photo[];
    mark?: Mark;
    /** base64 png of the page with every lifted glyph, picture and the mark transparent */
    shot: string;
}

export async function pptx(html: string, path: string, session?: FitSession): Promise<{ written: boolean; diagnostics: Diagnostic[] }> {
    const diagnostics: Diagnostic[] = [];
    const own = session ?? await openFit(diagnostics);
    if (!own.page) {
        if (!session) await own.close();
        diagnostics.push({ level: "warn", message: `no browser available; ${path} was not written` });
        return { written: false, diagnostics };
    }

    /*
     * A page of our own at 2x device pixels, so the ground keeps retina sharpness; the fit
     * session's page stays at 1x for measuring. Density is context-bound in playwright, so
     * this cannot ride the session page. Falls back to it if the browser is not reachable.
     */
    const browser = own.page.context().browser();
    const page = (await browser?.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 }).catch(() => undefined)) ?? own.page;
    const borrowed = page === own.page;

    try {
        // the print sheet is the export: no corner radius, no shadow, like the pdf
        await page.emulateMedia({ media: "print" });
        if (!await place(page, html)) {
            diagnostics.push({
                level: "warn",
                message: `pictures were still loading after 90s; ${path} was written without them`,
            });
        }

        const count = await page.evaluate(() => document.querySelectorAll(".ainsi-page").length);
        const dumps: PageDump[] = [];
        for (let index = 0; index < count; index++) {
            const { pw, ph, boxes } = await page.evaluate(walk, index);
            const mark = await page.evaluate(lift, index).catch(() => undefined);
            const handle = (await page.$$(".ainsi-page"))[index]!;
            // the pictures come off the page while they are still painted, and the ground is
            // shot after they have gone, so nothing is carried twice
            const cuts = await page.evaluate(cut, index);
            const cutouts = await handle.$$(".ainsi-cut");
            const photos: Photo[] = [];
            for (let i = 0; i < cuts.length && i < cutouts.length; i++) {
                const png = (await cutouts[i]!.screenshot({ type: "png" }).catch(() => undefined))?.toString("base64");
                if (png) photos.push({ ...cuts[i]!, png });
            }
            await page.evaluate(hide, { index, mark: !!mark });
            const shot = (await handle.screenshot({ type: "png" })).toString("base64");
            await page.evaluate(restore, index);
            dumps.push({ pw, ph, boxes, photos, mark, shot });
        }

        const fonts = await resolveFonts(page, dumps);

        const deck = new PptxGenJS();
        const ratio = dumps[0] ? dumps[0].ph / dumps[0].pw : 9 / 16;
        deck.defineLayout({ name: "deck", width: SLIDE_W, height: SLIDE_W * ratio });
        deck.layout = "deck";

        for (const dump of dumps) {
            const scale = SLIDE_W / dump.pw;
            const slide = deck.addSlide();
            slide.addImage({ data: "image/png;base64," + dump.shot, x: 0, y: 0, w: SLIDE_W, h: SLIDE_W * (dump.ph / dump.pw) });
            // above the ground, below the words: a picture is behind a caption written over it
            for (const photo of dump.photos) {
                slide.addImage({
                    data: "image/png;base64," + photo.png,
                    x: photo.x * scale, y: photo.y * scale, w: photo.w * scale, h: photo.h * scale,
                });
            }
            if (dump.mark) {
                const { x, y, w, h, png } = dump.mark;
                slide.addImage({ data: "image/png;base64," + png, x: x * scale, y: y * scale, w: w * scale, h: h * scale });
            }
            for (const box of dump.boxes) {
                const texts = box.runs.map(run => ({
                    text: run.text,
                    options: {
                        fontSize: Math.round(run.fontPx * scale * 72 * 10) / 10,   // px -> in -> pt
                        fontFace: fonts.get(run.family) ?? run.family,
                        bold: run.bold,
                        italic: run.italic,
                        color: run.color,
                        ...(run.highlight ? { highlight: run.highlight } : {}),
                    },
                }));
                // ppt rotates a shape about its centre, so a rotated block keeps its screen
                // centre and swaps width for height when it stands sideways
                const sideways = box.rotate === 90 || box.rotate === 270;
                const w = (sideways ? box.h : box.w) * scale + 0.05;
                const h = (sideways ? box.w : box.h) * scale;
                // ppt measures text a shade wider than chromium, so a box cut to the width the
                // line actually took wraps its last word onto a line of its own. A block the
                // deck set on one line is told not to wrap at all rather than given slack to
                // guess at; a block that already wraps keeps its own breaks by keeping its width
                const oneLine = box.h < box.linePx * 1.5;
                slide.addText(texts, {
                    x: (box.x + box.w / 2) * scale - w / 2,
                    y: (box.y + box.h / 2) * scale - h / 2,
                    w, h,
                    align: box.align as "left" | "center" | "right",
                    valign: "top",
                    margin: 0,
                    inset: 0,
                    ...(oneLine ? { wrap: false } : {}),
                    lineSpacing: Math.round(box.linePx * scale * 72 * 10) / 10,
                    ...(box.rotate ? { rotate: box.rotate } : {}),
                    ...(box.bullet ? { bullet: { code: "2022", indent: 8 } } : {}),
                });
            }
        }

        await deck.writeFile({ fileName: path });
    } finally {
        if (borrowed) await page.emulateMedia({ media: null }).catch(() => undefined);
        if (!borrowed) await page.close();
        if (!session) await own.close();
    }
    return { written: true, diagnostics };
}

/**
 * Runs in the page: every text node of one page grouped by its nearest block-level ancestor,
 * which becomes the text box, with one styled run per node. The node's parent is tagged
 * `ainsi-lift` so the screenshot pass can blank exactly these glyphs and nothing else —
 * pseudo-content (box numbers, counters) has no text node here and must stay in the ground.
 */
function walk(index: number): { pw: number; ph: number; boxes: Box[] } {
    const section = document.querySelectorAll<HTMLElement>(".ainsi-page")[index]!;
    const pageRect = section.getBoundingClientRect();

    /* a computed colour is rgb(a) or, after color-mix, color(srgb r g b / a) */
    const rgba = (css: string): { r: number; g: number; b: number; a: number } => {
        const srgb = css.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
        if (srgb) return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: srgb[4] === undefined ? 1 : Number(srgb[4]) };
        const p = css.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
        return { r: p[0]!, g: p[1]!, b: p[2]!, a: p.length > 3 ? p[3]! : 1 };
    };
    const hex = (c: { r: number; g: number; b: number }): string =>
        [c.r, c.g, c.b].map(n => Math.round(n).toString(16).padStart(2, "0")).join("");
    const clear = (css: string): boolean => css === "transparent" || rgba(css).a === 0;
    /* a translucent colour flattened against the nearest opaque fill behind it: ppt has no alpha on text or highlight */
    const flat = (css: string, el: Element): string => {
        const c = rgba(css);
        if (c.a >= 1) return hex(c);
        let backdrop = { r: 255, g: 255, b: 255 };
        for (let behind: Element | null = el.parentElement; behind; behind = behind.parentElement) {
            const fill = rgba(getComputedStyle(behind).backgroundColor);
            if (fill.a > 0.99) { backdrop = fill; break; }
            if (behind === section) break;
        }
        return hex({ r: c.r * c.a + backdrop.r * (1 - c.a), g: c.g * c.a + backdrop.g * (1 - c.a), b: c.b * c.a + backdrop.b * (1 - c.a) });
    };

    const blockOf = (el: Element): HTMLElement => {
        let node: Element | null = el;
        while (node && node !== section) {
            const display = getComputedStyle(node).display;
            if (display !== "inline" && !display.startsWith("inline-")) return node as HTMLElement;
            node = node.parentElement;
        }
        return section;
    };

    /*
     * An inline ancestor with a fill is a chip; its colour rides the run. A gradient chip
     * (the mark's highlighter stroke) flattens to the alpha-weighted mean of its stops, and
     * a translucent one is composited against whatever actually sits behind it, because a
     * ppt highlight is opaque. Stops resolve as rgba(r, g, b, a) or color(srgb r g b / a).
     */
    const chipOf = (parent: Element, block: Element): string | undefined => {
        for (let el: Element | null = parent; el && el !== block; el = el.parentElement) {
            const style = getComputedStyle(el);
            if (style.display !== "inline" && !style.display.startsWith("inline-")) break;
            let bg = style.backgroundColor;
            if (clear(bg) && style.backgroundImage !== "none") {
                const stops = [
                    ...[...style.backgroundImage.matchAll(/rgba?\(([\d.\s,]+)\)/g)]
                        .map(m => m[1]!.split(",").map(Number))
                        .map(p => ({ r: p[0]!, g: p[1]!, b: p[2]!, a: p.length > 3 ? p[3]! : 1 })),
                    ...[...style.backgroundImage.matchAll(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g)]
                        .map(m => ({ r: Number(m[1]) * 255, g: Number(m[2]) * 255, b: Number(m[3]) * 255, a: m[4] === undefined ? 1 : Number(m[4]) })),
                ].filter(p => p.a > 0);
                if (stops.length) {
                    const a = stops.reduce((n, p) => n + p.a, 0);
                    bg = `rgba(${stops.reduce((n, p) => n + p.r * p.a, 0) / a}, `
                        + `${stops.reduce((n, p) => n + p.g * p.a, 0) / a}, `
                        + `${stops.reduce((n, p) => n + p.b * p.a, 0) / a}, ${a / stops.length})`;
                }
            }
            if (clear(bg)) continue;
            return flat(bg, el);
        }
        return undefined;
    };

    const groups = new Map<HTMLElement, Run[]>();
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        if (!text.trim()) continue;
        const parent = (node as Text).parentElement;
        if (!parent) continue;
        const style = getComputedStyle(parent);
        if (style.visibility === "hidden" || style.display === "none") continue;
        const block = blockOf(parent);
        parent.classList.add("ainsi-lift");
        const runs = groups.get(block) ?? [];
        runs.push({
            text: text.replace(/\s+/g, " "),
            fontPx: parseFloat(style.fontSize),
            family: style.fontFamily,
            bold: parseInt(style.fontWeight) >= 600,
            italic: style.fontStyle === "italic",
            color: flat(style.color, parent),
            highlight: chipOf(parent, block),
        });
        groups.set(block, runs);
    }

    const boxes: Box[] = [];
    for (const [block, runs] of groups) {
        const rect = block.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const style = getComputedStyle(block);
        const lineHeight = parseFloat(style.lineHeight);
        const fontSize = parseFloat(style.fontSize);
        // vertical writing flows 90° clockwise, and any transform adds its own angle
        let rotate = style.writingMode.startsWith("vertical") ? 90 : 0;
        const matrix = style.transform.match(/matrix\(([-\d.]+),\s*([-\d.]+)/);
        if (matrix) rotate += Math.round(Math.atan2(Number(matrix[2]), Number(matrix[1])) * 180 / Math.PI);
        boxes.push({
            x: rect.left - pageRect.left, y: rect.top - pageRect.top, w: rect.width, h: rect.height,
            align: style.textAlign === "start" ? "left" : style.textAlign,
            rotate: ((rotate % 360) + 360) % 360,
            linePx: Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.2,
            bullet: block.tagName === "LI",
            runs,
        });
    }
    return { pw: pageRect.width, ph: pageRect.height, boxes };
}

/**
 * Runs in the page: the pictures that can leave the ground without changing as they go, tagged
 * for the screenshot pass and returned in the order the tags will be found again. What is lifted
 * is the picture as chromium painted it, so a corner radius and a crop travel with it; what
 * cannot travel is anything painted outside the picture's own box or over it — a box-shadow,
 * which goes when the picture is blanked and has nowhere to live in the cut-out, and a
 * pseudo-element scrim, which would end up on top of the picture it is meant to darken. Those
 * stay in the ground, which is where they look right. The cover under its scrim is that case.
 */
function cut(index: number): { x: number; y: number; w: number; h: number }[] {
    const section = document.querySelectorAll<HTMLElement>(".ainsi-page")[index]!;
    const pageRect = section.getBoundingClientRect();
    const painted = (el: Element, part: "::before" | "::after"): boolean => {
        const content = getComputedStyle(el, part).content;
        return content !== "none" && content !== "normal";
    };

    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (const img of section.querySelectorAll<HTMLImageElement>("img")) {
        const style = getComputedStyle(img);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (style.filter !== "none" || style.mixBlendMode !== "normal" || parseFloat(style.opacity) < 1) continue;
        if (style.clipPath !== "none" || style.transform !== "none" || style.boxShadow !== "none") continue;
        const rect = img.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;

        let held = false;
        for (let el: Element | null = img.parentElement; el && el !== section && !held; el = el.parentElement) {
            const above = getComputedStyle(el);
            held = painted(el, "::before") || painted(el, "::after")
                || above.mixBlendMode !== "normal" || parseFloat(above.opacity) < 1;
        }
        if (held) continue;

        img.classList.add("ainsi-cut");
        rects.push({ x: rect.left - pageRect.left, y: rect.top - pageRect.top, w: rect.width, h: rect.height });
    }
    return rects;
}

/**
 * Runs in the page. The theme's mark is the page's own ::before when it paints an image: a
 * pseudo has no node to lift, so it is redrawn through a canvas at the size and place the
 * background painted it, with the pseudo's filter and opacity applied (a one-colour mark
 * inverted for a dark ground has no other way into a native image). Undefined when there is
 * no such mark; a throw (a tainted canvas) leaves it painted in the ground.
 */
async function lift(index: number): Promise<Mark | undefined> {
    const page = document.querySelectorAll(".ainsi-page")[index]!;
    const style = getComputedStyle(page, "::before");
    const src = style.backgroundImage.match(/^url\("?(.*?)"?\)$/)?.[1];
    if (!src || style.display === "none" || style.content === "none") return undefined;
    const box = {
        w: parseFloat(style.width) + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
        h: parseFloat(style.height) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
    };
    if (!(box.w > 0 && box.h > 0)) return undefined;
    const rect = page.getBoundingClientRect();
    const left = style.left === "auto" ? rect.width - parseFloat(style.right) - box.w : parseFloat(style.left);
    const top = style.top === "auto" ? rect.height - parseFloat(style.bottom) - box.h : parseFloat(style.top);

    const img = new Image();
    img.src = src;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) return undefined;
    const natural = img.naturalWidth / img.naturalHeight;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (style.backgroundSize === "cover" ? box.w / box.h > natural : style.backgroundSize !== "auto") {
        // contain, cover on a tall box, and any explicit size read as contain: fit the width
        w = box.w; h = box.w / natural;
        if (style.backgroundSize !== "cover" && h > box.h) { h = box.h; w = box.h * natural; }
    } else if (style.backgroundSize === "cover") {
        h = box.h; w = box.h * natural;
    }
    // background-position resolves to two lengths or percentages of the slack
    const [px = "0%", py = "0%"] = style.backgroundPosition.split(" ");
    const along = (value: string, slack: number) => value.endsWith("%") ? slack * parseFloat(value) / 100 : parseFloat(value);
    const x = left + along(px, box.w - w);
    const y = top + along(py, box.h - h);

    const density = 4;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * density));
    canvas.height = Math.max(1, Math.round(h * density));
    const context = canvas.getContext("2d")!;
    if (style.filter !== "none") context.filter = style.filter;
    context.globalAlpha = parseFloat(style.opacity);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { x, y, w, h, png: canvas.toDataURL("image/png").split(",")[1]! };
}

/** Runs in the page: lifted glyphs, inline chip fills, lifted pictures and a lifted mark go transparent for the screenshot. */
function hide({ index, mark }: { index: number; mark: boolean }): void {
    const style = document.createElement("style");
    style.id = "ainsi-shot";
    style.textContent = ".ainsi-shot .ainsi-lift { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important }\n"
        + ".ainsi-shot main :is(mark, code, kbd, samp):not(pre *) { background: transparent !important; box-shadow: none !important; border-color: transparent !important }"
        + "\n.ainsi-shot .ainsi-cut { visibility: hidden !important }"
        + (mark ? "\n.ainsi-shot::before { visibility: hidden !important }" : "");
    document.head.append(style);
    document.querySelectorAll(".ainsi-page")[index]!.classList.add("ainsi-shot");
}

function restore(index: number): void {
    document.getElementById("ainsi-shot")?.remove();
    const page = document.querySelectorAll(".ainsi-page")[index]!;
    page.classList.remove("ainsi-shot");
    for (const img of page.querySelectorAll(".ainsi-cut")) img.classList.remove("ainsi-cut");
}

/**
 * Every CSS font stack resolved to the platform font chromium actually shaped it with, via
 * CDP on a probe span per unique stack. The stack's first name is a lie on any machine that
 * lacks it, and a CSS keyword (ui-monospace, system-ui) is never a typeface an office app
 * can resolve. When chromium reports a face ("Libre Franklin Thin"), the family the stack
 * asked for wins, because the family is the name office apps index by.
 */
async function resolveFonts(page: import("playwright-core").Page, dumps: PageDump[]): Promise<Map<string, string>> {
    const stacks = [...new Set(dumps.flatMap(d => d.boxes.flatMap(b => b.runs.map(r => r.family))))];
    const resolved = new Map<string, string>();
    let cdp: import("playwright-core").CDPSession | undefined;
    try {
        cdp = await page.context().newCDPSession(page);
        await cdp.send("DOM.enable");
        await cdp.send("CSS.enable");
    } catch {
        cdp = undefined;   // a non-chromium browser still gets the concrete-name fallback
    }
    for (let i = 0; i < stacks.length; i++) {
        const names = stacks[i]!.split(",").map(n => n.replace(/["']/g, "").trim());
        const concrete = names.find(n => !/^(ui-|system-ui$|serif$|sans-serif$|monospace$|math$|cursive$|fantasy$)/.test(n)) ?? names[0]!;
        let platform: string | undefined;
        if (cdp) {
            try {
                await page.evaluate(({ stack, id }: { stack: string; id: string }) => {
                    const span = document.createElement("span");
                    span.id = id;
                    span.textContent = "Handgloves 0123";
                    span.style.fontFamily = stack;
                    document.body.append(span);
                }, { stack: stacks[i]!, id: `ainsi-font-probe-${i}` });
                const doc = await cdp.send("DOM.getDocument");
                const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: `#ainsi-font-probe-${i}` });
                const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
                platform = fonts.sort((a: { glyphCount: number }, b: { glyphCount: number }) => b.glyphCount - a.glyphCount)[0]?.familyName;
            } catch { /* fallback below */ }
        }
        const family = platform && names.find(n => platform!.toLowerCase().startsWith(n.toLowerCase()));
        resolved.set(stacks[i]!, family ?? platform ?? concrete);
    }
    return resolved;
}
