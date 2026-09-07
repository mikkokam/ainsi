---
name: ainsi
description: Write and build a presentation as markdown with ainsi — deck grammar, the component and layout directives, the build loop, and what the fit solver does with a page that overflows. Use whenever a deck, slides, a presentation or a pitch is asked for, and whenever an existing .md deck is edited.
allowed-tools: Read, Write, Edit, Bash
---

# Ainsi decks

A deck is one markdown file. The markdown says what a block is, a timeline, a comparison, an agenda, and what shape the page takes; a theme decides what any of it looks like. Pages are computed rather than authored: too much on a page and the solver steps the type down, then splits at the natural seam.

Write the deck, build it, open the HTML. A deck that has not been built has not been checked.

## Building

```
ainsi build deck.md                 # deck.html beside the deck
ainsi build deck.md --to pdf        # deck.pdf, fitted, one sheet per page
ainsi build deck.md --fit           # measure and fit before writing the html
ainsi build deck.md --no-viewer     # no toolbar, for a headless render
```

`ainsi` has to be on the PATH: the tool is a Bun package, cloned and `bun link`ed once, not something this skill carries. If the command is missing, say so and point at the README rather than working around it.

`build` writes a file and exits: that is the agent's surface. The bare `ainsi deck.md` opens the studio, a browser editor over the same file, and refuses to start when stdout is not a terminal. PPTX export lives in the studio only, not behind a build flag.

Warnings go to stderr as `warn: ...` lines and are the first thing to read after a build. An unknown component, a directive that names nothing, an image or logo missing beside the deck, a page the solver could not fit: each is one line, and the build still writes a file.

`--fit` and PDF need a real browser, because overflow is a layout fact and nothing short of measuring it will do: `bunx playwright install chromium`, or point `AINSI_CHROMIUM` at a browser already on the machine. Without one the build degrades to a diagnostic and unfitted pages, never an error.

## The file

Frontmatter is the deck's settings, and every key is optional:

```
---
theme: acme              # a name is a theme shipped here; a path is one of your own
ratio: 16:9              # the page box, and the paper a PDF prints on
layout: default          # the deck's house layout; a page directive overrides it for one page
h1StartsPage: false      # when true, every `# heading` opens a page
numbers: true            # page numbers everywhere but the cover; `off` hides them
logo: assets/mark.svg    # a path beside the deck or a url; the theme places it
coverLogo: assets/a.png  # what the cover wears instead, when a brand has two marks
---
```

A theme name with a slash or a leading dot is a folder of the deck's own, resolved beside the deck the way its images are: `theme: ../themes/house` reads `themes/house` next to the deck's directory. The default theme's tokens sit under every theme, so a private one declares only what it changes.

`---` on its own line breaks the page. That is the only page break: nothing else in the markdown starts one unless `h1StartsPage` is on.

## Directives

```
<!-- ainsi: timeline axis=horizontal -->
<!-- ainsi:layout split side=right -->
```

A component directive claims the run of blocks that follows it and stops where the next directive or a page break begins. A layout directive sets the page it sits on, for that page only. A bare token is `true`, so `caps` means `caps=true`, and a value with spaces takes quotes: `x="two words"`.

`<!-- ainsi: end -->` closes a span early, for the case where the run would otherwise swallow the block after it.

Everything without a directive falls to the heuristics. A blockquote opening with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` becomes an alert. A paragraph holding nothing but an image becomes `full`. Everything else is absorbed into one `prose` block, which is why a page of ordinary markdown does not come out as one block per paragraph.

## Components

Six of them take a list, one item per row, and read a leading `**bold**` run as that item's title. `agenda` is the contents page, one row per item, keeping its numerals if the list is numbered. `boxes` gives one card per item, `stretch` to fill the height. `columns` is the same without the cards. `figures` makes the bold run the figure and the rest its caption. `timeline` walks the items as steps, `axis=horizontal` or `vertical`. `matrix` takes exactly four items as a two-by-two from the top left, with `x` and `y` naming the axes.

`tiles` is a field of them: pictures, text, or both. `flow=grid`, the default, keeps the columns aligned and every row the same height; `flow=masonry` lets the browser pack the columns, so the tiles differ in height and the field reads down each column rather than across, which suits pictures and not prose. `columns` overrides the count's own answer, which is one, two or three as themselves, four as a square, then threes and fours. An item that is an image takes the text beside it as its caption, `- ![](x.jpg) Nocturne, 2025`, or its alt text when there is nothing beside it.

Pictures keep their proportions and are never cropped unless `crop` says so, so a field of mixed orientations leaves space beside the narrow ones rather than trimming their edges; `crop` trades that back for a flush grid of identical cells. Heights are capped by the row count so a field cannot run off the page, in em, so the fit solver's type step takes the pictures down with everything else.

`comparison` takes a table: the header names the columns, the first column labels the rows, and every further column becomes a panel.

`striped-table` is the markdown table with a band behind every other row, which is what a table of numbers wants once it is more than three rows deep. It takes no props.

`bar-table` takes the same table and draws a bar behind the values of every numeric column, scaled to that column's largest. A column counts as numeric when most of its cells parse, and a cell parses when it starts with a number, so `5`, `5 tok/s`, `18%` and `€2 400` all measure while `unmetered` stays text. Numeric columns take the width and the rest stay as narrow as their text.

`roadmap` reads a table as a plan: the header names the periods, the first column names the rows, an empty cell is empty and a cell with anything in it becomes a filled block. A cell holding only a mark (`x`, `-`, `*`) carries no text; anything else is a label inside the block. Filled cells that touch join into one bar.

`full` is an image filling its slot, `size=s|m|l|full` and `align=left|center|right`. Under the header layout it becomes the page's ground.

`prose` is markdown as written and accepts anything, with `size=small|normal|large|huge`, `align`, `caps`, and `color=ink|soft|accent`.

`alert` is the callout blockquote and takes no props.

A component that does not accept what follows it warns and falls back to the heuristic rather than failing the build, so check the warnings when a block comes out looking like plain prose.

## Layouts

`default` places the blocks in the page box, with an optional `tone` of `accent`, `inverse` or `soft`. `header` is the cover: `align=start|center|end`, and an image on the page becomes the ground behind the text. `section` is the divider between parts, `tone=ground|accent|inverse|soft`. `split` puts the page in two, `side=left|right` and `size=third|half|two-thirds|image`.

## Inline

`==words==` is a highlight, the one inline mark markdown never got, and `<mark>` written by hand means the same thing. Everything else is ordinary GitHub-flavoured markdown: tables, task lists, footnotes, `<kbd>`.

## Fitting

A page that overflows steps its type down within the range the theme allows, then splits at a block boundary, then splits inside a block that declares itself splittable, which is `prose` and `agenda` only. A page that exhausts all of that renders overflowing and says so in a warning rather than clipping silently.

The lever a deck has over this is content: fewer items, shorter titles, an earlier `---`. Never a font size, and never CSS in the deck.

## Diagrams

Pictures come from `ainsi-d2`, not from the deck: write the `.d2`, build the PNG beside the deck, reference it as an ordinary image. The d2 skill carries that grammar.

## What a deck never contains

No CSS, no inline styles, no positions, no font sizes, no colours. A deck that needs a look the theme does not give needs a theme change, which is a folder under `themes/`, not a slide-level exception. Rebranding is swapping that folder, and every deck re-renders in the new look untouched: an inline style is the one thing that survives the swap and it survives it wrong.
