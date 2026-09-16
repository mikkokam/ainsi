import type { Diagnostic, Entity, Page } from "./types";

/*
 * A fenced diagram, drawn before the page is measured.
 *
 * Drawing it in the page at view time is the obvious idea and the wrong one: the fit solver
 * measures a page in a headless browser and steps its density until it fits, so a diagram that
 * draws asynchronously would be measured as an empty box, and every export would carry a
 * megabyte of renderer with it. Here the fence becomes an svg before anything measures it, and
 * the html, the pdf and the pptx all get the same picture with nothing extra in them.
 *
 * Both renderers are external and optional. d2 is a binary on PATH and mermaid needs the same
 * chromium the fit solver uses; without either, the fence stays a code block and says why, the
 * way a missing browser leaves pages unfitted rather than failing the build.
 */

/** the fences that are pictures rather than code, in the order a deck should reach for them */
export const FENCES = ["d2", "mermaid"] as const;

interface Fence {
    lang: string;
    code: string;
    /** the fence becomes raw html in place, which is what the renderer emits for it */
    set(html: string): void;
}

function fences(entities: Entity[]): Fence[] {
    const found: Fence[] = [];
    const visit = (node: any): void => {
        if (!node || typeof node !== "object") return;
        const lang = typeof node.lang === "string" ? node.lang.toLowerCase() : undefined;
        if (node.type === "code" && lang && (FENCES as readonly string[]).includes(lang)) {
            found.push({
                lang,
                code: String(node.value ?? ""),
                set: (html: string) => { node.type = "html"; node.value = html; node.lang = undefined; node.meta = undefined; },
            });
        }
        for (const child of node.children ?? []) visit(child);
    };
    for (const entity of entities) visit(entity.node);
    return found;
}

/** the theme's own colours and faces, which is what a diagram is drawn in */
export interface Palette {
    ink: string; inkSoft: string; ground: string; accent: string; accentInk: string;
    rule: string; surface: string; tint: string; font: string; mono: string;
}

const FALLBACK: Palette = {
    ink: "#111111", inkSoft: "#666666", ground: "#ffffff", accent: "#2563eb", accentInk: "#ffffff",
    rule: "#dddddd", surface: "#f4f4f5", tint: "#eef2ff", font: "system-ui, sans-serif", mono: "ui-monospace, monospace",
};

/** what d2 and mermaid can be handed: a colour, not an expression a browser would have resolved */
const usable = (value: string | undefined): value is string =>
    !!value && !value.includes("var(") && !value.includes("color-mix(");

/*
 * A colour either renderer will take: hex or a name. `rgb(255 253 250 / 72%)` is a surface on
 * glass, and a diagram has nothing behind it to be translucent against, so the alpha is dropped
 * rather than the colour.
 */
function opaque(value: string | undefined): string | undefined {
    if (!usable(value)) return undefined;
    const parts = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value);
    if (!parts) return value;
    return `#${parts.slice(1, 4).map(n => Math.round(Number(n)).toString(16).padStart(2, "0")).join("")}`;
}

/** `color-mix(in srgb, A n%, B)`, done here because neither renderer is a browser */
function mix(value: string, resolve: (name: string) => string | undefined): string | undefined {
    const parts = /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/.exec(value);
    if (!parts) return undefined;
    const hex = (one: string): number[] | undefined => {
        const named = /^var\(\s*--ainsi-([a-z0-9-]+)/.exec(one);
        const colour = named ? resolve(named[1]!) : one;
        const digits = colour && /^#([0-9a-f]{6})$/i.exec(colour.trim())?.[1];
        return digits ? [0, 2, 4].map(at => Number.parseInt(digits.slice(at, at + 2), 16)) : undefined;
    };
    const [a, b] = [hex(parts[1]!), hex(parts[3]!)];
    if (!a || !b) return undefined;
    const share = Number(parts[2]) / 100;
    const channel = (i: number) => Math.round(a[i]! * share + b[i]! * (1 - share)).toString(16).padStart(2, "0");
    return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/**
 * The tokens a diagram needs, read from the theme's css. The last declaration of a token wins,
 * because the default theme's sit under every other theme's and the cascade is what decides
 * which one the page is drawn in. One hop of indirection is followed, since a theme writing
 * `--ainsi-font-display: var(--ainsi-font)` means the face it points at, and a `color-mix` is
 * worked out here: a renderer handed either literal draws nothing.
 */
export function paletteOf(css: string): Palette {
    const declared = (name: string): string | undefined => {
        const all = [...css.matchAll(new RegExp(`--ainsi-${name}:\\s*([^;]+);`, "g"))];
        return all.at(-1)?.[1]?.trim();
    };
    const read = (name: string, depth = 0): string | undefined => {
        const value = declared(name);
        if (!value) return undefined;
        const hop = /^var\(\s*--ainsi-([a-z0-9-]+)/.exec(value);
        if (hop) return depth < 2 ? read(hop[1]!, depth + 1) : undefined;
        if (value.startsWith("color-mix(")) return mix(value, one => read(one, depth + 1));
        return value;
    };
    const colour = (name: string, fallback: string, second?: string): string => {
        const own = opaque(read(name));
        if (own) return own;
        return opaque(second ? read(second) : undefined) ?? fallback;
    };
    const face = (name: string, fallback: string): string => {
        const own = read(name);
        return usable(own) ? own : fallback;
    };
    return {
        ink: colour("ink", FALLBACK.ink),
        inkSoft: colour("ink-soft", FALLBACK.inkSoft),
        ground: colour("ground", FALLBACK.ground),
        accent: colour("accent", FALLBACK.accent),
        accentInk: colour("accent-ink", FALLBACK.accentInk),
        rule: colour("rule", FALLBACK.rule),
        surface: colour("surface", FALLBACK.surface),
        tint: colour("tint", FALLBACK.tint, "surface"),
        font: face("font", FALLBACK.font),
        mono: face("font-mono", FALLBACK.mono),
    };
}

/*
 * d2's own palette, by the names its theme overrides use: B1 to B6 are the blues a shape and
 * its label are drawn in, AA and AB the alternates, N1 to N7 the neutrals from ink to paper.
 * The deck's own `vars` block, if it has one, comes after this and wins, because a diagram that
 * configures itself means it.
 */
const d2Prelude = (p: Palette): string => `vars: {
  d2-config: {
    theme-overrides: {
      B1: "${p.accent}"
      B2: "${p.accent}"
      B3: "${p.tint}"
      B4: "${p.tint}"
      B5: "${p.surface}"
      B6: "${p.surface}"
      AA2: "${p.accent}"
      AA4: "${p.tint}"
      AA5: "${p.surface}"
      AB4: "${p.surface}"
      AB5: "${p.tint}"
      N1: "${p.ink}"
      N2: "${p.ink}"
      N3: "${p.inkSoft}"
      N4: "${p.inkSoft}"
      N5: "${p.rule}"
      N6: "${p.surface}"
      N7: "${p.ground}"
    }
    pad: 16
  }
}
`;

async function drawD2(code: string, palette: Palette, diagnostics: Diagnostic[]): Promise<string | undefined> {
    try {
        const child = Bun.spawn(["d2", "-", "-"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
        child.stdin.write(d2Prelude(palette) + code);
        await child.stdin.end();
        const [svg, error, status] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ]);
        if (status === 0 && svg.includes("<svg")) return svg;
        diagnostics.push({ level: "warn", message: `d2 could not draw a diagram, so it stays a code block: ${error.trim().split("\n")[0] ?? `exit ${status}`}` });
    } catch {
        diagnostics.push({ level: "warn", message: "no d2 on PATH, so a d2 fence stays a code block; install d2 to draw it" });
    }
    return undefined;
}

/** mermaid's own bundle, read from the checkout rather than a cdn: a build is offline work */
async function mermaidBundle(): Promise<string | undefined> {
    const at = Bun.resolveSync("mermaid/dist/mermaid.min.js", import.meta.dir + "/..");
    return Bun.file(at).text().catch(() => undefined);
}

/**
 * Every mermaid fence in one page of its own: mermaid is loaded once, the browser is the fit
 * solver's, and the page is thrown away after. A diagram that mermaid refuses is left as a
 * code block rather than taking the build with it.
 */
async function drawMermaid(codes: string[], palette: Palette, page: any, diagnostics: Diagnostic[]): Promise<(string | undefined)[]> {
    const bundle = await mermaidBundle();
    if (!bundle) {
        diagnostics.push({ level: "warn", message: "mermaid is not installed in this checkout, so a mermaid fence stays a code block" });
        return codes.map(() => undefined);
    }
    // a context of its own, not the measuring page's: that one is owned by the browser it was
    // opened from and refuses a second page, and mermaid's dom has no business in it anyway
    let sheet: any;
    let own: any;
    try {
        own = await page.context().browser()?.newContext();
        sheet = own ? await own.newPage() : undefined;
        if (!sheet) throw new Error("no browser context");
        await sheet.setContent("<!doctype html><html><body></body></html>");
        await sheet.addScriptTag({ content: bundle });
        return await sheet.evaluate(async ([sources, p]: [string[], Palette]) => {
            const mermaid = (globalThis as any).mermaid;
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: "strict",
                theme: "base",
                fontFamily: p.font,
                themeVariables: {
                    background: p.ground,
                    primaryColor: p.tint,
                    primaryTextColor: p.ink,
                    primaryBorderColor: p.accent,
                    secondaryColor: p.surface,
                    tertiaryColor: p.ground,
                    lineColor: p.inkSoft,
                    textColor: p.ink,
                    mainBkg: p.tint,
                    nodeBorder: p.accent,
                    clusterBkg: p.surface,
                    clusterBorder: p.rule,
                    titleColor: p.ink,
                    edgeLabelBackground: p.ground,
                    fontFamily: p.font,
                    // a gantt is a roadmap, and its bars are the one thing on it that carries
                    // the accent; the grid behind them stays the theme's rule colour
                    sectionBkgColor: p.surface,
                    altSectionBkgColor: p.ground,
                    sectionBkgColor2: p.surface,
                    taskBkgColor: p.accent,
                    taskTextColor: p.accentInk,
                    taskTextOutsideColor: p.ink,
                    taskTextDarkColor: p.ink,
                    activeTaskBkgColor: p.tint,
                    activeTaskBorderColor: p.accent,
                    doneTaskBkgColor: p.surface,
                    doneTaskBorderColor: p.rule,
                    critBkgColor: p.tint,
                    gridColor: p.rule,
                    todayLineColor: p.accent,
                },
            });
            const out: (string | undefined)[] = [];
            for (let i = 0; i < sources.length; i++) {
                try {
                    const { svg } = await mermaid.render(`ainsi-diagram-${i}`, sources[i]);
                    out.push(svg);
                } catch (error) {
                    out.push(undefined);
                }
            }
            return out;
        }, [codes, palette] as [string[], Palette]);
    } catch (error) {
        diagnostics.push({ level: "warn", message: `mermaid could not draw: ${String(error).split("\n")[0]}` });
        return codes.map(() => undefined);
    } finally {
        await own?.close().catch(() => undefined);
    }
}

/*
 * An svg on the page, hung from the left like every other block.
 *
 * mermaid emits `width="100%"` and no height, so the box is as wide as the page while the
 * drawing keeps the viewBox's ratio, and the default `xMidYMid` then centres the drawing in
 * the space left over: a gantt that looks centred on a page whose every other line is flush
 * left. Giving the svg the viewBox's own width and height makes the box the drawing's own
 * size, which the css then shrinks by ratio, and anchoring it left settles what happens to
 * whatever space is still spare.
 */
function sized(svg: string): string {
    const open = /^\s*<svg\b[^>]*>/.exec(svg);
    const box = open && /viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/.exec(open[0]);
    if (!open || !box) return svg;
    const tag = open[0]
        .replace(/\s(width|height)="[^"]*"/g, "")
        .replace(/\smax-width:\s*[^;"]+;?/g, "")
        .replace(/\spreserveAspectRatio="[^"]*"/g, "")
        .replace(/^<svg\b/, `<svg width="${box[1]}" height="${box[2]}" preserveAspectRatio="xMinYMin meet"`);
    return tag + svg.slice(open[0].length);
}

/** an svg on the page: a figure the fit solver can shrink with everything else */
const figure = (svg: string, lang: string): string =>
    `<figure class="ainsi-diagram" data-ainsi-diagram="${lang}">${sized(svg.replace(/<\?xml[^>]*\?>/, "").trim())}</figure>`;

/*
 * Held for the life of the process, by what was drawn and what it was drawn in. The studio
 * rebuilds on every keystroke and a diagram is the most expensive thing on a page: d2 is a
 * process and mermaid is a browser, against a build that is otherwise single-digit
 * milliseconds. A palette change is a different key, so a theme swap redraws.
 */
const drawn = new Map<string, string>();

/**
 * Every diagram fence in the deck, drawn. Nothing here fails a build: a fence whose renderer is
 * missing or whose source is wrong stays the code block it already was, which is readable and
 * says what was meant.
 */
export async function drawDiagrams(
    pages: Page[],
    palette: Palette,
    browser: (() => Promise<{ page?: unknown }>) | undefined,
    diagnostics: Diagnostic[],
): Promise<void> {
    const found = fences(pages.flatMap(p => p.blocks).flatMap(b => b.entities));
    if (!found.length) return;
    const key = (fence: Fence) => `${fence.lang}\u0000${JSON.stringify(palette)}\u0000${fence.code}`;

    for (const fence of found.filter(one => one.lang === "d2")) {
        const held = drawn.get(key(fence));
        if (held) { fence.set(held); continue; }
        const svg = await drawD2(fence.code, palette, diagnostics);
        if (!svg) continue;
        const html = figure(svg, "d2");
        drawn.set(key(fence), html);
        fence.set(html);
    }

    const mermaids = found.filter(one => one.lang === "mermaid");
    if (!mermaids.length) return;
    for (const fence of mermaids) {
        const held = drawn.get(key(fence));
        if (held) fence.set(held);
    }
    const missing = mermaids.filter(one => !drawn.has(key(one)));
    if (!missing.length) return;

    const session = await browser?.();
    if (!session?.page) {
        diagnostics.push({
            level: "warn",
            message: "no browser available, so a mermaid fence stays a code block; run `bun install && bunx playwright install chromium` to draw it",
        });
        return;
    }
    const svgs = await drawMermaid(missing.map(one => one.code), palette, session.page, diagnostics);
    svgs.forEach((svg, i) => {
        if (!svg) return;
        const html = figure(svg, "mermaid");
        drawn.set(key(missing[i]!), html);
        missing[i]!.set(html);
    });
}
