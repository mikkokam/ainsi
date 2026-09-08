# Themes

A theme is a folder. Swapping the folder rebrands every deck written against it, which only holds because a deck contains no styling of its own.

    themes/house/
      variables.css           the tokens: what this theme decides
      styles.css              optional: what no token can carry
      layouts/
        header/
          style.css           optional: this theme's cover
          index.ts            optional: its props, or its own template

Only `variables.css` is required. The default theme's tokens sit under every other theme's, so a theme declares what it changes and nothing else, and a token added to the contract later never leaves an older theme short.

## Using one beside your deck

A bare `theme: acme` names a theme shipped in this repo: `default` is the warm editorial one every other layers on, `acme` a product-pitch grotesque, `portfolio` a picture-led one for a design practice, `darkroom` a photographer's, black ground and flush grids, `swiss` the international typographic style, Helvetica on a twelve-column grid with one red and one yellow, and `boring` the corporate template, Arial on white on a major third, carrying its own logo, for a deck that has to look like everyone else's. Anything with a slash or a leading dot is yours, resolved beside the deck:

    ---
    theme: ../brand/house
    ---

So a client's brand lives in the client's repo, next to the decks that use it, and never in this one.

Start by copying a whole theme folder rather than writing one from nothing: `themes/default/` if the deck is editorial, otherwise whichever shipped theme is nearest what the brand already looks like. Then edit. A theme is small enough that reading one is faster than reading this page.

What carries over from the default theme is its tokens and only its tokens. `variables.css` from `themes/default/` is placed under every other theme's, so a theme declares what it changes and inherits the rest, and a token added to the contract later never leaves an older theme short. Nothing else is inherited: `styles.css` and `layouts/` are the theme's own, and a copied theme keeps only what its folder actually contains. Overriding a token is one declaration in your `variables.css`, which wins by coming second.

## The token contract

A component may reference these variables and its own `--ainsi-<name>-*`, nothing else. There is a token per decision a theme is allowed to make, not one per property a component happens to set, and the list is capped on purpose.

Colour: `--ainsi-ink`, `--ainsi-ink-soft`, `--ainsi-ground`, `--ainsi-shell`, `--ainsi-accent`, `--ainsi-accent-ink`, `--ainsi-rule`, `--ainsi-surface`, `--ainsi-tint`.

The accent is a ground carrying `--ainsi-accent-ink`, and an ink in its own right, a numeral or a rule or a heading set to accent. A colour chosen only as a fill fails half that job: an electric one can read 1:1 against the paper and vanish. `--ainsi-tint` is the light wash the `soft` tone sits on.

Status: `--ainsi-info`, `--ainsi-ok`, `--ainsi-notice`, `--ainsi-warn`, `--ainsi-danger`. What informative, good, notable, careful and stop look like. Alerts are the first to ask.

Identity: `--ainsi-logo`, `--ainsi-logo-cover`. Set from the deck's [frontmatter](frontmatter.md#logo-and-coverlogo) or, for a house theme, defaulted here; the theme decides where they sit. See [A default logo](#a-default-logo).

Type: `--ainsi-font`, `--ainsi-font-display`, `--ainsi-font-mono`, `--ainsi-strong`, `--ainsi-size`, `--ainsi-leading`.

Fitting: `--ainsi-step-min`, how far the solver may step the type down before it splits a page instead. `0.8` in the default theme.

Space and shape: `--ainsi-gap`, `--ainsi-pad`, `--ainsi-radius`, `--ainsi-border`.

Material: `--ainsi-shadow`, `--ainsi-blur`. Depth is a theme's call, not a component's.

Motion: `--ainsi-motion`, `--ainsi-ease`, how the deck moves when presented, down to not at all. See [Motion](#motion).

## A default logo

A theme built for one company puts the mark in `variables.css` and no deck written against it has to name a file. The deck's frontmatter still wins, because the engine sets both tokens as an inline style on `<body>` and `:root` loses to that, so one theme serves the house deck and a co-branded one without a second folder.

Inline the file as a data URI rather than pointing at it. The engine emits one self-contained HTML, and a relative `url()` in that `<style>` block resolves against the output file, not against the stylesheet it was written in:

    --ainsi-logo: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0i...");
    --ainsi-logo-cover: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0i...");

Keep the source files in the theme folder and say in a comment which ones they are, or the next person to change the mark has a base64 string and nowhere to go. `themes/boring/` does this: `assets/boring-logo.svg` is the wordmark every page wears, `assets/boring-mark.svg` the monogram the cover wears larger.

## styles.css

The escape hatch, for what no token can carry: the faces and their optical sizing, the grain of the paper, where the logo hangs. Fonts are imported here, not declared as tokens.

It may not reach inside a component. A selector containing `__` is a component's internals, and the build warns when it sees one:

    theme styles.css reaches inside a component: ".ainsi-tiles__caption"; use a token or a layout

The rule holds because a component's markup is its own business and will change. If a component's look cannot be reached through a token, that is a missing token, and adding one is a change to `src/tokens.ts` and every theme, deliberately.

## Motion

Presentation motion belongs to the viewer, not to a theme, so every deck has it whatever theme it wears. What a theme sets is the pace, through two tokens the whole sequence is written in terms of:

    --ainsi-motion: 420ms;                        /* one beat */
    --ainsi-ease: cubic-bezier(.16, 1, .3, 1);    /* the curve every part shares */

Three things move. A page arrives on the Y axis from the side the deck is travelling towards, over one beat. The blocks on it rise and clear one after another, the first as the turn lands, at roughly half a beat apart, with everything past the fourth block sharing the last delay. Any `mark` on the page then draws left to right like a highlighter pass. The theme sets one number and all three follow it: `swiss` at 200ms is brisk, `default` at 700ms is slow, `--ainsi-motion: 0s` is a deck that does not move at all.

The hooks, for a theme writing its own: `data-present` and `data-turn="forward" | "back"` on the body, `data-current` on the page. Every layout renders `main > article`, so the blocks a theme would restage are that element's children.

### Replacing it

Override the viewer's rules in `styles.css`. Theme CSS is emitted before the viewer's, so an override has to out-specify it: write `body.ainsi[data-present]` where the viewer writes `body[data-present]`.

    body.ainsi[data-present] .ainsi-page[data-current] { animation: none; }
    body.ainsi[data-present] .ainsi-page[data-current] article > * { animation: none; }

Two constraints hold whatever a theme writes in place of it. Only the arriving page can move: the one leaving is `display: none` from the instant it stops being current, and nothing hidden that way can be animated. And a page's keyframes have to restate the viewer's own centring and scale, `translate(-50%, -50%) scale(var(--ainsi-present-scale, 1))`, because an animated transform replaces the rule's, not adds to it.

The narrow screen presents the reading form, one page filling the display, so the turn is scoped to `min-width: 901px` and a theme's replacement should be too. `prefers-reduced-motion: reduce` drops all of it to a plain cut, and a theme that adds its own motion adds a line to that block as well.

## Layouts

A theme may replace a layout or add one, by putting a folder of that name under `layouts/`. A `style.css` alone restyles the shipped layout; an `index.ts` declares props, and only one that exports `render` replaces the template. A layout's stylesheet adds to the engine's rather than replacing it.

A layout may restyle any component on its own page, so what it must name is the page and not a class. Every selector has to carry `[data-layout="<name>"]` and no other layout's name, checked on load:

    .ainsi-page[data-layout="header"] h1 { font-size: 4rem; }

## Trying one

`theme:` is one frontmatter line, so the studio's Theme menu is a write to that line and undo is a write of the old value. There is no preview state anywhere: what you see is what the file says.
