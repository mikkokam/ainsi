# Layouts

A layout takes a whole page, where a component takes a run of blocks inside it. Four ship here; a [theme](themes.md#layouts) may add its own or replace one of these.

Set the deck's house layout in the [frontmatter](frontmatter.md), and override it for one page with a directive at the top of that page:

    <!-- ainsi:layout section tone=inverse -->

A layout directive starts a page, since a layout cannot begin halfway down one.

## default

The blocks in the page box. What every page uses unless told otherwise.

| prop | values | default |
| --- | --- | --- |
| `tone` | `accent`, `inverse`, `soft` | the theme's paper |

`tone` swaps the ground under the page and the ink with it: `accent` puts the theme's accent colour underneath, `inverse` puts its ink underneath and its paper on top, `soft` a light wash of the accent. That pairing is why a tone is a prop and not a colour.

## header

The cover, and any page where a picture is the point: a [`full`](components.md#full) image on the page becomes the ground and the text sits over it.

| prop | values | default |
| --- | --- | --- |
| `align` | `start`, `center`, `end` | `end` |

`align` is vertical: `end` puts the title at the foot of the page, which is where a cover usually wants it.

## section

The divider between parts of a deck.

| prop | values | default |
| --- | --- | --- |
| `tone` | `ground`, `accent`, `inverse`, `soft` | `accent` |

A divider sits on the accent ground unless told otherwise, so `ground` is how you ask for a quiet one.

## split

The page in two, text one side and a picture the other.

| prop | values | default |
| --- | --- | --- |
| `side` | `left`, `right` | the theme's own |
| `size` | `third`, `half`, `two-thirds`, `image` | the theme's own |
| `tone` | `accent`, `inverse`, `soft` | the theme's paper |

`size` is the image pane's share of the page. `size=image` lets the picture's own proportions decide the split, which is what a portrait photograph wants and what a wide one does not.
