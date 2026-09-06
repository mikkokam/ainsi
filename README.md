# Ainsi

Version 0.1. Under active development; commands and markup may change between commits.

Write a deck in markdown, get one self-contained HTML page: it presents full-screen, prints, exports to PDF and reads as a document on a phone. The markdown says what a block is (a timeline, a comparison) and what shape a page takes, never what either looks like. A theme decides that, and pages are computed, not authored: too much on a slide and the solver steps the type down, then splits at the natural seam.

    <!-- ainsi: timeline axis=horizontal -->     a run of blocks
    <!-- ainsi:layout header align=center -->    the page it sits on

## Install

Requires [Bun](https://bun.sh).

    git clone git@github.com:mikkokam/presentation-as-code.git
    cd presentation-as-code
    bun install
    bun link                          # puts `ainsi` on the PATH, globally

For `--fit` and PDF export, also `bunx playwright install chromium`, or point `AINSI_CHROMIUM=/path/to/chrome` at a browser already on the machine.

## Use

    ainsi deck.md                     # opens the studio on the deck
    ainsi                             # opens the studio on a new untitled.md here

The studio is a browser page over your markdown file. Click a block to edit its text, right-click for what it is and what it can become, try a theme, export a PDF. Every change is written to the `.md` file, and any other editor or agent writing that file reloads the studio. The file name sits in the toolbar; type over it to rename.

`ainsi build` writes a file beside the deck and exits:

    ainsi build deck.md               # deck.html
    ainsi build deck.md --to pdf      # deck.pdf, fitted, one sheet per page
    ainsi build deck.md -o out.pdf    # the format follows the extension
    ainsi build deck.md --fit         # make the pages fit before writing html
    ainsi build deck.md --no-viewer   # no toolbar, for a headless render

`ainsi deck.md` with stdout piped refuses to start a server and prints the build command instead.

`samples/acme/acme.md` is a full deck to start from.

## Development

    bun test

`docs/ARCHITECTURE.md` is how it is built. `docs/FEATS.md` is what is not built. The core is plain TypeScript with no framework: one engine (parse, paginate, group, fit, render) and three consumers of it, the CLI, the player shipped inside every deck, and the studio served by the dev server. A theme is a token list under `themes/`, a component under `src/components/` ships its own CSS against those tokens, and the engine owns the page box.
