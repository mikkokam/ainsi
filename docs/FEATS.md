# Walking skeleton

## Heuristic grouping (feat) [invariant]

Grouping and default component choice, per the six rules in the data model, with directives overriding where present. `origin` records which.

This is load-bearing: if zero directives do not already produce a usable deck, directives become mandatory, become noise in every file, and the format is no better than what exists.

Six rules are implemented and unit-tested, and the example deck groups correctly. What is not done is the judgement: three real decks of Mikko's rendering acceptably with no directives at all, compared by eye against the bespoke versions. Until that is checked the invariant is untested in the only way that counts.

## Fit solver (feat)

The block-boundary step is built: `src/fit.ts`, behind `--fit`, using `playwright-core` as an
optional dependency that degrades to one diagnostic and unchanged pages when no browser is
installed. A page that overflows loses its last block to a new page under the same layout,
repeated until it fits; a page overflowing as one block is reported, not silently clipped.

What remains is the rest of the ladder: step the type scale down before splitting, and offer a
component's `density` variant as a step in between. Both apply before a block boundary split
is tried, per the order in `DATA-MODEL.md`, so this is a prerequisite step inserted before the
existing one, not an alternative to it. Splitting inside a `splittable` component (breaking
`prose` at a paragraph boundary, say) is the step after: a page overflowing as a single
absorbed `prose` block currently has nowhere further to go.

Done: a page that only needs a smaller type scale to fit does not lose a block it did not
need to lose, and a `prose` block genuinely too tall for a page splits at a paragraph rather
than being reported as unsplittable.

## Density variants (feat)

Every component declares `density` and nothing consumes it. The fit solver is what will, stepping a block to a tighter variant before splitting a page. Each variant needs a class the component's own CSS implements, `pac-<name>--tight`, so the theme is still not involved.

Blocked on the fit solver, and worth doing as part of it rather than before it: a variant with nothing measuring it is a guess about what will help.

## Measurement of islands (defect)

The fit solver will measure static markup, and an island that changes size when it mounts
makes that measurement a lie. The invariant is written down and nothing enforces it.

The check is cheap once a headless browser is in the pipeline for fit anyway: measure a
page, mount, measure again, report any block that moved. Worth doing with the solver rather
than before it, since it needs the same machinery.

## Non-linear navigation (feat)

Decks are read asynchronously as often as they are presented, and a reader arriving after the
meeting wants to jump rather than page through. The viewer needs an overview: a grid of page
thumbnails behind a key, click to go, and a way for a deck to name entry points so a page can
link to another page.

The toolbar already has the strip to hang it on and the viewer already tracks the current
page. What is missing is the overview itself and an addressing scheme: linking to a page needs
a stable name for it, which is the anchor question this project already decided against for
blocks and would have to answer differently here.

## A 9:16 sample (feat)

`ratio` is a deck setting, so a phone-shaped deck is one line of frontmatter, and the reading
form already handles narrow screens. Neither is exercised: every sample is 16:9 read on a
laptop, so the claim that this works in three contexts is untested.

Done: a `samples/` deck at 9:16 that reads well on a phone, and the acme deck checked at
900px and below on a real device rather than in a resized window.

# Open

## What forms a group when nothing matches (question) [guess]

The six heuristics cover the cases seen so far. The guess is that everything else collapsing to `prose` is good enough, and that authors reach for a directive rarely. If in practice most pages need one, grouping is underpowered and the answer is probably a seventh rule rather than a bigger vocabulary.

Deliverable is a rewritten claim in the data model: either the invariant on zero-directive quality holds as written, or it is demoted and the reason recorded in one sentence.

## One source, two projections (question)

A memo and a deck from the same markdown. A directive naming a deck component means nothing in a document vocabulary, and the file cannot hold two answers. The overlay design that was cut would solve it, at the cost of reintroducing block naming.

Cheaper answers exist and should be tried first: a shared component vocabulary across both output kinds, or a directive that carries a target, `<!-- pac deck: timeline -->`. Not worth deciding until a second projection is actually wanted.

## Round-trip editing (question)

Eraser and Structurizr let you drag on the canvas and have it persist, and deleting on the canvas removes it from the source. That is an editor rather than a build pipeline: it needs a writer that can remove or reorder an entity without disturbing the formatting around it, plus a rule for concurrent edits on both sides.

Nothing before it depends on it, and the source slice per entity is already kept, so this stays out until the pipeline is worth living in.
