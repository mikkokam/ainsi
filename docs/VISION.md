# Vision

> Skeleton. Sections marked `TODO` are genuinely undecided; everything else is a claim
> already made somewhere in this repo, gathered here so it can be argued with in one place.
> This file holds *why* and *what for*. Mechanism lives in `ARCHITECTURE.md`, shapes in
> `DATA-MODEL.md`, and what is not built in `FEATS.md`.

## The one sentence

TODO — one sentence, no clauses. Draft: *decks that are written as markdown, laid out by a
solver, and styled by a theme, so the same content can be restyled or rerendered years later
without being rewritten.*

## The problem

Existing tooling fails one of two ways. It conflates content and presentation, so restyling
means editing the content; or it needs manual layout, so the content forks inside the
presentation layer. Both leave you with a deck that can only be maintained by the person who
built it, in the tool that built it.

The split here is form selection in the content, style in the theme, layout in a solver.

## The two things that justify it

`[invariant]` Two things this must do that bespoke per-deck HTML cannot:

1. **Change the content of an old deck and rerender it.** The deck is markdown; nothing about
   the layout is authored, so an edit does not fight a design.
2. **Restyle every deck at once.** A rebrand swaps a theme folder and touches no content file.

If neither is needed, this is not worth building. That sentence is the project's whole
justification and it should stay uncomfortable.

## Who it is for

TODO. Currently: one person with decks to give and a preference for text files. The honest
question is whether the audience is (a) that person, (b) engineers who already write markdown
and resent slide tools, or (c) anyone with an agent authoring decks for them. These want
different things and the answer changes what gets built after v1.

## The four surfaces

What a person gets. *How* they are built is `ARCHITECTURE.md`.

### Markdown to a deck

Point it at a `.md` and get one self-contained HTML file. No config, no layout, no theme
authoring required to start. The content file says what a block *is* — "this list is a
timeline" — and never what it looks like.

Pages are an output. A page that would overflow is fitted rather than clipped, and one that
cannot be fitted says so instead of losing text silently.

### An agent's tool

The CLI is what an agent drives, and the agent is a first-class author rather than an
afterthought. It builds headlessly, reports what it did per page and per block, and edits a
deck the same way a person does — by writing markdown.

`[invariant]` A human and an agent share one write path and one vocabulary. Neither can express
something the other cannot see.

TODO — what an agent actually needs beyond this: machine-readable diagnostics rather than
prose on stderr, and an exit code that distinguishes "built with warnings" from "could not
build". Neither exists.

### Something to present with

A deck opens in a browser and presents: full screen, one page at a time, arrow keys, on a
laptop or a phone. The same file is also a document you scroll, and on a narrow screen it
reflows into one rather than shrinking to a letterbox.

The chrome is injected at runtime and appears nowhere in the file, so what you print, export
or measure has no trace of it.

### Something to tune with

The last mile of any deck is visual and always will be. A local editor over the same markdown
file: click a block, change what it is, edit its text, swap the theme, see it immediately.

`[invariant]` The editor holds no document state. The markdown is the only truth and everything
goes through it. This is the difference between a tool you can leave and one you are inside.

## What it will never be

`[decision]` **Not a canvas.** No slide object with authored coordinates. Position is derived,
always. The moment you can drag something, the markdown stops being the truth.

`[decision]` **Not a hosted product.** It runs on your machine against your files. TODO whether
that is a principle or just where it starts.

`[decision]` **Not a general document system.** A memo and a deck from the same source is an
open question, not a goal.

`[decision]` **Not a framework.** The engine emits HTML strings. A component may use a
framework inside itself; the engine never gains one.

TODO — anything else worth naming here. The list is more useful long than short.

## The bets

Each of these is falsifiable and none is settled. If one is wrong, it is better to find out
early and write down that it was wrong.

**Zero directives already produce a good deck.** If most pages need a directive, the heuristics
are underpowered, directives become noise in every file, and the format is no better than what
exists. Tested by three real decks, not by argument. See `FEATS.md`.

**A solver beats hand-tuning.** If fitted decks read worse than hand-laid ones, the whole
measuring apparatus is machinery in service of a worse result.

**A capped vocabulary is enough.** About ten components, `prose` as the escape hatch, `raw` for
anything else. If people reach past it constantly, the cap is wrong.

**A token list is enough of a theme.** If themes keep needing to reach inside components, the
contract is wrong and the modularity is fictional.

TODO — a bet about the editor, once there is enough of one to be wrong about.

## What "done" looks like

TODO. A v1 definition, in terms a person could check rather than a feature list. Candidate:
*three real decks given from this tool, restyled once between them, with no page hand-fixed.*

## What success is not

Not stars, not a plugin ecosystem, not feature parity with anything. TODO — the honest measure.
