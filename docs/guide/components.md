# Components

A component decides how a run of blocks reads. It never decides what any of it looks like: that is the [theme](themes.md).

Name one with a directive, `<!-- ainsi: boxes stretch -->`, or let the [heuristics](writing.md#what-happens-without-a-directive) pick. A component that does not accept what follows it warns and falls back rather than failing the build.

Props are listed with their defaults. Unknown props are passed through and ignored, so a typo is silent: check the warning line, not the page.

Every component below whose content is prose also takes `text`, one of `small`, `normal` or `large`, a step off the page's size on the theme's own scale. It is a step, not a measurement: the theme decides what small is, and a theme swap carries it. `figures`, `full` and `alert` do not take it, because their size is already their own: a figure's display size, a picture's share of the page, an aside that speaks a step below the body by design.

## Lists

Six components take a list, one item per row, and read a leading `**bold**` run as that item's title. Any blocks before the list, a heading and a paragraph say, stay where they are and render normally.

### agenda

The contents page: one row per item, keeping its numerals when the list is numbered. Splittable, so a long agenda continues on the next page rather than shrinking the deck around it. No props.

### boxes

One card per item.

| prop | values | default |
| --- | --- | --- |
| `stretch` | `true`, `false` | `false` |

`stretch` grows the cards to fill the row; left alone they take a shared width and wrap.

### columns

`boxes` without the chrome: each item a column of plain text. No props.

### figures

One figure per item: the leading bold run is the figure, any size or shape of text, and the rest is its caption. No props.

### timeline

The items as steps.

| prop | values | default |
| --- | --- | --- |
| `axis` | `horizontal`, `vertical` | `horizontal` |

### matrix

Exactly four items as a two-by-two, quadrants in reading order from the top left. A list of any other length is refused.

| prop | values | default |
| --- | --- | --- |
| `x` | any text | none |
| `y` | any text | none |

`x` and `y` name the axes.

### tiles

A field of tiles: pictures, text, or both. An item that is an image takes the text beside it as its caption, `- ![](x.jpg) Nocturne, 2025`, or falls back to its alt text.

| prop | values | default |
| --- | --- | --- |
| `columns` | `0` to `6` | `0` |
| `crop` | `true`, `false` | `false` |

`columns: 0` lets the count decide. Pictures keep their proportions and are never cropped unless `crop` says so, which trades the mixed shapes for a flush grid of identical cells. Tile heights are capped in em by the row count, so the fit solver's type step takes the pictures down with everything else.

## Tables

Four components take a GitHub-flavoured markdown table. None takes props.

### comparison

The header names the columns, the first column labels the rows, and every further column becomes a panel.

### striped-table

The table with a band behind every other row, which is what carries the eye across a wide row.

### bar-table

The table with a bar behind the values of every numeric column, scaled to that column's largest. A column counts as numeric when most of its cells parse, and a cell parses when it starts with a number: `5`, `5 tok/s`, `18%` and `2 400€` all measure, while `unmetered` stays text. Numeric columns take the width; the rest stay as narrow as their text.

### roadmap

The header names the periods, the first column names the rows. An empty cell is empty; a cell with anything in it becomes a filled block. A cell holding only a mark (`x`, `-`, `*`) carries no text, anything else is a label inside the block, and filled cells that touch join into one bar.

## The rest

### full

An image filling its slot. Under the [`header`](layouts.md#header) layout it becomes the page's ground.

| prop | values | default |
| --- | --- | --- |
| `size` | `s`, `m`, `l`, `full` | the slot's own |
| `align` | `left`, `center`, `right` | `left` |

### prose

Markdown as written. Accepts anything, which makes it the fallback for every run the heuristics do not otherwise claim. Splittable.

| prop | values | default |
| --- | --- | --- |
| `size` | `small`, `normal`, `large`, `huge` | `normal` |
| `align` | `left`, `center`, `right` | `left` |
| `caps` | `true`, `false` | `false` |
| `color` | `ink`, `soft`, `accent` | `ink` |

`caps` is tracked capitals, for a label or an eyebrow above a title; the source keeps its case. `color` names the theme's inks rather than a colour of the deck's own, so it survives a theme swap.

### alert

The GitHub callout blockquote, `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`. Picked up without a directive. No props.

## Your own

A component is a folder under `src/components/`, and its name is the folder's name. It needs an `index.ts` default-exporting `about`, `accepts`, `props`, `splittable`, `density` and `render`; a `style.css` beside it is optional and is scoped, every selector naming `.ainsi-<name>` or one of its `__` and `--` parts, checked on load and warned about when it escapes. Read `src/components/timeline/` first: it is the shortest complete one.
