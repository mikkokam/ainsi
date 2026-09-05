# Walking skeleton

## Non-linear navigation (feat)

Decks are read asynchronously as often as they are presented, and a reader arriving after the meeting wants to jump rather than page through. The viewer needs an overview: a grid of page thumbnails behind a key, click to go, and a way for a deck to name entry points so a page can link to another page.

The toolbar already has the strip to hang it on and the viewer already tracks the current page. What is missing is the overview itself and an addressing scheme: linking to a page needs a stable name for it, which is the anchor question this project decided against for blocks and would have to answer differently here.

## Local images are not measured (defect)

The fit pass measures with `setContent`, which gives the document no base URL, so a relative `![](pic.png)` resolves against `about:blank` and never loads. Measured just now: a local image reports `naturalHeight: 0` and occupies 31.9px, the height of its alt text, instead of its real height.

So fit silently under-measures every page carrying a local image, and reports a page as fitting when the real output overflows. That is precisely the failure the solver exists to prevent, which makes this the worst defect open.

The fix needs the deck's directory in `fit.ts`, which it currently has no reason to know: serve the deck's own folder to the measuring page, either by giving the measured html a `<base>` or by extending the session's route handler to answer local paths from disk. The route handler is already there for remote responses and only matches `^https?:` today.

Done: a page whose only content is a tall local image is measured at that image's real height, and a deck of local images fits the same way a deck of remote ones does.

## The exported file is not self-contained (feat)

VISION promises one self-contained HTML page, and a deck referencing a local image breaks that promise silently: the html carries a relative src, and the moment it leaves the deck's folder the image is gone. Sharing currently works only for decks whose every asset is a remote URL.

The fix is inlining, not packaging: at build, the CLI reads each local asset an image references and rewrites the src to a base64 data URI. One file, nothing to gather, nothing to zip. Remote URLs stay remote. The cost is a third over the raw image bytes, which compression on the wire mostly returns; the real size lever is downscaling export imagery to what the deck can render, roughly 2000px wide, which saves far more than the encoding costs and can arrive as a later step with a flag to skip it. Inlining belongs in the CLI because the engine has no filesystem, and it is skipped in watch and edit mode, where the dev server already serves the deck's folder and rewritten sources would shift the studio's offsets.

Adjacent to the measurement defect above: a data URI measures the same everywhere, so inlining upstream of the fit pass makes local and remote images fit alike and shrinks what that fix must do. The boundary is slide imagery; a deck carrying video or tens of megabytes of assets is the day a package format earns discussion, and that day names its own feat.

Done: a deck referencing a local image renders, fits and opens correctly from any location as a single html file, and a plain build on a deck with no local assets is byte-identical to today's.

## Density variants (feat)

Every component declares `density` and nothing consumes it. The fit solver is what will, stepping a block to a tighter variant before splitting a page. Each variant needs a class the component's own CSS implements, `pac-<name>--tight`, so the theme is still not involved.

The last unbuilt rung of the ladder, and the least urgent. Scale, block boundary and in-block split between them fit every deck written so far, and this rung's case is narrow: a page a little too tall where a tighter `boxes` or `comparison` saves it and smaller type does not. Worth building when a real deck produces that case, and not before — a variant with nothing asking for it is a guess about what will help.

## Measurement of islands (defect)

The fit solver measures static markup, and an island that changes size when it mounts makes that measurement a lie. The invariant is written down and nothing enforces it.

Cheap now that the machinery exists: `openFit` already holds a page open and `measure` already renders one page and reads its overflow. Measure a page, mount, measure again, report any block that moved.

## PDF export (feat)

The model says HTML is the first target because the browser measures for us, and the viewer is a build option so a headless render for a PDF carries no chrome. Both are true, and there is still no way to get a PDF: no `--pdf`, and no `@page` rules, so printing a deck from a browser gives A4 portrait pages that break wherever they like.

A deck you cannot hand to someone who does not want HTML is half a deck, and the dependency is already paid for — `page.pdf()` is the same headless chromium `--fit` uses, on the same session. Note the order matters: a PDF rendered without fitting first is worse than none, because `overflow: hidden` means the pages that do not fit lose their content silently in the export.

Done: `--pdf` writes one page per deck page at the deck's ratio, `@page` rules so a browser's own print gives the same, and the viewer absent from both.

# The Studio

A visual editor over the same markdown, run by the dev server, never shipped in a deck. A player is not an editor: baking editor code into the exported file would bloat it, and chrome that is not in the markup cannot leak into a print, an export or a measurement.

This supersedes the round-trip editing question, which asked for a writer that could reorder or remove an entity without disturbing the formatting around it. It turns out none is needed for the edits worth making: every entity already carries `node.position.start.offset`, so an edit is a splice into the source string at an offset the pipeline already computed.

`[invariant]` The Studio holds no document state. Selection and the text in an open editor, yes; anything that changes what is rendered goes to the file first and comes back through the engine. The moment the Studio can show something the markdown does not say, there are two writers and a lossy bridge between them, which is the failure every markdown WYSIWYG dies of. This bites hardest on the tempting case, previewing a theme without committing: don't. The theme is one frontmatter line — write it, and make undo a write of the old value rather than a pile of unwritten state.

`[invariant]` Nothing ever serializes HTML back to markdown. Not in the Studio, not anywhere.

`[decision]` The Studio and an agent share one vocabulary and one write path. Both edit markdown by splicing at an offset; if it is literally the same function, the Studio's writes are testable headlessly with no browser, and a human tweak and an agent tweak are the same kind of event.

`[decision]` Every write hashes the file first and refuses on a mismatch. The deck will be open in an editor at the same time, and a splice against a stale offset corrupts the file rather than merely losing an edit.

Measured, so the design rests on numbers rather than hope. Full rebuild is 11.9 ms at 11 pages, 15.4 ms at 25, 52 ms at 100, 223 ms at 400, and it is almost entirely remark's parse — grouping and rendering are free, so the only lever that would ever matter is the parser. Replacing the whole body in the browser costs 0.8 ms at 11 pages and 6.8 ms at 100; replacing one section costs 0.10 ms at any size. A commit round-trips in about 20 ms on a realistic deck, which is well under noticing. Rebuilding per keystroke is not on, and not because of the milliseconds.

## Granular page swap (feat)

A rebuild returns the whole deck, and replacing the body throws away scroll position and anything the reader was doing. At 0.10 ms a section, diff the rendered sections against what is in the DOM and replace only those whose html changed — usually one.

Full re-render on the server, granular replacement in the browser. That pairing is what lets the simple model stay simple without every edit feeling like a page reload. Worth building first because the reload path already exists and this is the smallest thing that makes it feel like an editor.

## The Studio: structural edits (feat)

Change a block's component, delete it, change the page's layout, change the theme, split a page. No caret is involved, they are infrequent and atomic, and a full re-render is what you want because the structure changed.

The whole edit is one comment line. Click a block, pick from the components whose `accepts()` passes for that span, fill the props from the component's own zod schema — validation, defaults and coercion are already one declaration — and splice `<!-- pac: timeline -->` in before the entity the block starts at.

Two handles are needed in the output, emitted in edit mode only and never written into the markdown: a block handle for these edits and an entity handle for the content edits below. Both are derived from ids that already exist. `prose` deliberately emits no wrapper of its own, so there is nothing to hang one on — solving that without changing what a plain build emits is the one real unknown here.

Done: `--edit` on the dev server, handles, a component popover, and a splice endpoint. One directive change, end to end, no content editing. Small enough to throw away if the loop does not feel right, which is the point of doing it first.

## An open editor survives an external change (feat)

External edits already flow into the studio, per the architecture line on equal writers; this row is only the collision. When the reload arrives while a textarea is open, the half-typed text dies silently. Tolerable solo, wrong the moment an agent works the same file while a person edits, which is the flow the whole design invites.

Cheapest honest version: defer the reload while an editor is open and let the hash guard settle the commit, which still discards the text on a true collision, just visibly. The better version carries the draft across the reload and reopens it on the corresponding entity in the new render. Start with the first; the second is the tool's first real multi-writer UX and should wait for the collision to actually hurt.

Done: an external write while a textarea is open never silently discards typed text, whichever version lands.

## The Studio: content edits (feat)

Typing, which is where every editor of this shape goes wrong. The move that avoids it: edit the entity's markdown slice, not the rendered HTML. Clicking a paragraph replaces that one block's rendered output with a plain textarea holding its markdown, usually one to five lines. On blur, splice it back by offset and rebuild.

Markdown stays the only truth, so there is no HTML-to-markdown direction, no second parser and no serializer. There is no caret to preserve across a re-render, because nothing re-renders while you type — the textarea sits outside the rendered tree and the swap happens on commit. The only browser state is which entity is open and what is in it, and it dies on commit.

The cost is that the block being edited shows source rather than its rendered form. For slide content that is small: blocks are short, `- item` and `**bold**` are legible, every other block on the page stays rendered, and the render returns the instant you blur.

`[decision]` No ProseMirror, no Lexical, no editor whose own document model is the truth. That is the only other way to get true WYSIWYG and it reintroduces exactly the state this design exists to avoid. It is also the point where a framework becomes necessary, which is the signal that the line has been crossed rather than a reason to cross it.

## The bare invocation belongs to the human (feat)

`pac deck.md` writes an html file and exits, which is the rarer intent for a person at a terminal once the studio exists, and the wrong door for the daily loop. The identity decision: pac is an editor first and a converter on request. The bare invocation cannot serve both.

`pac deck.md` opens the studio. `pac` alone opens it on a new `untitled.md` in the current directory, `untitled-2.md` if taken; no filename prompt. The filename sits at the top of the studio as an editable field, blur renames the file and retargets the watcher, the same write-through philosophy applied to the path. `pac build deck.md` is the headless door and takes the conversion ergonomics: `-o out.html` or `-o out.pdf` with the format sniffed from the extension, `--to pdf` for a default-named sibling, `--no-viewer` and the rest of the build flags under it. The guard that keeps the flip safe for agents: when stdout is not a TTY the bare form refuses to start a server and answers with the build command instead of blocking.

Refused: `--from`, the input is always markdown; multiple inputs; stdin and stdout piping, deferred until something real composes with pac. `--edit` disappears into the default; `--watch` dies with it unless a read-only preview proves worth keeping.

Depends on the studio feats above for the default to open into; the `pdf` extension arrives with the PDF export feat and the sniffing simply routes to it.

Done: the four invocations above behave as written, a piped `pac deck.md` refuses with guidance, and the README quickstart is one line: `pac deck.md`.

## Playwright out of the default install (chore)

`playwright-core` is an optional dependency that ships no browser binary, but `bun install` still fetches 14 MB of it against a 27 MB tree, for a wrapper most builds never load. Moving it to a dev dependency, with `--fit` and `--pdf` saying what to install, halves a default install and changes nothing else. The degrade path and its test already exist.

# Later

# Open

## What forms a group when nothing matches (question) [guess]

The six heuristics cover the cases seen so far. The guess is that everything else collapsing to `prose` is good enough, and that authors reach for a directive rarely. If in practice most pages need one, grouping is underpowered and the answer is probably a seventh rule rather than a bigger vocabulary. Answered by the three decks above, not by argument.

## One source, two projections (question)

A memo and a deck from the same markdown. A directive naming a deck component means nothing in a document vocabulary, and the file cannot hold two answers. The overlay design that was cut would solve it, at the cost of reintroducing block naming.

Cheaper answers exist and should be tried first: a shared component vocabulary across both output kinds, or a directive that carries a target, `<!-- pac deck: timeline -->`. Not worth deciding until a second projection is actually wanted.

## Do themes and components need a manifest (question)

Discovery is `readdir` plus dynamic `import` in `load.ts`: a component is known by scanning a folder and executing its `index.ts`, a theme by reading its files off disk. That is the one part of loading that assumes a filesystem and runs code to learn what exists, and both assumptions fail anywhere without Bun and a disk: a browser-only build, a hosted studio, a sandbox that may not execute what it enumerates. Today nothing hits this, because every consumer of the component list, including the Studio palette and a theme picker, sits behind the dev server that already loaded them.

A manifest would be a declared list, per root or per pack, of what exists and what shape it takes, so enumeration stops requiring execution. The cost is a second copy of facts the folders already state, which drifts, which is the argument that has kept it out so far.

Answered when a real consumer without a filesystem shows up, not before. The deliverable is one sentence in `ARCHITECTURE.md` either committing to folder scanning as the only discovery and naming the environments that excludes, or naming the manifest as the port and what it carries.
