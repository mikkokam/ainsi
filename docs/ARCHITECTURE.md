# Architecture

> Skeleton. This file holds *where things live and why the seams are where they are*. Why the
> project exists is `VISION.md`; the shapes flowing through the pipeline are `DATA-MODEL.md`;
> what is not built is `FEATS.md`. Where a section says **moves from DATA-MODEL**, the content
> should be cut from there rather than copied — two homes for one rule is how a doc set rots.

## The shape

One engine and three consumers of it. Everything else follows from that.

    ┌─ engine ──────────────────────────────────────────────┐
    │  content.md → parse → paginate → group → fit → render │
    │  no filesystem, no browser, no Bun globals            │
    └───────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
      ┌──┴───┐            ┌───┴────┐          ┌────┴────┐
      │ cli  │            │ player │          │ studio  │
      └──────┘            └────────┘          └─────────┘
     writes a file        ships inside         dev server only,
     headless, the        the deck; chrome     never in a deck
     agent's surface      injected at runtime

`[invariant]` A video file is not an editor. The player ships inside the artifact; the studio
never does. Chrome that is not in the markup cannot leak into a print, an export or a
measurement.

`[invariant]` The dependency runs one way. A consumer may build on the engine; the engine may
not import a consumer or an adapter. Checked by `test/boundary.test.ts`, which fails on a node
builtin, a `Bun.` global, the word playwright, or an adapter import inside the engine — and
whose default is the strict side, so a file added tomorrow is engine unless it is named.

## The pipeline

Five stages, each taking one shape and producing the next. **Moves from DATA-MODEL** — keep the
stage list and the one-line job of each here; leave the shapes (`Entity`, `Directive`, `Block`,
`Page`) and the decisions about them there.

| stage | job | module |
|---|---|---|
| parse | markdown → entities + directives + settings | `parse.ts` |
| paginate | page candidates from breaks, `h1`, layout directives | `paginate.ts` |
| group | entities → blocks, by directive or heuristic | `group.ts` |
| fit | measure, and make each page fit its box | `fit.ts` |
| render | blocks into a layout, into one HTML file | `build.ts` |

`[decision]` Fit is a stage, not a rendering afterthought. Fixed page height is where
markdown-to-slides tools die.

`[decision]` `render` returns an HTML string, never a DOM node or a framework element. That is
what lets the fit solver measure in a headless browser, keeps the engine portable, and leaves
room for a renderer that has no runtime at all.

## Module map

    src/
      parse.ts paginate.ts group.ts build.ts     the pipeline
      html.ts kit.ts registry.ts types.ts        shared shapes and helpers
      base.ts tokens.ts                          what the engine owns: the page box, the tokens
      components/<name>/                         the vocabulary; a folder each
      layouts/<name>/                            the page shapes; a folder each
      ─────────────────────────────────────────  the fence
      load.ts                                    discovery: the filesystem and the bundler
      fit.ts                                     measurement: the browser
      serve.ts                                   the dev server: sockets and watchers
      cli.ts                                     arguments, orchestration, output
      ─────────────────────────────────────────
      viewer/                                    the player; browser code, ships in the deck

Four adapters, named in the boundary test. Everything above the fence is engine.

TODO — whether the fence becomes directories (`src/core/`, `src/node/`) or stays a test. The
test buys the guarantee; the directories buy legibility. Not worth the import churn until the
shape stops moving.

## Where things run

| | runs on | needs a browser | ships in the deck |
|---|---|---|---|
| engine | anywhere JS runs | no | no |
| cli | Bun | only for `--fit` and PDF | no |
| player | the viewer's browser | is one | **yes** |
| studio | Bun + a browser | is one | no |

`playwright-core` is an optional dependency that ships no browser binary. `build.ts` never
imports it — there is a test — so a plain build on a machine that has never seen chromium works
and stays fast. A missing browser degrades to one diagnostic and unchanged pages, never a
thrown error.

## Surface: the CLI

Orchestration and output. Reads the deck, loads the theme, components and layouts, runs the
pipeline, writes one file, and reports what it did per page and per block.

This is also the agent's surface, and it is currently shaped for a human reading a terminal.

TODO — what an agentic mode needs:
- structured diagnostics (`--json`): page index, block id, component, kind, not prose on stderr
- exit codes that distinguish built-clean, built-with-overflow, and could-not-build
- a documented, stable way to apply a directive without a browser, shared with the studio
- whether `--fit` should be the default when a browser is present

## Surface: the player

`src/viewer/`. A floating toolbar and presentation mode, injected at runtime, absent from the
written file, and switchable off with `--no-viewer` for a headless render.

`[invariant]` A deck has two forms and they are renderings of the same blocks. The **paged**
form has a fixed aspect ratio and is what gets projected, printed and measured. The **reading**
form is fluid below 900px. Fit governs the paged form only.

`[decision]` Each component and layout carries its own narrow-screen rules. The engine keeps no
list of what collapses how, so a third-party component is responsive on its own terms.

**Moves from DATA-MODEL** — the Viewer section belongs here in full.

## Surface: the studio

Not built. Design and invariants are in `FEATS.md`; this section records only where it attaches.

It attaches to `serve.ts`, which is why that module exists separately: an editor is a route
added to a server that already rebuilds and pushes reloads, not a rewrite of the CLI.

The loop is: click a handle → the server splices markdown at an offset the pipeline already
computed → rebuild → swap only the sections whose html changed. Measured: a full rebuild is
11.9 ms at 11 pages and 52 ms at 100, almost entirely remark's parse; replacing one section is
0.10 ms against 0.8–6.8 ms for the whole body.

`[invariant]` The studio holds no document state, and nothing anywhere serializes HTML back to
markdown. Those two rules are the whole design.

TODO — the one unsolved piece: `prose` deliberately emits no wrapper, so there is nowhere to
hang a block handle. Solving it without changing what a plain build emits is open.

## Extension points

Three, and all three are folders discovered by scanning at startup. There is no barrel file and
no registration list, so adding one is adding a directory.

    components/<name>/    index.ts, optional style.css, optional script.ts
    layouts/<name>/       style.css, and almost never an index.ts
    themes/<name>/        variables.css, optional styles.css, optional layouts/

`[invariant]` The name is the folder name and appears nowhere inside the folder. A name and its
directory cannot disagree if only one of them exists.

`[decision]` Roots are a list and later ones win by name, so a third-party pack is a directory
and overriding a builtin is naming a folder after it.

Scoping is checked rather than hoped for: a component's every selector must name its own class,
a layout's must name its own page, and a theme may not reach inside a component. The loader
reports violations by name, because CSS has no scope of its own.

**Moves from DATA-MODEL** — the component schema and the theme contract stay there; the
*discovery* mechanism belongs here.

## Deliberately absent

`[decision]` No authored coordinates. Position is derived.

`[decision]` No parser knowledge of components. Parse yields entities and directives; the
grouper consults the registry. That is what keeps the parser testable with no vocabulary loaded
and the vocabulary swappable.

`[decision]` No block naming, no anchors, no span addressing. Directive extent is adjacency.
Derived names break silently on a reword; authored ones tax every block.

`[decision]` No framework in the engine, and none planned in a component. The seam was checked
once and holds at 383 kB for the island; the finding is recorded rather than the code.

## Open

TODO — a second renderer (pptx) is a subset over the plain components, but text measurement has
to be solved separately on that side. Whether that is ever worth it is a vision question, not
an architecture one.

TODO — one source, two projections (a memo and a deck from the same markdown). Parked in
`FEATS.md`; it would be the first thing to genuinely bend this shape.
