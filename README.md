# Ainsi

Presentations in markdown, for agent-first work on local files, with a GUI for the last mile.

![The studio: a cover page open, its title selected, the block toolbar above it](docs/screenshots/studio.jpg)

## Demo - exported HTML player

Six decks, six themes, each built from the markdown beside it. They open in the browser: ⌘⏎ presents, ⌘G is the grid, and the same file reads as a document on a phone.

<table>
<tr>
<td width="33%" align="center"><a href="https://mikkokam.github.io/ainsi/samples/gatekeeper/gatekeeper.html"><img src="docs/screenshots/covers/gatekeeper.jpg" alt="The Acme Gatekeeper cover: a headline over a photograph of a meeting room"></a><br><a href="https://mikkokam.github.io/ainsi/samples/gatekeeper/gatekeeper.html"><b>Acme Gatekeeper</b></a><br><code>acme</code> · <a href="samples/gatekeeper/gatekeeper.md">source</a></td>
<td width="33%" align="center"><a href="https://mikkokam.github.io/ainsi/samples/kaari/kaari.html"><img src="docs/screenshots/covers/kaari.jpg" alt="The Studio Kaari cover: the studio name over a face in hard light"></a><br><a href="https://mikkokam.github.io/ainsi/samples/kaari/kaari.html"><b>Studio Kaari</b></a><br><code>portfolio</code> · <a href="samples/kaari/kaari.md">source</a></td>
<td width="33%" align="center"><a href="https://mikkokam.github.io/ainsi/samples/lehto/lehto.html"><img src="docs/screenshots/covers/lehto.jpg" alt="The Lehto and M&auml;nty cover: a workshop bench room in morning light"></a><br><a href="https://mikkokam.github.io/ainsi/samples/lehto/lehto.html"><b>Lehto &amp; M&auml;nty</b></a><br><code>default</code> · <a href="samples/lehto/lehto.md">source</a></td>
</tr>
<tr>
<td width="33%" align="center"><a href="https://mikkokam.github.io/ainsi/samples/boring-inc/boring-inc.html"><img src="docs/screenshots/covers/boring-inc.jpg" alt="The Boring Inc. cover: a title and a rule on white, the corporate template"></a><br><a href="https://mikkokam.github.io/ainsi/samples/boring-inc/boring-inc.html"><b>Boring Inc.</b></a><br><code>boring</code> · <a href="samples/boring-inc/boring-inc.md">source</a></td>
<td width="33%" align="center"><a href="https://mikkokam.github.io/ainsi/samples/aava/aava.html"><img src="docs/screenshots/covers/aava.jpg" alt="The Aava Ranta cover: a photographer's name on a black and white portrait"></a><br><a href="https://mikkokam.github.io/ainsi/samples/aava/aava.html"><b>Aava Ranta</b></a><br><code>darkroom</code> · <a href="samples/aava/aava.md">source</a></td>
<td width="33%" align="center"><a href="https://mikkokam.github.io/ainsi/samples/meridian/meridian.html"><img src="docs/screenshots/covers/meridian.jpg" alt="The Meridian cover: Helvetica across a black and white machine hall"></a><br><a href="https://mikkokam.github.io/ainsi/samples/meridian/meridian.html"><b>Meridian Instruments</b></a><br><code>swiss</code> · <a href="samples/meridian/meridian.md">source</a></td>
</tr>
</table>

A product pitch, a design studio's selected work, a furniture workshop, a quarterly operating review, a photographer's portfolio and a capital markets day. Acme Gatekeeper is the one to read first: seventeen pages and most of the components.

## Authoring

The loop: write `deck.md` with your agent in a folder on your machine, run `ainsi deck.md`, and a browser opens on the deck. Everything either of you does from then on lands in that one file. The agent rewrites a page while you are looking at it and the view reloads; you retype a line in the studio and the agent's next read sees it. There is no second copy of the document, so there is no split brain, nothing to sync and nothing to import. The same file opens in any markdown editor, and goes to anyone who has never heard of this tool.

## Powerpoint is a terrible tool for AI

That is the case for markdown over a slide format. A deck here is a few kilobytes of what you actually say. The same deck as a `.pptx` is a zip of XML in which the words are a small fraction of the bytes, the rest spacing, run properties and theme parts, so an agent asked to edit one *spends its context* on how a bullet is indented and loses the thread of the argument you needed the deck to make.

Keeping the deck in markdown keeps the context tight and the attention, yours and the agent's, on what is said.

## Export

When the deck has to leave your machine it leaves as a result, not as a project: one 
**self-contained HTML** page with the images embedded, which presents full-screen, prints and fits the screen on a phone; or a **PDF**; or an **editable PPTX** for whoever wants to carry on in PowerPoint (poor them).
Nothing runs but your machine, there is no service and no account, and the deck stays a `.md` file with an `.html` file beside it as an export, not the source.

## Layouts and components

The markdown says what a block is (a timeline, a comparison) and what shape a page takes. A theme decides the look, and a theme is a folder. Swapping it rebrands every deck you have ever written, untouched. One page of `samples/gatekeeper/gatekeeper.md`, unchanged, under two of the themes in this repo:

![Four figures with captions, set in a serif on warm paper](docs/screenshots/default.jpg)

![The same four figures in the corporate template: Arial, dark blue, hung from the top of the page](docs/screenshots/boring.jpg)

The figures are not merely recoloured: `boring` lowers `--ainsi-figures-max`, the cap the figures component sets its own display size against, so a figure reads as a number in a sentence rather than a headline. That is the whole of a theme's reach into a component. A theme may set the tokens a component publishes and it may style the page around it, but it may not select into its markup, and the build warns when a stylesheet tries.

**Flow**

Add `---` to split a page.

Optional `--fit` tries to flow pages automatically: Too much on a slide and the solver steps the type down within the range the theme allows, then splits at the natural seam. When it genuinely cannot fit, it tells you instead of quietly cropping.

    <!-- ainsi: timeline axis=horizontal -->     a run of blocks
    <!-- ainsi:layout header align=center -->    the page it sits on

## GUI

The last mile is visual, so there is a **studio**: a browser page over the same file, where you right click a block and change what it is, edit the text, try another theme. The agent writes what is said, you settle how it lands, and neither of you leaves the `.md`.

**Claude Code** is the first-class client. The repo ships as a plugin whose skill teaches the grammar and the build loop, so the agent produces a deck in the house look and argues with you about the **content** instead of the formatting.

Version 1.0.

## What this is instead of

**A hosted AI deck tool.** You pay, and the deck lives in their cloud. Your agent cannot open it, so the work splits in two: the thinking happens in your repo and the artefact happens in a browser tab, and the two diverge from the first edit. Export is a one-way door out of a place your tools could not reach anyway.

**PowerPoint.** The format is a zip of XML in which your words are a small fraction of the bytes. An agent asked to edit one converts in, converts out, and spends its context on run properties and spacing, which is time, tokens, and attention not spent on the argument. You still get a `.pptx` here, at the end, for whoever wants one.

**Marp, Slidev, reveal.js.** The nearest neighbours: markdown or HTML decks, local files, version control, no service. The differences are narrow and worth naming, and the following is from memory rather than from their docs today, so check before quoting it.

| | editing surface | PPTX out | a page that overflows |
| --- | --- | --- | --- |
| Marp | preview pane | slides as images | your problem |
| Slidev | dev server, editor pane | slides as images | your problem |
| reveal.js | none | none | your problem |
| ainsi | studio: click a block, change what it is | text stays text | measured, stepped down, then split |

The last column is the one that decides how a deck is written. Everywhere else, fitting is manual: you write, you look, you cut, you look again. Here the solver measures the real page and steps the type down within the range the theme allows before splitting at a seam, and says so when it cannot. The PPTX column is the other: exporting slides as pictures is a handoff nobody can continue, and text boxes over a rendered ground is one they can.

## Install

Requires [Bun](https://bun.sh).

    git clone git@github.com:mikkokam/ainsi.git
    cd ainsi
    bun install --production
    bun link                          # puts `ainsi` on the PATH, globally

`--fit`, PDF and PPTX measure in a headless browser, which `--production` leaves out; [Install](docs/guide/install.md) says how to give them one, and what a build does without it.

## Use

    ainsi deck.md                     # opens the studio on the deck
    ainsi                             # opens the studio on the chooser
    ainsi build deck.md               # writes deck.html and exits
    ainsi build deck.md --to pdf      # deck.pdf, fitted, one sheet per page

The studio is where you click a block to change what it is, edit the text, try a theme, and export. Presenting is ⌘⏎, in the studio and in a built deck alike. Every flag is in [the CLI](docs/guide/cli.md), every gesture in [the studio](docs/guide/studio.md).

`samples/gatekeeper/gatekeeper.md` is a full deck to start from.

## In Claude Code

    claude plugin marketplace add mikkokam/ainsi
    claude plugin install ainsi@ainsi

The plugin's skill teaches the agent the grammar and the build loop, and calls the `ainsi` on your PATH, so install the tool first. [Claude Code](docs/guide/claude-code.md) has the rest.

## What a page can be

Fourteen components, each a markdown list or table with a comment naming it, so the source stays readable as text: `agenda`, `alert`, `bar-table`, `boxes`, `columns`, `comparison`, `figures`, `full`, `matrix`, `prose`, `roadmap`, `striped-table`, `tiles`, `timeline`. A component decides how a run of blocks reads, never what colour it is. [What each one takes](docs/guide/components.md).

![A page split down the middle: text and an alert on the left, a photograph filling the right](docs/screenshots/split.jpg)

Four layouts decide the page around them: `default`, `header` for a title or a photo ground, `section` for a divider, `split` for text beside an image. [Themes add their own](docs/guide/themes.md#layouts).

![A field of four pictures, each drawn at its own aspect ratio rather than cropped to a grid, in a second theme](docs/screenshots/tiles.jpg)

The same component under a theme that asked for the opposite: `crop` trims every picture to one cell, and the theme's own layout takes the gutter to zero, so the field reads as a contact sheet rather than an index.

![A contact sheet in the darkroom theme: eight frames flush against each other on black, numbered underneath](docs/screenshots/darkroom.jpg)

## The guide

[docs](docs/README.md) is the reference: [writing a deck](docs/guide/writing.md), [components](docs/guide/components.md), [layouts](docs/guide/layouts.md), [frontmatter](docs/guide/frontmatter.md), [themes](docs/guide/themes.md).

## Development

    bun install                       # the full tree, browser wrapper included
    bun test
    bun run dev samples/aava/aava.md  # the studio in a browser, hot
    bun run app                       # the desktop app, built and launched
    bun run app:build                 # the same app as a .app and a .dmg

An installed app checks for its own update at launch and offers it in the studio, on the landing and in the deck's toolbar alike, with the same install behind the app menu's own item. It reads `stable-macos-arm64-update.json` from the latest GitHub release, so a release is `bun run app:build` and then the two files it wrote into `desktop/electrobun/artifacts/` — that manifest and the `.app.tar.zst` beside it — uploaded as assets, with the `.dmg` for a first install. A dev build reports updates as disabled and says nothing.

`dev` runs the studio under `bun --watch`. A deck edit and an edit to the studio's own css or script push a reload to the open page; an edit to the engine restarts the process, and the page reloads when it reconnects and finds the build has moved.

The studio prints each rebuild's milliseconds by phase, and the browser console reports any commit round trip over 600 ms: write, rebuild, reload. `localStorage.setItem("ainsi:trace", "1")` reports every one, and `AINSI_TRACE=1` adds the server's side of the write.

`docs/ARCHITECTURE.md` is how it is built. `docs/FEATS.md` is what is not built. The core is plain TypeScript with no framework: one engine (parse, paginate, group, fit, render) and three consumers of it, the CLI, the player shipped inside every deck, and the studio served by the dev server. A theme is a token list under `themes/`, a component under `src/components/` ships its own CSS against those tokens, and the engine owns the page box.

## Licence

MIT, see [LICENSE](LICENSE). Mikko Kämäräinen, mikko@ukk0.com.

The photographs in the sample decks are from [Unsplash](https://unsplash.com), used under the Unsplash Licence; each photo's id is in its url. The marks in them belong to invented companies.
