# Walking skeleton

## Density variants (feat)

Every component declares `density` and nothing consumes it. The fit solver is what will, stepping a block to a tighter variant before splitting a page. Each variant needs a class the component's own CSS implements, `ainsi-<name>--tight`, so the theme is still not involved.

The last unbuilt rung of the ladder, and the least urgent. Scale, block boundary and in-block split between them fit every deck written so far, and this rung's case is narrow: a page a little too tall where a tighter `boxes` or `comparison` saves it and smaller type does not. Worth building when a real deck produces that case, and not before — a variant with nothing asking for it is a guess about what will help.

## Measurement of islands (defect)

The fit solver measures static markup, and an island that changes size when it mounts makes that measurement a lie. The invariant is written down and nothing enforces it.

Cheap now that the machinery exists: `openFit` already holds a page open and `measure` already renders one page and reads its overflow. Measure a page, mount, measure again, report any block that moved.

# The Studio

A visual editor over the same markdown, run by the dev server, never shipped in a deck. A player is not an editor: baking editor code into the exported file would bloat it, and chrome that is not in the markup cannot leak into a print, an export or a measurement.

This supersedes the round-trip editing question, which asked for a writer that could reorder or remove an entity without disturbing the formatting around it. It turns out none is needed for the edits worth making: every entity already carries `node.position.start.offset`, so an edit is a splice into the source string at an offset the pipeline already computed.

`[invariant]` The Studio holds no document state. Selection and the text in an open editor, yes; anything that changes what is rendered goes to the file first and comes back through the engine. The moment the Studio can show something the markdown does not say, there are two writers and a lossy bridge between them, which is the failure every markdown WYSIWYG dies of. This bites hardest on the tempting case, previewing a theme without committing: don't. The theme is one frontmatter line — write it, and make undo a write of the old value rather than a pile of unwritten state.

`[invariant]` Nothing ever serializes HTML back to markdown. Not in the Studio, not anywhere.

`[decision]` The Studio and an agent share one vocabulary and one write path. Both edit markdown by splicing at an offset; if it is literally the same function, the Studio's writes are testable headlessly with no browser, and a human tweak and an agent tweak are the same kind of event.

`[decision]` Every write hashes the file first and refuses on a mismatch. The deck will be open in an editor at the same time, and a splice against a stale offset corrupts the file rather than merely losing an edit.

Measured, so the design rests on numbers rather than hope. Full rebuild is 11.9 ms at 11 pages, 15.4 ms at 25, 52 ms at 100, 223 ms at 400, and it is almost entirely remark's parse — grouping and rendering are free, so the only lever that would ever matter is the parser. Replacing the whole body in the browser costs 0.8 ms at 11 pages and 6.8 ms at 100; replacing one section costs 0.10 ms at any size. A commit round-trips in about 20 ms on a realistic deck, which is well under noticing. Rebuilding per keystroke is not on, and not because of the milliseconds.

# Later

## A reference for the grammar (feat)

Nothing states the directive syntax in full, the frontmatter keys, the props each component and layout accepts, or what the studio's menus do. That knowledge lives in `src/components/*/index.ts` as `about` strings and zod schemas, and in the skill, which teaches an agent rather than a person. The README is the pitch and the tour and deliberately stops at naming the components.

The repo is public now, so a reader who is not driving Claude Code has nowhere to go after the README.

Done is a site generated from the definitions, not written beside them: a component that gains a prop gains a documented prop, and a renamed one cannot leave a stale page behind. Hand-written pages on top of that for the frontmatter, writing a theme, and the studio's own gestures. Prose restating the zod schemas by hand is the failure to avoid; it is stale inside a week and then it outvotes the code.

## Granular page swap (feat)

Every rebuild is a full `location.reload()`, and the studio carries state to make that invisible: scroll position and the reopen target parked in sessionStorage, the hold counter that defers a reload while an editor is open, the read-only textarea that hides the flash. It works, and nothing a person does solo shows a symptom. What does show is narrow: an external writer, an agent working the file while a person watches, drops presenting, the grid or the menu back to the reading view at the same slide.

The build: on the reload event fetch the page, parse it, replace only the `.ainsi-page` sections whose markup changed, append or remove tail pages when a split changes the count, refetch the doc for fresh offsets. The viewer re-queries its pages instead of capturing them once. Roughly the lines it deletes, so the payoff is the machinery going and presenting surviving a rebuild, not the milliseconds; full re-render on the server stays.

Nice to have. Opens when the agent-writes-while-presenting flow is in daily use and the drop starts to grate, not before.

## Hosted studio (feat)

The studio is already a Bun server driving watch, rebuild, reload over a file, so hosting it is a container, one mounted folder as the root, and the same loop. Remote agents keep their door: git as transport first, or one HTTP pair, GET returns the markdown and PUT replaces it, which is the whole remote API because the write model is already whole-file. An MCP wrapper over that pair is an afternoon whenever it is wanted and not before; building the remote door before there is a remote is the over-engineering to refuse.

Everything is a URL. Home is `/`, a deck is its path under the root, opening is navigation and closing is the back button or a home link top-left beside the filename field, so no session object exists and "what was open" is the browser's history, not the server's problem. The CLI and the container are the same server: `ainsi deck.md` starts it and deep-links into the deck's URL, the container starts at `/`.

Home is a list, not a desktop: a type-to-filter field, md files ordered by mtime with their path beneath, and one New deck button doing what bare `ainsi` does. All of it derived from disk each request; the server stores nothing. The audience is people driving Claude on local files and terminal-first devs who know markdown and hate PPT, so the intuitions to serve are files, URLs, and type-to-find, never a ribbon or a document manager.

Refused: the desktop metaphor; thumbnails, because a hundred stale renders on a launcher is its own project; multi-root and an add-repo list, until one mount stops being enough, at which point it is one JSON list under `~/.ainsi`; any auth layer while the bind address is localhost or the tailnet, where a password prompt is theatre.

Done: the container serves home and deck URLs off one mounted folder, a remote writer can read and replace a file through one of the doors above, and a cold restart loses nothing because nothing was held.

## Multi-user editing (feat)

Two humans typing in the same deck at once, which nothing today supports and nothing today needs. Deferred deliberately, not dropped: as long as the file stays the only mutation point, a CRDT arrives as a retrofit behind that door. The service holds the document as one CRDT text, a file write from any writer is text-diffed into it, a live client's edits export back to the file. Plain markdown makes the retrofit lossless because a whole-file text diff reconstructs everything; there is no rich schema or live editor state to migrate.

Refused now: picking a library (y.js, Loro, Automerge), because a persisted snapshot format chosen early is the one way deferral could still bind; per-block CRDT containers, because block identity is unstable under markdown edits and one text container merges fine; any CRDT surface for agents, which keep writing markdown through the same door while the service diffs their writes in like anyone else's. Depends on the hosted studio; opens only when simultaneous typing is real, and it flips the truth statement in ARCHITECTURE, so it is a pivot the maintainer opens.

## What forms a group when nothing matches (question) [guess]

A list renders as written, bullets or numbers, until a directive names timeline or boxes: the studio made the old guess visible, an author reading "auto · timeline" over a list they meant as bullets, and it went. The heuristics that remain pick a form for a heading at the top of a page, a table and an image, on the guess that plain rendering of those rarely fits a page. If a table or an image turns out to want the same treatment as lists, the answer is deleting that rule too, and the studio's show-as dropdown is where the author says otherwise. Answered by the three decks above, not by argument.

## One source, two projections (question)

A memo and a deck from the same markdown. A directive naming a deck component means nothing in a document vocabulary, and the file cannot hold two answers. The overlay design that was cut would solve it, at the cost of reintroducing block naming.

Cheaper answers exist and should be tried first: a shared component vocabulary across both output kinds, or a directive that carries a target, `<!-- ainsi deck: timeline -->`. Not worth deciding until a second projection is actually wanted.

## Do themes and components need a manifest (question)

Discovery is `readdir` plus dynamic `import` in `load.ts`: a component is known by scanning a folder and executing its `index.ts`, a theme by reading its files off disk. That is the one part of loading that assumes a filesystem and runs code to learn what exists, and both assumptions fail anywhere without Bun and a disk: a browser-only build, a hosted studio, a sandbox that may not execute what it enumerates. Today nothing hits this, because every consumer of the component list, including the Studio palette and a theme picker, sits behind the dev server that already loaded them.

A manifest would be a declared list, per root or per pack, of what exists and what shape it takes, so enumeration stops requiring execution. The cost is a second copy of facts the folders already state, which drifts, which is the argument that has kept it out so far.

Answered when a real consumer without a filesystem shows up, not before. The deliverable is one sentence in `ARCHITECTURE.md` either committing to folder scanning as the only discovery and naming the environments that excludes, or naming the manifest as the port and what it carries.
