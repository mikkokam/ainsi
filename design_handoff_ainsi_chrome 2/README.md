# Handoff: Ainsi chrome — landing, editor shell, design system

## Overview

A dark, minimal application shell for **Ainsi Studio** (the markdown deck editor) and
**Ainsi Stage** (the player). Covers three things:

1. The **landing page** both apps show when opened without a file — theme shelf, recent decks,
   Open/New, and a keyboard model that makes the whole page operable without a mouse.
2. The **editor chrome** once a deck is open — floating nav, block toolbar, block rail,
   status pills, and the per-page source sheet.
3. The **design system** the whole shell is built from — colour roles, two-face type rule,
   4pt space, radii, and every button variant across rest / hover / focus / disabled.

Target repo: `mikkokam/ainsi` @ `main`. The core is plain TypeScript, no framework:
`src/studio/style.css` + `src/studio/script.ts` for the studio, `src/viewer/*` for the player,
`src/studio/start.html` for the current chooser page.

## About the design files

`Ainsi Landing.dc.html` in this bundle is a **design reference created in HTML** — a prototype
showing intended look and behaviour. It is not production code to copy. It uses a React-flavoured
component runtime for the prototype canvas; **none of that belongs in the repo**.

The task is to recreate these designs in Ainsi's existing environment: plain TypeScript, plain
CSS, no framework, no build-step components. Everything here maps onto ordinary CSS custom
properties and DOM. `chrome-tokens.css` in this bundle is the one file meant to be used
directly — drop it in as `src/chrome/tokens.css`.

Open the HTML in a browser: the design canvas stacks four turns, newest at the top. Each option
carries a badge id (`4a`, `3b`, …) used throughout this document.

## Fidelity

**High-fidelity.** Colours, type, spacing, radii and states are final and exact. Recreate them
faithfully. Two things are deliberately placeholder:

- The photographic grounds in `3b` / `3d` are striped placeholders standing in for a deck's
  cover image.
- The theme tiles and deck covers are miniature renderings driven by each theme's real
  `--ainsi-*` tokens, not screenshots. In the real app they should be real rendered page one
  thumbnails, at the same sizes.

---

## Corrections after first build (read this first)

Four faults found once the shell was running against real decks. The first three were mine —
wrong or under-specified tokens — and all four are now fixed in `chrome-tokens.css` and shown
in turn **5** of the design file.

**1. `chrome-tokens.css` had a comment-termination bug.** The header comment contained the
literal `themes/*/variables.css`, whose `*/` closed the comment four lines early; the remaining
prose then parsed as stray CSS and the parser discarded the entire `:root` block as error
recovery. Every `--ac-*` was undefined, `font: var(--ac-text-body)` reset to Times 16px, and
`border-radius: var(--ac-r-button)` reset to 0. Fixed to `themes/<name>/variables.css`. If you
edit the token file, never write `*/` inside a comment.

**2. One glass recipe was not enough.** `--ac-glass` at 72% was specified against the app's own
dark ground and then applied to chrome floating over decks. Backdrop blur averages what is
behind it, so over white paper the pill lifts to pale grey and over a saturated cover it goes
brown; `--ac-ink-3` text on it fails badly. There are now two recipes, and choosing the wrong
one is a contrast bug:

| | over our own ground | over deck content |
| --- | --- | --- |
| Where | landing titlebar only | nav pill, block toolbar, menu, block rail, status pills |
| Background | `rgb(24 24 28 / 72%)` | `rgb(16 16 20 / 90%)` (menus `94%`) |
| Filter | `blur(24px) saturate(180%)` | `blur(20px) saturate(140%) brightness(.55)` |
| Border | none | `1px solid rgb(255 255 255 / 14%)` |
| Shadow | none | `0 6px 24px rgb(0 0 0 / 35%)` (menus `0 18px 60px / 60%`) |
| Icons at rest | `#A8A8B0` | `--ac-ink-on-content` `#E8E8EC` |
| Labels | `--ac-ink-3` `#8A8A92` | `--ac-ink-on-content-2` `#D6D6DC` |
| Group labels | `--ac-ink-3` | `--ac-ink-on-content-3` `#A8A8B0` — the floor |

`--ac-ink-3` is **not permitted** over deck content.

**3. Bar controls must share one box, and rings follow the shape.** See "Block toolbar" below —
every control `30 × 30` at radius `8`; active state is an **inset** ring so the row cannot shift;
a colour swatch keeps its own fill and takes a **concentric** ring on the circle itself, because
`box-shadow` follows `border-radius` and a ring drawn on a square wrapper comes out a squircle.

**4. Traffic lights are the OS's, not ours.** The Electrobun window is a normal framed window,
so macOS already draws them above the webview; the HTML set in the earlier mocks was a dead
second copy. Removed, along with the divider beside them; the right-hand spacer drops from
`96px` to `58px` to keep the titlebar centre optically centred against two icon buttons. Ignore
the painted traffic lights in turns 2–4 of the design file.

---

## Design tokens

Use `chrome-tokens.css` verbatim. Key decisions it encodes, and why:

**Prefix is `--ac-*`, not `--ainsi-*`.** `--ainsi-*` is the deck theme contract
(`themes/*/variables.css`, `src/tokens.ts`). The chrome must not be reachable from a theme, and
a theme must not be restyleable by the chrome. Separate namespace, enforced by convention.

**Dark only.** The previous chooser (`src/studio/start.html`) had a `prefers-color-scheme` light
variant. Drop it. One shell, always dark, because the content — someone else's brand, usually on
white — has to be the brightest thing on screen. The single light surface is the source editor,
which is a document rather than chrome and has its own `--ac-paper-*` set.

**One blue, three roles.** `#4C8DF6` bright (focus/selection/active on dark), `#8AB4F8` ink
(links and labels on dark), `#1F6FEB` solid (filled action on the light source sheet). The
existing `#1f6feb` reads muddy against `#0D0D10`, which is why the dark-surface role is lighter.
Blue means exactly one thing: *this is where you are*.

**Text colour floor is `--ac-ink-3` (#8A8A92)**, 5.67:1 on `--ac-ground`. Anything dimmer
(`#6C6C74` and below) is for borders, separators and disabled states only. This matters most on
the keyboard-hint row, which is small text and easy to under-contrast.

**Two faces, and the split carries meaning.** System grotesque for anything a person reads as
language; mono for anything a machine would accept as input — paths, filenames, shortcuts,
theme ids, markdown. That single rule is what makes the agent-first premise legible without
marketing copy.

---

## Naming and identity

**One law: the lowercase belongs to the mark and the terminal, nowhere else.**

| Context | Written as |
| --- | --- |
| Prose, UI labels, menus, window titles | `Ainsi`, `Ainsi Studio`, `Ainsi Stage` |
| Command line, package ids, frontmatter, HTML comments, CSS tokens | `ainsi deck.md`, `ainsi@ainsi`, `theme: swiss`, `<!-- ainsi: agenda -->`, `--ainsi-accent` |
| Never | `AINSI STUDIO` (shouts, dates the product) |
| Never | lowercase `ainsi` starting a sentence in prose |

This needs a fix in the repo: `src/studio/start.html` currently renders `<h1>Ainsi STUDIO</h1>`.
It should be `Ainsi Studio` — or, per `4b`, the wordmark SVG followed by a hairline and the word
`Studio`.

**Assets** (in `assets/` in this bundle, also `desktop/icon.png` in the repo):

- `ainsi-logo.svg` — wordmark, 226×81, white fills.
- `ainsi-mark.svg` — mark, 73×73, white fills.
- Clear space equals the dot in the mark. Never render below 20px.
- Both files are white-only. On any light surface (print, the source sheet, the README) the mark
  sits in a dark tile — `--ac-ground`, `--ac-r-button` radius. **A black-fill export of both is
  still missing and should be produced.**
- The wordmark appears once per screen, never twice. The titlebar gets the 15px mark at 75%
  opacity, not the wordmark.

---

## Screens

### 1. Landing — Ainsi Studio (`3c`, header per `4b`)

**Purpose.** What Studio shows when launched with no file argument. Replaces
`src/studio/start.html`. Start a deck from a theme, reopen a recent one, or browse.

**Layout.** One column, `--ac-ground`. Titlebar (see below), then four stacked regions with
`56px` page margin left and right:

| Region | Padding | Content |
| --- | --- | --- |
| Story | `60px 56px 44px` | wordmark row, h1, lede on the left (`max-width: 660px`); action stack on the right (`width: 300px`, bottom-aligned) |
| Theme shelf | `0 56px` | section head + horizontal scroller |
| Recent | `34px 56px 0`, `flex: 1` | section head + 3-column grid |
| Footer | `34px 56px 0`, `border-top: 1px solid --ac-hairline` | status line left, shortcut hints right |

The story region carries `radial-gradient(120% 140% at 10% 0%, rgb(76 141 246 / 14%), transparent 58%)` —
the only gradient anywhere in the chrome.

**Story block.**
- Wordmark `assets/ainsi-logo.svg` at `height: 30px`, then a `1px × 20px` `--ac-hairline-strong`
  divider, then `Studio` in `500 15px --ac-font`, `--ac-ink-2`, `-.01em`.
- h1: `--ac-text-display`, `--ac-ink`, `letter-spacing: -.03em`, `text-wrap: pretty`.
  Copy, verbatim, two lines with a `<br>`:
  *"A deck is a markdown file. / Your agent already has it open."*
- Lede: `--ac-text-body`, `--ac-ink-2`, `max-width: 520px`.
  *"No import, no cloud copy, no second document. The agent writes what is said; you settle how it lands. Export happens once, at the end."*

**Action stack** (`width: 300px`, `gap: 10px`). Both buttons are permanent — they do not collapse
once recents exist.
- Primary `Open a deck…` + `⌘O` hint at `opacity .5`. `--ac-h-page-action`, `--ac-r-button`,
  background `#F2F2F5`, text `#111114`, `--ac-text-cta`. Hover `#FFF`.
- Secondary `New deck` + `⌘N`. Same height/radius, `1px solid rgb(255 255 255 / 14%)`, text
  `#E6E6EA`, weight 500. Hover: border `24%`, fill `rgb(255 255 255 / 7%)`.
- Status line: `6px` `--ac-ok` dot, then *"Claude Code skills active · manage"*, `--ac-text-meta`,
  `--ac-ink-3`, link in `--ac-blue-ink`. When the plugin is absent this becomes an amber dot and
  *"Add the Ainsi skills"* linking to the marketplace command.

**Theme shelf.** `display: flex; gap: 12px; overflow-x: auto; scrollbar-width: none;` with
`-webkit-mask-image: linear-gradient(90deg, #000 94%, transparent)` to fade the cut edge.
It must actually scroll — there are more than eight themes.

Tile: `width: 190px`, `padding: 3px` (so the focus ring has room), `--ac-r-card`.
- Preview: `height: 107px`, `--ac-r-control`, `1px solid --ac-hairline-strong`, background =
  theme's `--ainsi-ground`. Inside, `14px 15px` padding: `Aa` at `700 17px` in the theme's
  `--ainsi-font-display` and `--ainsi-ink`; a `2px × 38px` bar in `--ainsi-accent`; three
  `3px` rules at 100% / 78% / 56% width in `--ainsi-rule`.
  **In production, render page one of a real deck in that theme instead.**
- Caption row: name in `500 12.5px` `--ac-ink-2`; on the right the source in
  `--ac-text-key` `--ac-ink-3` — `shipped`, `../brand`, `local`, `folder`.
- Last tile is `New theme…` / *"copy a folder, edit"*, greyed preview.

Shipped themes and their real token values are in `themes/*/variables.css`; the prototype's
`themes` array in the logic class mirrors them exactly and can be used as a check.

**Recent grid.** `repeat(3, minmax(0, 1fr))`, `gap: 14px`. Card: `--ac-r-card`,
`1px solid --ac-hairline`, background `rgb(255 255 255 / 3%)`.
- Cover strip `height: 104px`, deck's theme ground, `border-bottom: 1px solid rgb(255 255 255 / 8%)`.
  Title at `700 15px` in the theme's display face and ink; `2px × 30px` accent bar under it.
  Again: real page-one thumbnail in production.
- Pin at top-right, `12px` glyph — `--ac-blue-ink` when pinned, `rgb(255 255 255 / 35%)` when not.
- Quick play at bottom-right: `28px` circle, `rgb(10 10 12 / 55%)` + `blur(10px)`, white triangle.
- Body `11px 14px 13px`: full path in `--ac-text-mono` `--ac-ink-3`, ellipsised; then a meta row
  — relative time · page count · theme id (theme id in mono `10.5px`) — separated by `·` in
  `#4A4A52`.

Six is the right number of recents; do not paginate.

**Footer.** Left: status line, `--ac-text-meta`, `--ac-ink-3`, turning `--ac-blue-ink` when it
reports an action. Right: `↑↓ zone`, `←→ pick`, `⏎ go`, `⌘O browse`, `⌘N new` in
`--ac-text-key`, `--ac-ink-3`, `gap: 15px`. These hints are load-bearing, not decoration — they
are how the keyboard model is discovered.

### 2. Landing — Ainsi Stage (`2b`, `2c`)

**Identical shell.** Same titlebar, same regions, same footer, same grid. Differences only:

- Titlebar has the Open icon, no New icon.
- Story: *"Open a deck. / Present it."* Lede: *"Stage plays what Studio makes — a `.md` or the
  exported HTML beside it. Editing, themes and export live in Studio."*
- One button, `Open a deck…`. Under it, plain text: *"Or drop a file anywhere on this window."*
- **No theme shelf, no New.** The recent grid takes the freed space: cover strip grows to
  `150px`, title to `700 21px`, accent bar above the title rather than below.
- Section head is `Recently presented`. No theme id in the meta row.
- Footer hints: `←→ pick`, `⏎ play`, `⌘O browse`, `⌘G grid`.
- Empty first launch (`2c`): the recent grid is replaced by a flex-filling
  `1px dashed rgb(255 255 255 / 13%)`, `--ac-r-panel` drop zone — *"Drop a deck here"* over
  `deck.md · deck.html` in mono. Studio never shows an empty state; it always has themes and New.

### 3. Titlebar (`3c`, `4b`) — Electrobun

Height ~44px, `--ac-glass` + `--ac-glass-filter`, `border-bottom: 1px solid rgb(255 255 255 / 7%)`.
Left to right: traffic lights (14px gap), `1px × 16px` `--ac-hairline` divider, icon buttons,
flexible centre with the 15px mark at `.75` opacity + app name in `500 12px` `--ac-ink-3`, and a
`96px` spacer on the right so the centre stays optically centred.

Icon buttons are `28 × 26`, `--ac-r-icon`, stroke icons at `15px`, `stroke-width: 1.7`, colour
`#A8A8B0`; hover fills `--ac-hover` and lifts to `#F2F2F5`. Studio: open folder, new file.
Stage: open folder only. Tooltips carry the shortcut (`Open a deck  ⌘O`).

**These are the same commands as the big buttons and the File menu, not alternatives.** Wire all
three to one command bus — the current `document.dispatchEvent(new CustomEvent("ainsi:command", …))`
pattern in `start.html` already does this; extend it to `open` and `new` from both surfaces.

The goal is that the native titlebar absorbs every global action so no persistent chrome sits on
the page. If Electrobun cannot host controls in the titlebar, the fallback is the same bar drawn
in HTML as the first row of the window, identical metrics.

### 4b. The deck menu (`5b`)

Opened from the first icon in the nav pill. **Dark, not white** — a light popover on a dark
shell reads as a dialog from another application.

- `width: 288px`, `--ac-r-card`, `--ac-menu-over-content` + the over-content filter, hairline
  and `--ac-menu-shadow`. Left edge and radius align to the nav pill it hangs from, `8px` below.
- Two groups separated by a `1px` `rgb(255 255 255 / 10%)` rule, `6px` padding around each.
- Group headers are section labels in `500 11px`, `--ac-ink-on-content-3`, `.09em`, uppercase:
  `Deck`, `Pages`. **Not the app name** — that lives in the titlebar and appears once per screen.
  The `Deck` header carries `portfolio · 10 pages` on the right in mono.
- Rows are `--ac-h-menu-row` (32), radius `8`, `0 10px`, `400 13px`, `--ac-ink-on-content`;
  shortcut or value right-aligned in `--ac-text-key`, `--ac-ink-on-content-3`. Hover fills
  `--ac-hover` and lifts text to `#FFF`.
- Deck group: `Edit source ⌥⌘E` · `Open deck… ⌘O` · `Deck settings…` · `Theme… portfolio` ·
  `Export… ⇧⌘E`.
- Pages group scrolls at `max-height: 322px`, so the deck actions never leave the screen.
  Row is a right-aligned `16px` mono number plus an ellipsised title. The current page is a
  blue wash with an inset ring — **not** bold text, which is invisible at a glance and cannot
  be seen at all on the row you are already reading.

### 5. Editor chrome, deck open (`3b`, corrected by `5a` / `5c`)

Full-bleed deck page, chrome floating over it. **All chrome is dark glass** — the current white
block toolbar (`src/studio/style.css`, `.ainsi-studio__bar`) makes the toolbar the brightest
object on a dark photo page and pulls the eye off the content. Dark glass recedes and lets the
blue accent survive.

- **Nav pill**, top-left `20px / 18px`: `--ac-glass`, `--ac-r-panel`, `padding: 5px 6px`. Three
  `30 × 28` icon buttons (menu, grid, present), a divider, then the filename in
  `--ac-text-mono` `--ac-ink-3`. This replaces the current `.ainsi-toolbar`.
- **Right cluster**, same y: `Edit source` (`</>` icon, label, `⌥⌘E` in mono) and `Export…`,
  both `--ac-h-toolbar` glass pills, `--ac-r-control`.
- **Block rail**, at the hovered block's top-left: two stacked `26px` glass squares
  (`--ac-r-icon`, `1px solid rgb(255 255 255 / 14%)`) — grip and add-below. Hover turns icon and
  border `--ac-blue`. Replaces `.ainsi-studio__grip`'s white chip.
- **Selected block**: `--ac-focus`, `border-radius: 4px`. Hovered but unselected keeps today's
  `1.5px dashed rgb(80 140 255 / 70%)` at `outline-offset: 3px`.
- **Block toolbar**, floating above the selected block: `--ac-glass-over-content`,
  `--ac-r-card` (12), `padding: 5px 6px`, `gap: 3px`, shadow `0 8px 28px rgb(0 0 0 / 40%)`.

  **Geometry, exactly.** Every control — icon button, size toggle, align toggle, caps toggle,
  and the block-type dropdown — is `30 × 30` at radius `8`; the dropdown is 30 high with
  `0 8px 0 10px` padding and keeps the same radius. Icons draw at `15px`. Dividers are
  `1px × 18px` `rgb(255 255 255 / 16%)` with `5px` margins either side. Group labels
  (`size`, `align`, `caps`, `colour`) are `--ac-text-key` in `--ac-ink-on-content-3` with
  `0 5px` padding. Nothing in the bar may be a different height from its neighbour.

  **Active state, one recipe:** `background: --ac-blue-wash; box-shadow: inset 0 0 0 1px
  --ac-blue-edge; color: --ac-blue-glyph (#BCD6FC)`. Inset, so an active control occupies the
  same box as an inactive one and the row cannot shift as you toggle. Never the outer
  `--ac-focus` ring inside a bar — it collides with the neighbouring controls.

  **Colour swatches** are `18px` circles, `gap: 9px`. Selected keeps its own fill and takes
  `box-shadow: 0 0 0 1px rgb(255 255 255 / 25%), 0 0 0 3px var(--ac-blue)` **on the circle
  itself**. Putting the ring on a square wrapper is what produces the rounded-square in the
  current build.

  **Order, left to right:** type dropdown · | · paragraph · bulleted · numbered · quote · alert ·
  code · | · `size` S M L XL · | · `align` left centre right · | · `caps` AB · | · `colour` three
  swatches · | · move up · move down · delete. **Move up and move down are a pair** — shipping
  only "down" leaves no way back. Delete is the single destructive control: `--ac-danger` at
  rest, `--ac-danger-ink` on a `rgb(224 139 132 / 16%)` hover fill.

  **Icons:** lucide shapes, `24` viewBox, `stroke-width: 1.7` (`1.8` for the align trio only —
  three parallel lines read thin beside a glyph), round caps and joins, no fills. The type
  glyph is lucide `type`, not a serif "A"; the paragraph toggle is `¶`; code is `chevrons`.
- **Status pills**, bottom corners, `--ac-r-pill` glass, `--ac-text-key`:
  left `page 1 / 9` (in `--ac-ink-2`) then `⌘⏎ present`, `⌘G grid`, `⌥⌘E source`;
  right an `--ac-ok` dot + `saved · 14 ms`. The commit timing is already measured by the studio;
  surface it here rather than only in the console.

### 6. Source editing (`3d`)

**Per-page source is a sheet, not a takeover.** Deck stays visible behind a
`rgb(6 6 8 / 55%)` + `blur(6px)` scrim. Sheet: `width: 820px`, centred, `--ac-r-panel`,
`--ac-paper` ground, `--ac-shadow-sheet`.

- Bar: `meridian.md · page 2` in `--ac-text-mono` `--ac-paper-ink-3`; right `Cancel` (hairline,
  `--ac-paper-line`) and `Save` + `⌘S` (`--ac-blue-solid`, white text). `--ac-h-toolbar`.
- Body: `26px 30px 34px`, `400 13px/1.75 --ac-mono`, `--ac-paper-ink`. `<!-- ainsi: … -->`
  comments in `--ac-paper-comment`.
- Foot bar: `--ac-paper` tinted `#F7F7FA`, left *"editing one page · the file keeps the rest"*,
  right `⌘S save`, `esc cancel`, `⇧⌘E whole file`.
- `⇧⌘E` — whole-file source — keeps today's full-window behaviour
  (`.ainsi-studio__raw`), restyled to these paper tokens.

---

## Interactions and behaviour

### Keyboard model (the important one)

The landing must be fully operable with no mouse. This is an accessibility requirement, not a
power-user affordance. Focus **starts on `Open a deck…`** when the window opens, so ⏎ alone
browses.

Four zones, in this order: `open` → `new` → `themes` → `recents`.

| Key | Effect |
| --- | --- |
| `↓` / `↑` | move between zones; the ring moves to that zone's current item |
| `→` / `←` | move within `themes` (tile index) or `recents` (card index); no-op in `open` / `new` |
| `⏎` | activate: open dialog · new deck in default theme · new deck in the highlighted theme · open the highlighted deck |
| `⌘O` / `⌘N` | always available, regardless of focus |
| `⌘⏎` | present the highlighted deck without opening the editor |
| `Tab` | standard DOM order — every zone item is a real focusable control |

Every focusable thing takes the same `--ac-focus` ring, so keyboard position is one shape to
learn. `:focus-visible`, not `:focus` — a mouse click must not draw the ring. Arrow keys inside
a zone should follow the roving-tabindex pattern (one tab stop per zone, arrows move
`tabindex="0"` within it) so `Tab` does not walk through nine theme tiles.

The footer status line narrates what `⏎` would do — implemented in the prototype, worth keeping;
it is how the model is learned.

Open question left for you: whether `/` or `⌘K` should open a palette over the landing, which
would make the arrows optional. Not designed.

### Everything else

- **Hover** on cards, tiles, buttons: `--ac-hover-ms`, easing `--ac-ease`. Only `background`,
  `border-color` and `box-shadow` animate — never size or position.
- **Quick play** on a recent card: bypasses the editor, opens straight into present mode.
- **Pin**: toggles on click, pinned decks sort first. Pin state is local, alongside the recents
  list.
- **Drag and drop**: a `.md` or `.html` dropped anywhere on the landing window opens it. Stage
  says so in copy; Studio accepts it silently.
- **Missing file**: a recent whose path no longer resolves stays in the list, dimmed to
  `--ac-ink-disabled`, with `not found` in mono where the timestamp was. Clicking offers Locate…
  Never silently drop a row.
- **Responsive.** Desktop is primary but the window resizes. Recent grid `3 → 2 → 1` columns at
  roughly `1100px` and `760px`. Under `760px` the action stack goes full width above the story
  text, the theme shelf keeps scrolling horizontally (do not wrap it), and the footer hint row
  is hidden — there is no keyboard on the machine that needs it at that width.
- **Reduced motion**: `prefers-reduced-motion: reduce` zeroes both durations. Already in
  `chrome-tokens.css`.

## State

Landing (per window):

- `zone: "open" | "new" | "themes" | "recents"` — keyboard zone, initial `"open"`
- `themeIndex: number`, `recentIndex: number` — roving index within a zone
- `recents: Recent[]` — `{ title, file, path, lastOpened, pages, theme, pinned, coverRef }`,
  persisted; `pages` and the cover come from the last build of that deck, so they need to be
  cached at build time rather than re-derived on launch
- `themes: Theme[]` — shipped set from `themes/`, plus any resolved relative to the last-used
  folder; each carries the token values needed to draw its preview
- `skillsInstalled: boolean` — drives the status line; check for the plugin, do not assume

Editor adds: `selectedBlock`, `hoveredBlock`, `sourceSheet: null | { page }`, `committing`,
`lastCommitMs`. Most already exist in `src/studio/script.ts`.

## Files in the repo this touches

| Design | Repo file |
| --- | --- |
| Landing, both apps | `src/studio/start.html` — rewrite; add a Stage variant |
| Chrome tokens | new `src/chrome/tokens.css`, imported by both stylesheets |
| Block toolbar, rail, selection, raw editor | `src/studio/style.css` |
| Toolbar behaviour, keyboard model | `src/studio/script.ts`, `src/studio/widgets.ts` |
| Player chrome | `src/viewer/style.css`, `src/viewer/script.ts` |
| Titlebar buttons, native menus | `desktop/electrobun/` |
| Icons | `src/studio/icons.ts`, `src/viewer/icons.ts` — the set here matches its lucide shapes; add folder-open and file-plus |
| Theme preview data | `themes/*/variables.css` (read-only source of truth) |
| Naming fix | `src/studio/start.html` (`Ainsi STUDIO` → `Ainsi Studio`), `README.md` |

## Assets

- `assets/ainsi-logo.svg` — wordmark, white. Provided by the user; also the repo's app identity.
- `assets/ainsi-mark.svg` — mark, white. Matches `desktop/icon.png`.
- Icons are inline SVG, 24-viewBox, `stroke-width: 1.7`, round caps and joins, lucide-shaped —
  consistent with `src/studio/icons.ts`. No icon font, no sprite sheet.
- No other imagery. Photographic areas in the design are placeholders for deck content.

## Files in this bundle

- `Ainsi Landing.dc.html` — the design reference. Five turns, newest at top:
  **5 corrections (authoritative where it conflicts with anything below it)** · 4 identity ·
  3 system + editor + keyboard · 2 dark shell · 1 first exploration (light, superseded — kept
  for history only, do not build from turn 1).
- `chrome-tokens.css` — ready to use as `src/chrome/tokens.css`.
- `assets/` — logo and mark.

## What is deliberately not designed

Grid/thumbnail view in the new chrome; the present-mode overlay; export dialogs; preferences;
the About panel; a command palette; the marketing site. Ask before inventing these — the pattern
above should make most of them obvious, and the ones that aren't are worth a design pass.
