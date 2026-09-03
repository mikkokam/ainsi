# presentation-as-code

Markdown is the content. It may say what a block is and what shape a page takes, never what either looks like. A theme decides that, and positions are derived rather than authored.

Existing tooling fails one of two ways: it conflates content and presentation, so restyling means editing the content, or it needs manual layout, so the content forks inside the presentation layer. The split here is form selection in the content, style in the theme, layout in a solver.

Status: design only. `docs/DATA-MODEL.md` is the substance. `docs/FEATS.md` is what is not built.

    content.md ──parse──▶ Entity[] + Directive[] ──group──▶ Block[] ──fit──▶ Page[] ──render──▶ html

    <!-- pac: timeline axis=horizontal -->     a run of blocks
    <!-- pac:layout header align=center -->    the page it sits on

Two things it must do that bespoke per-deck HTML cannot: change the content of an old deck and rerender it, and restyle every deck at once. If neither is needed, this is not worth building.

    bun install
    bun test
    bun run src/cli.ts samples/acme.md              # writes samples/acme.html
    bun run src/cli.ts samples/acme.md --watch      # rebuilds and reloads the browser
    bun run src/cli.ts samples/acme.md --no-viewer  # no toolbar, for a headless render
    bun run src/cli.ts samples/acme.md --fit         # split pages that overflow (needs `bunx playwright install chromium`)

The core is plain TypeScript with no framework. A theme is a token list, a component ships its own CSS written against those tokens, and the engine owns the page box. A component returns an HTML string and may ship its own `css` and `script`; the engine emits those once per deck and marks each root with `data-pac="<name>"`, so interactivity is islands and a component may use any framework inside itself without the engine gaining one.
