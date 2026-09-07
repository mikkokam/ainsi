# Writing a deck

A deck is one markdown file. Ordinary markdown is a valid deck: headings, paragraphs, lists, tables and images all render without a single directive. What follows is what the engine adds on top.

## Where a page breaks

`---` on its own line breaks the page. That is the only break in a plain deck.

Two things add to it. A layout directive starts a page, because a layout governs a whole page and cannot begin halfway down one. And `h1StartsPage: true` in the frontmatter makes every `# heading` open a page, for a deck written as a document.

Nothing else breaks a page, and the fit solver never merges two pages. It may split one further, which is a different thing: it happens when a page overflows, and it is reported.

## Directives

A directive is an HTML comment, so any markdown tool that has never heard of this one still renders the file:

    <!-- ainsi: timeline axis=horizontal -->
    <!-- ainsi:layout split side=right -->

The first word after `ainsi:` names a component. With `layout` in front of it, it names the page's layout instead. Props follow as `name=value`, quoted when the value has spaces (`x="two words"`), and a bare token means `true`, so `caps` is `caps=true`. Values that look like numbers become numbers and `true`/`false` become booleans before the component's schema sees them.

A component directive claims the block it precedes, then grows one block at a time until the component accepts what it holds, and stops at the next directive. So `<!-- ainsi: prose size=large -->` sizes one paragraph, while `<!-- ainsi: timeline -->` in front of a heading and a list takes both. `<!-- ainsi: end -->` is a boundary and nothing else, for the case where a span would otherwise swallow the block after it.

A layout directive governs the page it sits on, for that page only. The deck's house layout is the frontmatter's `layout`.

When a directive names a component that does not exist, or one that refuses what follows it, the build warns and falls back to the heuristics. The file is still written. A block that comes out as plain prose when you asked for something else is that warning, so read stderr after a build.

## What happens without a directive

A blockquote opening with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` becomes an [alert](components.md#alert). GitHub renders the same syntax the same way, so the file reads correctly in a pull request too.

A paragraph holding nothing but an image becomes [`full`](components.md#full).

Everything else is absorbed into one `prose` block: paragraphs, headings, quotes, code, lists and tables in an unbroken run, stopping at anything a directive claims or an alert. This is why a page of ordinary markdown is one block rather than one block per paragraph, and it is what the fit solver splits when a page runs long.

## Inline

`==words==` is a highlight, the one inline mark markdown never got; `<mark>` written by hand is the same thing.

A blockquote whose last paragraph opens with a dash renders that paragraph as an attribution rather than as body text:

    > The best time to plant a tree was twenty years ago.
    >
    > — a proverb

Everything else is GitHub-flavoured markdown as you know it: tables, task lists, footnotes, strikethrough, `<kbd>`.

## Images

An image is a normal markdown image. A local path resolves beside the deck; a URL is fetched. Local images are embedded as data URLs when the deck is built, so the HTML is one file you can send.

    ![A neon sign reading open](photos/nocturne.jpg)

In a [`tiles`](components.md#tiles) list, text beside the image is the caption and the alt text is the fallback.

## What a deck never contains

No CSS, no inline styles, no positions, no font sizes, no colours. A look the theme does not give is a [theme](themes.md) change, not a slide-level exception: an inline style is the one thing that survives a theme swap, and it survives it wrong.
