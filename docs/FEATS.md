# Walking skeleton

## Three real decks (feat) [invariant]

Two claims rest on the same unmade check, so they are one item. Grouping says zero directives
already produce a good deck; fit says a page is an output rather than something the author
lays out. Both are implemented, unit-tested, and correct on `samples/acme.md`. Neither has met
a deck someone actually had to give.

This is load-bearing twice over. If zero directives do not produce a usable deck, directives
become mandatory, become noise in every file, and the format is no better than what exists. If
fit produces decks a reader would not accept, the whole solver is machinery in service of a
worse result than doing it by hand.

Done: three real decks of Mikko's, rendered with no directives and with `--fit`, read side by
side against the bespoke versions. The outcome is a rewritten claim either way — the invariant
holds as written, or it is demoted and the reason recorded in one sentence.

Note before trusting the committed sample: `samples/acme.html` was last fitted where
images.unsplash.com was unreachable, so its image pages were measured with images at zero
height. Re-run `--fit` on a machine with network.

## Local images are not measured (defect)

The fit pass measures with `setContent`, which gives the document no base URL, so a relative
`![](pic.png)` resolves against `about:blank` and never loads. Measured just now: a local image
reports `naturalHeight: 0` and occupies 31.9px, the height of its alt text, instead of its real
height.

So fit silently under-measures every page carrying a local image, and reports a page as fitting
when the real output overflows. That is precisely the failure the solver exists to prevent,
which makes this the worst defect open.

The fix needs the deck's directory in `fit.ts`, which it currently has no reason to know: serve
the deck's own folder to the measuring page, either by giving the measured html a `<base>` or
by extending the session's route handler to answer local paths from disk. The route handler is
already there for remote responses and only matches `^https?:` today.

Done: a page whose only content is a tall local image is measured at that image's real height,
and a deck of local images fits the same way a deck of remote ones does.

## Density variants (feat)

Every component declares `density` and nothing consumes it. The fit solver is what will,
stepping a block to a tighter variant before splitting a page. Each variant needs a class the
component's own CSS implements, `pac-<name>--tight`, so the theme is still not involved.

The last unbuilt rung of the ladder, and the least urgent. Scale, block boundary and in-block
split between them fit every deck written so far, and this rung's case is narrow: a page a
little too tall where a tighter `boxes` or `comparison` saves it and smaller type does not.
Worth building when a real deck produces that case, and not before — a variant with nothing
asking for it is a guess about what will help.

## Measurement of islands (defect)

The fit solver measures static markup, and an island that changes size when it mounts makes
that measurement a lie. The invariant is written down and nothing enforces it.

Cheap now that the machinery exists: `openFit` already holds a page open and `measure` already
renders one page and reads its overflow. Measure a page, mount, measure again, report any block
that moved.

## PDF export (feat)

The model says HTML is the first target because the browser measures for us, and the viewer is
a build option so a headless render for a PDF carries no chrome. Both are true, and there is
still no way to get a PDF: no `--pdf`, and no `@page` rules, so printing a deck from a browser
gives A4 portrait pages that break wherever they like.

A deck you cannot hand to someone who does not want HTML is half a deck, and the dependency is
already paid for — `page.pdf()` is the same headless chromium `--fit` uses, on the same
session. Note the order matters: a PDF rendered without fitting first is worse than none,
because `overflow: hidden` means the pages that do not fit lose their content silently in the
export.

Done: `--pdf` writes one page per deck page at the deck's ratio, `@page` rules so a browser's
own print gives the same, and the viewer absent from both.

# The Studio

A visual editor over the same markdown, run by the dev server, never shipped in a deck. A
player is not an editor: baking editor code into the exported file would bloat it, and chrome
that is not in the markup cannot leak into a print, an export or a measurement.

This supersedes the round-trip editing question, which asked for a writer that could reorder or
remove an entity without disturbing the formatting around it. It turns out none is needed for
the edits worth making: every entity already carries `node.position.start.offset`, so an edit
is a splice into the source string at an offset the pipeline already computed.

`[invariant]` The Studio holds no document state. Selection and the text in an open editor,
yes; anything that changes what is rendered goes to the file first and comes back through the
engine. The moment the Studio can show something the markdown does not say, there are two
writers and a lossy bridge between them, which is the failure every markdown WYSIWYG dies of.
This bites hardest on the tempting case, previewing a theme without committing: don't. The
theme is one frontmatter line — write it, and make undo a write of the old value rather than a
pile of unwritten state.

`[invariant]` Nothing ever serializes HTML back to markdown. Not in the Studio, not anywhere.

`[decision]` The Studio and an agent share one vocabulary and one write path. Both edit
markdown by splicing at an offset; if it is literally the same function, the Studio's writes
are testable headlessly with no browser, and a human tweak and an agent tweak are the same kind
of event.

`[decision]` Every write hashes the file first and refuses on a mismatch. The deck will be open
in an editor at the same time, and a splice against a stale offset corrupts the file rather
than merely losing an edit.

Measured, so the design rests on numbers rather than hope. Full rebuild is 11.9 ms at 11 pages,
15.4 ms at 25, 52 ms at 100, 223 ms at 400, and it is almost entirely remark's parse — grouping
and rendering are free, so the only lever that would ever matter is the parser. Replacing the
whole body in the browser costs 0.8 ms at 11 pages and 6.8 ms at 100; replacing one section
costs 0.10 ms at any size. A commit round-trips in about 20 ms on a realistic deck, which is
well under noticing. Rebuilding per keystroke is not on, and not because of the milliseconds.

## Granular page swap (feat)

A rebuild returns the whole deck, and replacing the body throws away scroll position and
anything the reader was doing. At 0.10 ms a section, diff the rendered sections against what is
in the DOM and replace only those whose html changed — usually one.

Full re-render on the server, granular replacement in the browser. That pairing is what lets
the simple model stay simple without every edit feeling like a page reload. Worth building
first because the reload path already exists and this is the smallest thing that makes it feel
like an editor.

## The Studio: structural edits (feat)

Change a block's component, delete it, change the page's layout, change the theme, split a
page. No caret is involved, they are infrequent and atomic, and a full re-render is what you
want because the structure changed.

The whole edit is one comment line. Click a block, pick from the components whose `accepts()`
passes for that span, fill the props from the component's own zod schema — validation, defaults
and coercion are already one declaration — and splice `<!-- pac: timeline -->` in before the
entity the block starts at.

Two handles are needed in the output, emitted in edit mode only and never written into the
markdown: a block handle for these edits and an entity handle for the content edits below. Both
are derived from ids that already exist. `prose` deliberately emits no wrapper of its own, so
there is nothing to hang one on — solving that without changing what a plain build emits is the
one real unknown here.

Done: `--edit` on the dev server, handles, a component popover, and a splice endpoint. One
directive change, end to end, no content editing. Small enough to throw away if the loop does
not feel right, which is the point of doing it first.

## The Studio: content edits (feat)

Typing, which is where every editor of this shape goes wrong. The move that avoids it: edit the
entity's markdown slice, not the rendered HTML. Clicking a paragraph replaces that one block's
rendered output with a plain textarea holding its markdown, usually one to five lines. On blur,
splice it back by offset and rebuild.

Markdown stays the only truth, so there is no HTML-to-markdown direction, no second parser and
no serializer. There is no caret to preserve across a re-render, because nothing re-renders
while you type — the textarea sits outside the rendered tree and the swap happens on commit.
The only browser state is which entity is open and what is in it, and it dies on commit.

The cost is that the block being edited shows source rather than its rendered form. For slide
content that is small: blocks are short, `- item` and `**bold**` are legible, every other block
on the page stays rendered, and the render returns the instant you blur.

`[decision]` No ProseMirror, no Lexical, no editor whose own document model is the truth. That
is the only other way to get true WYSIWYG and it reintroduces exactly the state this design
exists to avoid. It is also the point where a framework becomes necessary, which is the signal
that the line has been crossed rather than a reason to cross it.

## Playwright out of the default install (chore)

`playwright-core` is an optional dependency that ships no browser binary, but `bun install`
still fetches 14 MB of it against a 27 MB tree, for a wrapper most builds never load. Moving it
to a dev dependency, with `--fit` and `--pdf` saying what to install, halves a default install
and changes nothing else. The degrade path and its test already exist.

# Later

## Non-linear navigation (feat)

Decks are read asynchronously as often as they are presented, and a reader arriving after the
meeting wants to jump rather than page through. The viewer needs an overview: a grid of page
thumbnails behind a key, click to go, and a way for a deck to name entry points so a page can
link to another page.

The toolbar already has the strip to hang it on and the viewer already tracks the current page.
What is missing is the overview itself and an addressing scheme: linking to a page needs a
stable name for it, which is the anchor question this project decided against for blocks and
would have to answer differently here.

## A 9:16 sample (feat)

`ratio` is a deck setting, so a phone-shaped deck is one line of frontmatter, and the reading
form already handles narrow screens. Neither is exercised: every sample is 16:9 read on a
laptop, so the claim that this works in three contexts is untested.

Done: a `samples/` deck at 9:16 that reads well on a phone, and the acme deck checked at 900px
and below on a real device rather than in a resized window.

# Open

## What forms a group when nothing matches (question) [guess]

The six heuristics cover the cases seen so far. The guess is that everything else collapsing to
`prose` is good enough, and that authors reach for a directive rarely. If in practice most pages
need one, grouping is underpowered and the answer is probably a seventh rule rather than a
bigger vocabulary. Answered by the three decks above, not by argument.

## One source, two projections (question)

A memo and a deck from the same markdown. A directive naming a deck component means nothing in a
document vocabulary, and the file cannot hold two answers. The overlay design that was cut would
solve it, at the cost of reintroducing block naming.

Cheaper answers exist and should be tried first: a shared component vocabulary across both output
kinds, or a directive that carries a target, `<!-- pac deck: timeline -->`. Not worth deciding
until a second projection is actually wanted.
