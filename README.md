# Ainsi

Write a deck in markdown. Get one self-contained HTML page: it presents full-screen, prints, exports to PDF and reads as a document on a phone. No database, no account, nothing to export from to get your work back out: the deck is a `.md` file and the result is an `.html` file.

The markdown says what a block is (a timeline, a comparison) and what shape a page takes, never what either looks like. A theme decides that, and a theme is a folder. Swapping it rebrands every deck you have ever written, untouched.

Pages are computed, not authored. Too much on a slide and the solver steps the type down within the range the theme allows, then splits at the natural seam. When it genuinely cannot fit, it tells you instead of quietly cropping.

    <!-- ainsi: timeline axis=horizontal -->     a run of blocks
    <!-- ainsi:layout header align=center -->    the page it sits on

Version 0.1. Under active development; commands and markup may change between commits.

## Install

Requires [Bun](https://bun.sh).

    git clone git@github.com:mikkokam/ainsi.git
    cd ainsi
    bun install --production          # 25 MB; plain `bun install` adds the browser wrapper, 38 MB
    bun link                          # puts `ainsi` on the PATH, globally

`--fit`, PDF and PPTX measure and print in a headless browser, which `--production` leaves out. To have them: `bun install` here, then `bunx playwright install chromium`, or point `AINSI_CHROMIUM=/path/to/chrome` at a browser already on the machine. Without a browser, a build says so and writes unfitted pages rather than failing.

## Use

    ainsi deck.md                     # opens the studio on the deck
    ainsi                             # opens the studio on the chooser: open a deck here, or make one

The studio is a browser page over your markdown file. Click a block to edit its text, right-click for what it is and what it can become, try a theme, export a PDF. Every change is written to the `.md` file, and any other editor or agent writing that file reloads the studio. The file name sits in the toolbar; type over it to rename. **Open deck…** in the menu browses the folder you started the studio in, folders and markdown only, and opening one is the same as having launched the studio on it. Nothing is written until you ask: `ainsi` on its own creates no file, and **New presentation** is what makes `untitled.md`.

`ainsi build` writes a file beside the deck and exits:

    ainsi build deck.md               # deck.html
    ainsi build deck.md --to pdf      # deck.pdf, fitted, one sheet per page
    ainsi build deck.md -o out.pdf    # the format follows the extension
    ainsi build deck.md --fit         # make the pages fit before writing html
    ainsi build deck.md --no-viewer   # no toolbar, for a headless render

`ainsi deck.md` with stdout piped refuses to start a server and prints the build command instead.

`samples/acme/acme.md` is a full deck to start from.

`theme: acme` in the frontmatter names a theme shipped here; `theme: ../themes/house` names one of yours, resolved beside the deck, so a deck and its theme move together and a private brand never has to live in this repo.

## In Claude Code

The repo is also a plugin: a skill that teaches an agent the deck grammar, the directives and the build loop. It calls the `ainsi` on your PATH, so install the tool first.

    claude plugin marketplace add mikkokam/ainsi
    claude plugin install ainsi@ainsi

Diagrams are the sibling repo, [ainsi-d2](https://github.com/mikkokam/ainsi-d2): house-style D2 with its own skill and an `ainsi-d2` command.

## Development

    bun install                       # the full tree, browser wrapper included
    bun test

The studio prints each rebuild's milliseconds by phase, and the browser console reports any commit round trip over 600 ms: write, rebuild, reload. `localStorage.setItem("ainsi:trace", "1")` reports every one, and `AINSI_TRACE=1` adds the server's side of the write.

`docs/ARCHITECTURE.md` is how it is built. `docs/FEATS.md` is what is not built. The core is plain TypeScript with no framework: one engine (parse, paginate, group, fit, render) and three consumers of it, the CLI, the player shipped inside every deck, and the studio served by the dev server. A theme is a token list under `themes/`, a component under `src/components/` ships its own CSS against those tokens, and the engine owns the page box.

## Licence

MIT, see [LICENSE](LICENSE). Mikko Kämäräinen, mikko@ukk0.com.
