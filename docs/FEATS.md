# Walking skeleton

## Syntax highlighting in a fenced block (question)

A fenced block now sets and wraps correctly but every token is one colour, and a deck that quotes a request body or a command is the case that asked for it. The question is whether a deck is a place to read code at all: a slide holds four to six lines before the type is unreadable in a room, and at that length colour buys less than it does in an editor.

If it is worth it, the shape is a build-time pass, never runtime JS in the deck: a highlighter tokenises the fence and emits spans against the theme's status tokens, so a theme keeps deciding what the colours are and a built deck stays one file with nothing to fetch. The cost is a dependency of real size for a feature no sample deck currently uses. Deliverable is a `[decision]` sentence in ARCHITECTURE saying which way, not a library chosen quietly.

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

## A cropped field cannot be stepped down (defect)

`tiles` caps a picture's height in em, so the fit solver's type step takes the field down with everything else and a page that is a little too tall becomes a page that fits. Under `crop` that cap is `none`: the cell's height comes from its width, the width comes from the column count, and the type step moves neither. A cropped field that overflows is therefore clipped and warned about rather than reduced, which is the one outcome the ladder exists to avoid.

Seen on a photographer's contact sheet: six pictures, three columns, and the page missed by about a tenth. Four columns fit, but choosing the column count to satisfy the solver is the author doing the solver's job.

The fix is a cap that survives cropping: the cell keeps its aspect ratio and takes a `max-height` in em the same way an uncropped picture does, so the row shrinks when the type does. Done is a page like that one fitting at three columns, and no warning.

# Later

## A generated reference (feat)

`docs/guide/` is written by hand, and half of it restates what the code already declares: every prop table under Components and Layouts is a copy of a zod schema, and a prop added without touching the guide leaves a page that is quietly wrong. The skill is a third copy of the same grammar, kept deliberately short for an agent to read whole.

Generate those pages from the registry instead: walk the components and layouts, emit `about`, what each accepts, whether it splits, and the props with their defaults. Then the hand-written pages keep only what no schema holds, which is most of Writing, Themes, the CLI and the studio.

Done is a build step plus a test that fails when a generated page is stale, so the copy cannot drift silently. A site rendering the same pages comes after that, if ever; the drift is the problem, the site is a nicety.

## A header page with no picture (defect)

The `header` layout draws the placeholder graphic when its page holds no image: the grey mountain-and-sun stands in for a picture nobody asked for, behind the title. Writing a cover as type on paper is a reasonable thing to want, and today it needs the `default` layout with a tone instead.

Either the layout renders as plain type when there is no image on the page, or it says so in a warning. Silently inventing a picture is the one thing it should not do.

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
