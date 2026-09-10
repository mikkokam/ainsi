# Frontmatter

YAML at the top of the deck, between `---` lines. Every key is optional, and a deck with no frontmatter at all is a valid deck.

    ---
    theme: acme
    ratio: 16:9
    layout: default
    h1StartsPage: false
    numbers: on
    logo: assets/mark.svg
    coverLogo: assets/mark-white.svg
    ---

| key | values | default |
| --- | --- | --- |
| `theme` | a name or a path | `default` |
| `ratio` | `w:h` | `16:9` |
| `layout` | a layout name | `default` |
| `h1StartsPage` | `true`, `false` | `false` |
| `numbers` | `on`, `off` | `on` |
| `logo` | a path or a URL | none |
| `coverLogo` | a path or a URL | falls back to `logo` |

Frontmatter that is not valid YAML is one warning and the defaults, never a failed build.

## theme

A bare name is one of the themes shipped in this repo: `default`, `acme`, `portfolio`, `darkroom`, `swiss`, `boring`. Anything with a slash or a leading dot is a folder of your own, resolved beside the deck the way its images are, so `theme: ../themes/house` reads `themes/house` next to the deck's directory and the deck and its theme move as one thing. See [Themes](themes.md).

## ratio

The page box as `width:height`, and the paper a PDF prints on: the sheet is the design width at this ratio, so one deck page is one PDF page with no margin around it. `4:3` is the other common answer.

## layout

The deck's house layout, used by every page that does not name one. See [Layouts](layouts.md).

## h1StartsPage

`true` makes every `# heading` open a page, for a deck written as a document rather than as slides. Off by default, and `---` breaks the page either way.

## numbers

Page numbers on every page but the cover. `off` hides them everywhere, the reading view included. YAML 1.2 keeps `on` and `off` as strings, so both are read here as you meant them: `off`, `no`, `false` and `0` all turn numbers off.

## logo and coverLogo

`logo` is the deck's mark, `coverLogo` the one a cover wears when a brand has two, a white version for a photographic ground being the usual reason. A cover with no `coverLogo` falls back to `logo`, and a deck that names neither wears whatever mark its theme defaults to, which for a house theme is the house one: see [A default logo](themes.md#a-default-logo).

Both take a path beside the deck, an absolute path, or a URL. A missing file is a warning, not an error, and the deck builds without a mark.

The deck says which mark; the theme says where it sits and how large. They arrive as two CSS variables, `--ainsi-logo` and `--ainsi-logo-cover`, and a theme that places neither shows none. This is what placing a mark looks like, from `themes/portfolio/styles.css`:

    .ainsi-page::before {
        content: "";
        position: absolute; z-index: 2;
        right: var(--ainsi-pad); bottom: 1.5rem;
        width: 82px; height: 24px;
        background: var(--ainsi-logo) no-repeat right center / contain;
    }

    /* the cover wears its own mark, top left, where the title is not */
    .ainsi-page[data-layout="header"]::before {
        top: 2.2rem; bottom: auto; left: var(--ainsi-pad); right: auto;
        width: 120px; height: 34px;
        background-image: var(--ainsi-logo-cover);
    }

A one-colour SVG mark can be recoloured for a dark page rather than shipped twice: `filter: brightness(0) invert(1)` on the pages whose ground is a photograph or the accent. The portfolio theme does exactly that, which is why it needs no second file for its dark covers.
