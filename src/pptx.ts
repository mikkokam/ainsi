import PptxGenJS from "pptxgenjs";
import { openFit, type FitSession } from "./fit";
import type { Diagnostic } from "./types";

/**
 * An editable PPTX is the deck in two layers: everything non-text screenshotted as one
 * background picture per page (panels, images, rules, pseudo-content, shadows — exactly as
 * chromium painted them), and every run of text lifted out as a native PowerPoint text box
 * at the same coordinates, same size, colour, weight and alignment. The client gets a file
 * where any line can be clicked and retyped, and the design cannot be broken because it is
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

interface PageDump {
    /** rendered page size px, so coordinates normalise however the page actually laid out */
    pw: number;
    ph: number;
    boxes: Box[];
    /** base64 png of the page with every lifted glyph transparent */
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
        await page.setContent(html, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);

        const count = await page.evaluate(() => document.querySelectorAll(".ainsi-page").length);
        const dumps: PageDump[] = [];
        for (let index = 0; index < count; index++) {
            const { pw, ph, boxes } = await page.evaluate(walk, index);
            await page.evaluate(hide, index);
            const handle = (await page.$$(".ainsi-page"))[index]!;
            const shot = (await handle.screenshot({ type: "png" })).toString("base64");
            await page.evaluate(restore, index);
            dumps.push({ pw, ph, boxes, shot });
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
                slide.addText(texts, {
                    x: (box.x + box.w / 2) * scale - w / 2,
                    y: (box.y + box.h / 2) * scale - h / 2,
                    w, h,
                    align: box.align as "left" | "center" | "right",
                    valign: "top",
                    margin: 0,
                    inset: 0,
                    lineSpacing: Math.round(box.linePx * scale * 72 * 10) / 10,
                    ...(box.rotate ? { rotate: box.rotate } : {}),
                    ...(box.bullet ? { bullet: { code: "2022", indent: 8 } } : {}),
                });
            }
        }

        await deck.writeFile({ fileName: path });
    } finally {
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

    const hex = (rgb: string): string => {
        const m = rgb.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"];
        return m.slice(0, 3).map(n => Math.round(Number(n)).toString(16).padStart(2, "0")).join("");
    };
    const clear = (bg: string): boolean => /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/.test(bg);

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
            const parts = bg.match(/[\d.]+/g)!.map(Number);
            const alpha = parts.length > 3 ? parts[3]! : 1;
            if (alpha >= 1) return hex(bg);
            let backdrop = [255, 255, 255];
            for (let behind: Element | null = el.parentElement; behind; behind = behind.parentElement) {
                const fill = getComputedStyle(behind).backgroundColor;
                const p = fill.match(/[\d.]+/g)?.map(Number) ?? [];
                if (p.length && (p.length < 4 || p[3]! > 0.99)) { backdrop = p.slice(0, 3); break; }
                if (behind === section) break;
            }
            return parts.slice(0, 3)
                .map((c, k) => Math.round(c * alpha + backdrop[k]! * (1 - alpha)))
                .map(n => n.toString(16).padStart(2, "0")).join("");
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
            color: hex(style.color),
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

/** Runs in the page: lifted glyphs and inline chip fills go transparent for the screenshot. */
function hide(index: number): void {
    const style = document.createElement("style");
    style.id = "ainsi-shot";
    style.textContent = ".ainsi-shot .ainsi-lift { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important }\n"
        + ".ainsi-shot main :is(mark, code, kbd, samp):not(pre *) { background: transparent !important; box-shadow: none !important; border-color: transparent !important }";
    document.head.append(style);
    document.querySelectorAll(".ainsi-page")[index]!.classList.add("ainsi-shot");
}

function restore(index: number): void {
    document.getElementById("ainsi-shot")?.remove();
    document.querySelectorAll(".ainsi-page")[index]!.classList.remove("ainsi-shot");
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
