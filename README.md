# presentation-as-code

Markdown is the content. It may say what a block is and what shape a page takes, never what either looks like. A theme decides that, and positions are derived rather than authored.

Existing tooling fails one of two ways: it conflates content and presentation, so restyling means editing the content, or it needs manual layout, so the content forks inside the presentation layer. The split here is form selection in the content, style in the theme, layout in a solver.

Status: design only. `docs/DATA-MODEL.md` is the substance. `docs/FEATS.md` is what is not built.

    content.md ──parse──▶ Entity[] + Directive[] ──group──▶ Block[] ──fit──▶ Page[] ──render──▶ html

    <!-- pac: timeline axis=horizontal -->     a run of blocks
    <!-- pac:layout header align=center -->    the page it sits on

Two things it must do that bespoke per-deck HTML cannot: change the content of an old deck and rerender it, and restyle every deck at once. If neither is needed, this is not worth building.

    bun install
    bun link                          # puts `pac` on the PATH
    bun test
    pac samples/acme.md               # writes samples/acme.html
    pac samples/acme.md --watch       # serves, rebuilds and reloads the browser
    pac samples/acme.md --no-viewer   # no toolbar, for a headless render
    pac samples/acme.md --fit         # make the pages fit (needs `bunx playwright install chromium`)
    pac samples/acme.md --pdf         # also writes samples/acme.pdf, fitted, one sheet per page

`--fit` measures every page in a real browser and, while one overflows, steps its type down
within the range the theme allows, then splits it at a block boundary, then inside a component
that says it may be split. A page that exhausts all of that is rendered clipped, marked, and
reported rather than losing content in silence. `PAC_CHROMIUM=/path/to/chrome` uses a browser
already on the machine instead of playwright's own copy.

The core is plain TypeScript with no framework. A theme is a token list, a component ships its own CSS written against those tokens, and the engine owns the page box. A component returns an HTML string and may ship its own `css` and `script`; the engine emits those once per deck and marks each root with `data-pac="<name>"`, so interactivity is islands and a component may use any framework inside itself without the engine gaining one.
