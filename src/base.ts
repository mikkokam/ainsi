/**
 * Structure the engine owns: the page box, the flow inside it, and element defaults.
 * Every value that is a look rather than a mechanism comes from a token, so a theme
 * never restates it.
 */
export const BASE_CSS = `
* { box-sizing: border-box; }

body.pac {
    margin: 0;
    padding: calc(var(--pac-gap) * 2);
    background: var(--pac-shell);
    font-family: var(--pac-font);
    color: var(--pac-ink);
}

.pac-page {
    aspect-ratio: var(--pac-ratio, 16 / 9);
    width: min(1280px, 100%);
    margin: 0 auto calc(var(--pac-gap) * 2);
    background: var(--pac-ground);
    border-radius: var(--pac-radius);
    box-shadow: var(--pac-shadow);
    font-size: calc(var(--pac-size) * var(--pac-step, 1));
    line-height: var(--pac-leading);
    overflow: hidden;
    position: relative;
}

/*
 * Page number, in the scroll view only. It takes currentColor, so it reads correctly over a
 * header page's image without the layout having to say anything.
 */
body.pac:not([data-present]) .pac-page::after {
    content: attr(data-page);
    position: absolute; top: 1.4rem; right: 1.6rem;
    font: 500 12px/1 var(--pac-font-mono);
    color: currentColor; opacity: .45;
    pointer-events: none;
}

/*
 * The page inset lives on main, not on the page. A percentage resolves against the
 * containing block, and the page's is the body, which is wider than the page's own cap:
 * put it on the page and every layout that repositions it lands somewhere else.
 */
.pac-page main { height: 100%; padding: var(--pac-pad); }
.pac-page h1, .pac-page h2, .pac-page h3 { font-family: var(--pac-font-display); }
.pac-page h1 { font-size: 2.4em; line-height: 1.1; margin: 0 0 .4em; letter-spacing: -.02em; }
.pac-page h2 { font-size: 1.5em; margin: 0 0 .4em; }
.pac-page h3 { font-size: 1.1em; margin: 0 0 .4em; }
.pac-page p { margin: 0 0 .6em; }
.pac-page > *:last-child { margin-bottom: 0; }
.pac-page code { font-family: var(--pac-font-mono); }
.pac-page img { max-width: 100%; height: auto; display: block; }
.pac-page strong { font-weight: var(--pac-strong); }

/*
 * The fit solver ran out of ladder here and the page is clipped. Saying so beats hiding it,
 * and the mark belongs to the engine rather than a theme: it reports a build fact, it is not
 * a look a theme is allowed to have an opinion about. Reading view only, so a projected or
 * printed page carries no trace of it.
 */
body.pac:not([data-present]) .pac-page[data-overflow]::before {
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
    .pac-page[data-overflow]::before { display: none; }
    body.pac { padding: 0; background: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .pac-page { width: 1280px; margin: 0; border-radius: 0; box-shadow: none; break-after: page; break-inside: avoid; }
    .pac-page:last-of-type { break-after: auto; }
    body.pac:not([data-present]) .pac-page::after { display: none; }
}

/*
 * Reading view. A deck has two forms: a fixed-aspect page for projecting and printing, and
 * a fluid one for reading on whatever screen is to hand. Fit governs the first only. Scoped
 * to screen: chromium lays a print out on its default paper before @page resizes it, and a
 * narrow default paper would turn every printed page into a fluid one plus a spill sheet.
 */
@media screen and (max-width: 900px) {
    /* still cards: the page keeps its radius, ground and shadow, and only stops being 16:9 */
    body.pac { padding: .8rem; }
    .pac-page {
        aspect-ratio: auto;
        width: 100%;
        margin: 0 0 .8rem;
        font-size: clamp(15px, 4.4vw, var(--pac-size));
    }
    .pac-page main { padding: 9% 7%; min-height: 58vh; }
    .pac-page h1 { font-size: 2em; }
    body.pac:not([data-present]) .pac-page::after { top: 1rem; right: 1.1rem; font-size: 11px; }
}
`;
