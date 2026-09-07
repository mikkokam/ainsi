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

A bare `theme: acme` names a theme shipped in this repo. Anything with a slash or a leading dot is yours, resolved beside the deck:

    ---
    theme: ../brand/house
    ---

So a client's brand lives in the client's repo, next to the decks that use it, and never in this one. Copy `themes/default/` as the starting point; it is the theme every other one layers on.

## The token contract

A component may reference these variables and its own `--ainsi-<name>-*`, nothing else. There is a token per decision a theme is allowed to make, not one per property a component happens to set, and the list is capped on purpose.

Colour: `--ainsi-ink`, `--ainsi-ink-soft`, `--ainsi-ground`, `--ainsi-shell`, `--ainsi-accent`, `--ainsi-accent-ink`, `--ainsi-rule`, `--ainsi-surface`, `--ainsi-tint`.

The accent is a ground carrying `--ainsi-accent-ink`, and an ink in its own right, a numeral or a rule or a heading set to accent. A colour chosen only as a fill fails half that job: an electric one can read 1:1 against the paper and vanish. `--ainsi-tint` is the light wash the `soft` tone sits on.

Status: `--ainsi-info`, `--ainsi-ok`, `--ainsi-notice`, `--ainsi-warn`, `--ainsi-danger`. What informative, good, notable, careful and stop look like. Alerts are the first to ask.

Identity: `--ainsi-logo`, `--ainsi-logo-cover`. Set from the deck's [frontmatter](frontmatter.md#logo-and-coverlogo); the theme decides where they sit.

Type: `--ainsi-font`, `--ainsi-font-display`, `--ainsi-font-mono`, `--ainsi-strong`, `--ainsi-size`, `--ainsi-leading`.

Fitting: `--ainsi-step-min`, how far the solver may step the type down before it splits a page instead. `0.8` in the default theme.

Space and shape: `--ainsi-gap`, `--ainsi-pad`, `--ainsi-radius`, `--ainsi-border`.

Material: `--ainsi-shadow`, `--ainsi-blur`. Depth is a theme's call, not a component's.

Motion: `--ainsi-motion`, `--ainsi-ease`, how the deck moves when presented, down to not at all.

## styles.css

The escape hatch, for what no token can carry: the faces and their optical sizing, the grain of the paper, where the logo hangs. Fonts are imported here, not declared as tokens.

It may not reach inside a component. A selector containing `__` is a component's internals, and the build warns when it sees one:

    theme styles.css reaches inside a component: ".ainsi-tiles__caption"; use a token or a layout

The rule holds because a component's markup is its own business and will change. If a component's look cannot be reached through a token, that is a missing token, and adding one is a change to `src/tokens.ts` and every theme, deliberately.

## Layouts

A theme may replace a layout or add one, by putting a folder of that name under `layouts/`. A `style.css` alone restyles the shipped layout; an `index.ts` declares props, and only one that exports `render` replaces the template. A layout's stylesheet adds to the engine's rather than replacing it.

A layout may restyle any component on its own page, so what it must name is the page and not a class. Every selector has to carry `[data-layout="<name>"]` and no other layout's name, checked on load:

    .ainsi-page[data-layout="header"] h1 { font-size: 4rem; }

## Trying one

`theme:` is one frontmatter line, so the studio's Theme menu is a write to that line and undo is a write of the old value. There is no preview state anywhere: what you see is what the file says.
