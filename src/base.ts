/**
 * Structure the engine owns: the page box, the flow inside it, and element defaults.
 * Every value that is a look rather than a mechanism comes from a token, so a theme
 * never restates it.
 */
import { PLACEHOLDER } from "./placeholder";

export const BASE_CSS = `
* { box-sizing: border-box; }

/* the stand-in for an image not yet chosen; layouts paint it where an image would be their ground */
.ainsi-page { --ainsi-placeholder: url("${PLACEHOLDER}"); }

body.ainsi {
    margin: 0;
    padding: calc(var(--ainsi-gap) * 2);
    background: var(--ainsi-shell);
    font-family: var(--ainsi-font);
    color: var(--ainsi-ink);
}

.ainsi-page {
    aspect-ratio: var(--ainsi-ratio, 16 / 9);
    width: min(1280px, 100%);
    margin: 0 auto calc(var(--ainsi-gap) * 2);
    background: var(--ainsi-ground);
    border-radius: var(--ainsi-radius);
    box-shadow: var(--ainsi-shadow);
    font-size: calc(var(--ainsi-size) * var(--ainsi-step, 1));
    line-height: var(--ainsi-leading);
    overflow: hidden;
    position: relative;
}

/*
 * Tone: a page's ground, flipped to the accent, to the ink or to the tint, set by the layout's tone prop
 * landing on main as a data attribute. The theme's values are stashed on the page first,
 * because a var() reads the value on its own element: remapping --ainsi-accent and building
 * the ground from --ainsi-accent on the same element would read the remap, not the theme.
 * The remap is what keeps every component legible on the new ground without knowing about it.
 */
.ainsi-page {
    --ainsi-page-ink: var(--ainsi-ink);
    --ainsi-page-ground: var(--ainsi-ground);
    --ainsi-page-accent: var(--ainsi-accent);
    --ainsi-page-accent-ink: var(--ainsi-accent-ink);
    --ainsi-page-tint: var(--ainsi-tint);
}
.ainsi-page main[data-tone="accent"] { --ainsi-tone-bg: var(--ainsi-page-accent); --ainsi-tone-ink: var(--ainsi-page-accent-ink); }
.ainsi-page main[data-tone="inverse"] { --ainsi-tone-bg: var(--ainsi-page-ink); --ainsi-tone-ink: var(--ainsi-page-ground); }
.ainsi-page main[data-tone="accent"], .ainsi-page main[data-tone="inverse"] {
    background: var(--ainsi-tone-bg);
    color: var(--ainsi-tone-ink);
    --ainsi-ink: var(--ainsi-tone-ink);
    --ainsi-ink-soft: color-mix(in srgb, var(--ainsi-tone-ink) 72%, transparent);
    --ainsi-accent: var(--ainsi-tone-ink);
    --ainsi-accent-ink: var(--ainsi-tone-bg);
    --ainsi-ground: var(--ainsi-tone-bg);
    --ainsi-surface: color-mix(in srgb, var(--ainsi-tone-ink) 8%, transparent);
    --ainsi-rule: color-mix(in srgb, var(--ainsi-tone-ink) 30%, transparent);
}
/* soft keeps the ink and the accent: only the ground changes, and a surface lifts to the theme's ground */
.ainsi-page main[data-tone="soft"] {
    background: var(--ainsi-page-tint);
    --ainsi-ground: var(--ainsi-page-tint);
    --ainsi-surface: var(--ainsi-page-ground);
}

/*
 * Page number, bottom left, never on a cover. An opaque mix of the ink into the ground rather
 * than a faded ink, so an export lifting the text gets the colour that shows. It sits outside
 * main, so a toned page names its own pair. numbers: off keeps it as a reading aid in the
 * scroll view and drops it from presenting, print and export.
 */
.ainsi-page .ainsi-number {
    position: absolute; bottom: 1.4rem; left: 1.6rem;
    font: 500 12px/1 var(--ainsi-font-mono);
    color: color-mix(in srgb, var(--ainsi-page-ink) 45%, var(--ainsi-page-ground));
    pointer-events: none;
}
.ainsi-page:has(> main[data-tone="accent"]) .ainsi-number { color: color-mix(in srgb, var(--ainsi-page-accent-ink) 45%, var(--ainsi-page-accent)); }
.ainsi-page:has(> main[data-tone="inverse"]) .ainsi-number { color: color-mix(in srgb, var(--ainsi-page-ground) 45%, var(--ainsi-page-ink)); }
.ainsi-page:has(> main[data-tone="soft"]) .ainsi-number { color: color-mix(in srgb, var(--ainsi-page-ink) 45%, var(--ainsi-page-tint)); }
.ainsi-page[data-layout="header"] .ainsi-number { display: none; }
body[data-numbers="off"][data-present] .ainsi-number { display: none; }

/*
 * The page inset lives on main, not on the page. A percentage resolves against the
 * containing block, and the page's is the body, which is wider than the page's own cap:
 * put it on the page and every layout that repositions it lands somewhere else.
 */
.ainsi-page main { height: 100%; padding: var(--ainsi-pad); }
.ainsi-page h1, .ainsi-page h2, .ainsi-page h3 { font-family: var(--ainsi-font-display); }
.ainsi-page h1, .ainsi-page h2, .ainsi-page h3, .ainsi-page h4, .ainsi-page h5 { margin: 0 0 .4em; line-height: 1.2; }
.ainsi-page h1 { font-size: 2.49em; line-height: 1.1; letter-spacing: -.02em; }
.ainsi-page h2 { font-size: 2.07em; line-height: 1.12; }
.ainsi-page h3 { font-size: 1.73em; }
.ainsi-page h4 { font-size: 1.44em; }
.ainsi-page h5 { font-size: 1.2em; }
.ainsi-page p { margin: 0 0 .6em; }
.ainsi-page > *:last-child { margin-bottom: 0; }

/*
 * Rhythm on the page. Blocks stand a --ainsi-gap apart; text that follows text stands a
 * fraction of the page's type size apart instead, since prose is many elements rather than
 * one block. Margins, not flex gap, because a gap cannot tell a paragraph from a component.
 * --ainsi-em is the page's own font size, reachable from a child whose em is its own.
 */
.ainsi-page { --ainsi-em: calc(var(--ainsi-size) * var(--ainsi-step, 1)); }
.ainsi-page article > * + * { margin-top: var(--ainsi-gap); }
.ainsi-page :is(article, .ainsi-prose) > :is(p, h1, h2, h3, h4, h5, ul, ol, blockquote, pre) { margin-bottom: 0; }
/* a component's root carries data-ainsi, which is how a timeline's ol is told from a list's.
   A sized or coloured prose wrapper is looked through: what it ends with sets the space after
   it, what it starts with the space before, so a heading given a colour does not move. */
.ainsi-page :is(article, .ainsi-prose) > :is(p, ul, ol, blockquote, pre, .ainsi-prose):not([data-ainsi]) + :is(p, ul, ol, blockquote, pre, .ainsi-prose):not([data-ainsi]) { margin-top: calc(var(--ainsi-em) * .55); }
.ainsi-page :is(article, .ainsi-prose) > :is(h2, h3, h4, h5, .ainsi-prose:has(> :is(h2, h3, h4, h5):last-child)) + :is(p, ul, ol, blockquote, pre, .ainsi-prose):not([data-ainsi]) { margin-top: calc(var(--ainsi-em) * .6); }
.ainsi-page :is(article, .ainsi-prose) > :is(p, ul, ol, blockquote, pre, .ainsi-prose:has(> :is(p, ul, ol, blockquote, pre):last-child)):not([data-ainsi]) + :is(h2, h3, h4, h5, .ainsi-prose:has(> :is(h2, h3, h4, h5):first-child)) { margin-top: calc(var(--ainsi-em) * 1); }
/* a page title carries more weight than a heading in a document, so the air under it says so */
.ainsi-page :is(article, .ainsi-prose) > :is(h1, .ainsi-prose:has(> h1:last-child)) + :is(p, ul, ol, blockquote, pre, .ainsi-prose):not([data-ainsi]) { margin-top: calc(var(--ainsi-em) * .9); }
.ainsi-page article > :is(h1, .ainsi-prose:has(> h1:last-child)) + [data-ainsi] { margin-top: calc(var(--ainsi-gap) * 1.5); }
.ainsi-page article > :is(h2, h3, h4, h5, .ainsi-prose:has(> :is(h2, h3, h4, h5):last-child)) + [data-ainsi] { margin-top: calc(var(--ainsi-gap) * 1.2); }
.ainsi-page article > .ainsi-prose > :last-child { margin-bottom: 0; }
.ainsi-page code { font-family: var(--ainsi-font-mono); }
/* inline code as a chat client shows it: a small capsule, the theme's stop colour for the text */
.ainsi-page :not(pre) > code { font-size: .85em; padding: .08em .35em; border: 1px solid var(--ainsi-rule); border-radius: .3em; background: var(--ainsi-surface); color: var(--ainsi-danger); }
/*
 * A fenced block is a quotation from a terminal set into a page that cannot scroll, so a long
 * line wraps rather than running off the sheet, and it is set small enough that a realistic
 * command still fits the column it is quoted into.
 */
.ainsi-page pre {
    font-size: .62em; line-height: 1.5;
    padding: .9em 1.1em;
    background: var(--ainsi-surface);
    border: var(--ainsi-border) solid var(--ainsi-rule);
    border-radius: var(--ainsi-radius);
    white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2;
}
.ainsi-page pre code { font-size: inherit; color: inherit; }
.ainsi-page img { max-width: 100%; height: auto; display: block; }
/*
 * A tall image must not clip the page. No fit pass for images: the cap is ~55% of a 16:9
 * page whose width tracks min(1280px, viewport), so 31vw approximates it at every desktop
 * width and 400px matches the 1280px cap and the print page. Max constraints only, so the
 * browser keeps the ratio. Layouts that make the image their ground lift the cap themselves.
 */
.ainsi-page img { max-height: min(400px, 31vw); }
/* a placeholder stays modest in flow; a layout that makes the image its ground overrides this,
   since layout css follows base */
.ainsi-page img[data-ainsi-placeholder] { width: min(45%, 420px); }
.ainsi-page strong { font-weight: var(--ainsi-strong); }
/*
 * A link takes the ink it sits on and says so with the underline, rather than a colour of its
 * own. A page's ground is whatever a tone or a photograph makes it, and no single link colour
 * reads on all of them: the browser's own blue is 2.1:1 on a dark ground, and an accent picked
 * for the paper is no better on the accent itself. A theme that wants a coloured link on its
 * own ground can say so; this is the floor.
 */
.ainsi-page a {
    color: var(--ainsi-link, inherit);
    text-decoration: underline;
    text-decoration-thickness: .06em;
    text-underline-offset: .18em;
    text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
}
.ainsi-page a:hover { text-decoration-color: currentColor; }
/* a blockquote as markdown gives it, in the display face; a signed one carries its caption */
.ainsi-page blockquote { margin: 0; padding: 0 0 0 calc(var(--ainsi-gap) * .8); border-left: 3px solid var(--ainsi-accent); }
.ainsi-page blockquote p { font-family: var(--ainsi-font-display); font-size: 1.45em; line-height: 1.38; letter-spacing: -.01em; margin: 0 0 .5em; }
.ainsi-page blockquote p:last-child { margin-bottom: 0; }
.ainsi-page .ainsi-quote { margin: 0; display: flex; flex-direction: column; gap: calc(var(--ainsi-gap) * .85); }
.ainsi-page .ainsi-quote figcaption { padding-left: calc(var(--ainsi-gap) * .8 + 3px); font-size: .9em; font-weight: 500; color: var(--ainsi-ink-soft); }
/* a table as markdown gives it */
.ainsi-page table { border-collapse: collapse; width: 100%; }
.ainsi-page th, .ainsi-page td { text-align: left; padding: .5em .8em; border-bottom: var(--ainsi-border) solid var(--ainsi-rule); }
.ainsi-page th { font-weight: var(--ainsi-strong); }
/* the inline extras: a highlight on the accent, a key cap, a struck word, a task box */
/*
 * The highlighter stroke is a background, not a pseudo: a pseudo box on an inline spans
 * the bounding rect of its line boxes and breaks the moment a mark wraps. The gradient's
 * slight angle cuts the start edge like a chisel tip; the ink is uneven along the run and
 * fades out to nothing at the end. The shorthand sets position and size, so the draw
 * animation can grow background-size from zero.
 */
.ainsi-page mark {
    color: inherit; padding: .05em .25em .05em .15em;
    border-radius: .15em;
    background: linear-gradient(100deg,
        transparent .12em,
        color-mix(in srgb, var(--ainsi-accent) 38%, transparent) .2em,
        color-mix(in srgb, var(--ainsi-accent) 28%, transparent) 30%,
        color-mix(in srgb, var(--ainsi-accent) 33%, transparent) 60%,
        color-mix(in srgb, var(--ainsi-accent) 22%, transparent) 85%,
        color-mix(in srgb, var(--ainsi-accent) 4%, transparent)
    ) 0 0 / 100% 100% no-repeat;
}
.ainsi-page kbd { font: .85em var(--ainsi-font-mono); padding: .1em .4em; border: 1px solid var(--ainsi-rule); border-bottom-width: 2px; border-radius: .3em; }
.ainsi-page del { opacity: .55; }
.ainsi-page li:has(> input[type="checkbox"]) { list-style: none; margin-left: -1.3em; }
.ainsi-page input[type="checkbox"] { margin: 0 .5em 0 0; accent-color: var(--ainsi-accent); vertical-align: -.1em; }

/*
 * The fit solver ran out of ladder here and the page is clipped. Saying so beats hiding it,
 * and the mark belongs to the engine rather than a theme: it reports a build fact, it is not
 * a look a theme is allowed to have an opinion about. Reading view only, so a projected or
 * printed page carries no trace of it.
 */
body.ainsi:not([data-present]) .ainsi-page[data-overflow]::before {
    content: "";
    position: absolute; inset: auto 0 0 0; height: 3px;
    background: repeating-linear-gradient(90deg, #d6453c 0 9px, transparent 9px 18px);
    pointer-events: none;
}

/*
 * Print and PDF: the paper is the page. The build sizes @page to the deck's ratio, since a
 * size rule takes no var(); here the box loses its card dressing and the shell around it,
 * and each page breaks onto its own sheet. The page number and the overflow mark are
 * reading aids and stay off the print.
 */
@media print {
    .ainsi-page[data-overflow]::before { display: none; }
    body.ainsi { padding: 0; background: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .ainsi-page { width: 1280px; margin: 0; border-radius: 0; box-shadow: none; break-after: page; break-inside: avoid; }
    .ainsi-page:last-of-type { break-after: auto; }
    body[data-numbers="off"] .ainsi-number { display: none; }
}

/*
 * Reading view. A deck has two forms: a fixed-aspect page for projecting and printing, and
 * a fluid one for reading on whatever screen is to hand. Fit governs the first only. Scoped
 * to screen: chromium lays a print out on its default paper before @page resizes it, and a
 * narrow default paper would turn every printed page into a fluid one plus a spill sheet.
 */
@media screen and (max-width: 900px) {
    /* still cards: the page keeps its radius, ground and shadow, and only stops being 16:9 */
    body.ainsi { padding: .8rem; }
    .ainsi-page {
        aspect-ratio: auto;
        width: 100%;
        margin: 0 0 .8rem;
        font-size: clamp(15px, 4.4vw, var(--ainsi-size));
    }
    .ainsi-page main { padding: 9% 7%; min-height: 58vh; }
    /* the fluid page grows instead of clipping, so the cap only guards against a screenful */
    .ainsi-page img { max-height: 70vh; }
    .ainsi-page h1 { font-size: 2em; }
    .ainsi-page .ainsi-number { bottom: 1rem; left: 1.1rem; font-size: 11px; }
}
`;
