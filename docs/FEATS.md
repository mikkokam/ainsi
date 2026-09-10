# Walking skeleton

## Syntax highlighting in a fenced block (question)

A fenced block now sets and wraps correctly but every token is one colour, and a deck that quotes a request body or a command is the case that asked for it. The question is whether a deck is a place to read code at all: a slide holds four to six lines before the type is unreadable in a room, and at that length colour buys less than it does in an editor.

If it is worth it, the shape is a build-time pass, never runtime JS in the deck: a highlighter tokenises the fence and emits spans against the theme's status tokens, so a theme keeps deciding what the colours are and a built deck stays one file with nothing to fetch. The cost is a dependency of real size for a feature no sample deck currently uses. Deliverable is a `[decision]` sentence in ARCHITECTURE saying which way, not a library chosen quietly.

## Density variants (feat)

Every component declares `density` and nothing consumes it. The fit solver is what will, stepping a block to a tighter variant before splitting a page. Each variant needs a class the component's own CSS implements, `ainsi-<name>--tight`, so the theme is still not involved.

The last unbuilt rung of the ladder, and the least urgent. Scale, block boundary and in-block split between them fit every deck written so far, and this rung's case is narrow: a page a little too tall where a tighter `boxes` or `comparison` saves it and smaller type does not. Worth building when a real deck produces that case, and not before — a variant with nothing asking for it is a guess about what will help.

## Measurement of islands (defect)

The fit solver measures static markup, and an island that changes size when it mounts makes that measurement a lie.

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

# The engine stops scanning

## The chrome and the component scripts still bundle at run time (feat)

Discovery is static now, but two things still call `Bun.build` while the server runs: the viewer's and the studio's `script.ts`, and a component's own `script.ts` if it has one. Neither is discovery, both are builds of a known input, and both need the file on disk, which a compiled binary does not have.

The chrome is two known entrypoints and moves into the build with everything else the executable needs. A component script is the harder half, because a component is a folder and the thing shipped has to be browser JS rather than the TypeScript that produced it: either a build step emits it beside the component and the list imports it as text, or components stop carrying scripts. Nothing shipped has one today, so the choice can wait, but the islands defect above assumes they exist and would go with them.

Blocks the compiled binary and nothing else. `load.ts` keeps a `root` argument only for this; when it lands, that argument goes too.

# The desktop shell

A native window over the studio the CLI already serves, under `desktop/electrobun`. It starts `ainsi` rooted at home with `--port 0`, reads the URL off its stdout and points a webview at it, so it does not know what a deck is and every feature the studio grows arrives in the app for free. Every native menu item but Open dispatches `ainsi:command` into the page and the studio runs it, so the two menus are one implementation and the shell never learns an endpoint.

It is a dev tool until the row above lands: it runs the checkout it was built against, baked in at build time, and the studio's exports still need the chromium `playwright install` puts there.

## One executable, two entry points (feat)

The app spawns `bun src/cli.ts` from a path baked in at build time, so it runs on one machine, and the CLI is a checkout with a `bun` in front of it. One artefact should be both. The app bundle already carries a Bun and the bundled code, so a shim on `PATH` execs that same Bun against that same code with your arguments: one 60 MB runtime rather than two, and it goes around the launcher, which swallows argv. That is also what makes a brew formula possible.

The grammar changes with it, and this is the breaking change the major version is for. `ainsi` opens a window. `ainsi deck.md` opens a window on that deck, which is what Open With and a double-click do too. `ainsi serve [deck.md]` is what v1 does today, under a name: it prints a URL and opens nothing. `ainsi build` is untouched, because that is the agent's surface and agents already have it. Verbs for modes and flags for options, so no `-serve`. `ainsi deck.md` with no display fails saying `serve` or `build`, the way the no-terminal guard does now.

Refused: claiming `.md` as the default handler, which would make every markdown file on the machine open a presentation tool. Open With and an explicit association are enough. Depends on static registries. Done is a brew formula, and `ainsi build deck.md` working on a machine with no bun and no checkout.

## `~/.ainsi`, and what may never live there (feat)

Two things below want somewhere to keep a preference: the last folder a deck was saved into, and a folder of your own themes. Neither can use web storage, because the app runs the studio on `--port 0` and the origin is a different `localhost:NNNNN` every launch, so anything in `localStorage` is wiped between sessions and appears to work exactly once. The server is the only writer either surface has in common, so preferences go through an endpoint and land in `~/.ainsi/`.

`[invariant]` Nothing a deck needs in order to render may live there. The moment a deck depends on a file in `~/.ainsi` to look right, decks stop being portable and the folder is a database. Preferences and installed themes are the line: a deck naming a theme you have and a stranger does not degrades to the default with a warning, which is the same thing that happens today when a theme folder beside a deck is missing.

Plain files, one per thing, readable and editable by hand. Refused: SQLite, which is a database for six scalars and puts a binary in the one folder whose appeal is that you can open it.

Not this: the scroll position and the reopen target, which are already `sessionStorage` under `ainsi-scroll` and `ainsi-reopen` and belong there. They exist to survive the full reload the studio does on every rebuild, seconds apart, in one tab. A file would cost a write and a read per rebuild and would leak between two windows on the same deck.

## The app knows it is an app (feat)

The studio serves one page whether it is in a browser tab or a native window, so the app shows the web chooser, which is written for a browser, and puts its chrome over the deck. The shell already announces itself in `AINSI_HOST`; the server putting that on the body as a data attribute is the whole mechanism, and the chrome branches on it.

A launch with no deck shows a landing page: themes across the top, and beneath them the decks you have been in. This replaces an earlier guess that it should show an empty window, on the grounds that recents is state and the studio holds none. It is not state. Ordering markdown files under the root by mtime is a recents list, derived from disk each time, which is what the home page below already specifies.

It is one component, served to a browser tab and to a window alike, and it is quiet: type, rules, and the theme tiles carrying the only colour on the page, which is the themes' own. Whatever else earns a place there earns it later, and the candidates are settings, which do not exist yet, and a button that reveals the themes folder, which does. Refused: anything that needs a second screen to explain.

Hiding the chrome is what makes the gap visible: every action it holds has to exist as a native item, and `Theme…` already does not. It has no command name, so on a desktop with the chrome hidden there is no way to change a theme. Whether the answer is a native submenu listing the themes or a command that opens the studio's own drill is part of this row.

The chrome moves into a toolbar along the top rather than sitting over the content. One constraint decides how far that goes: studio chrome is injected at runtime and never ships in a deck, so a studio toolbar is free, while the viewer's toolbar ships inside the built HTML and is in the print path, so anything moved there has to stay invisible to print, to export and to measurement.

## The menus the app is missing (feat)

The File menu holds New, Open, Export, Print and Close, Edit holds the clipboard roles plus two studio commands, and that is all of it. Four things are wrong with that and one of them is live now.

Print was in the menu and did nothing, and is gone. The command ran `window.print()`, which the app's webview ignores, and the Electrobun SDK has no print call either, so there is no native path to swap in. Printing from the app needs the shell to gain one; until then the answer is Export a PDF, which works. A browser tab keeps its own ⌘P, which was never ours.

View and Slideshow landed, from the viewer rather than the studio: a built deck presents with no server anywhere near it, so the viewer grew its own `ainsi:command` listener beside the `ainsi:menu` and `ainsi:keys` it already dispatched. `[decision]` Play means from the page in view, and Play from Start is the second item, because a deck is open at a page for a reason.

Edit's clipboard items and an Insert menu landed with selection. What is left in Edit is Select All, which is still the webview's role and selects text rather than blocks.

Insert names the kinds the parser has, which cannot drift, and the in-page palette adds which components each kind can be shown as by asking the registry through `/__doc` rather than keeping a second list. Duplicate is a copy put straight after the original rather than through the clipboard, so it neither asks a permission nor takes what was on it.

What is left of this row: the window's own toolbar, Save As, and the `(+)` moving from the top-left of a rail to under whatever is selected, which is where the thing it makes will appear.

File ▸ New Window waits on a deck being a URL, below. Two windows today would be two servers over one folder.

`[guess]` Save As is the same primitive as the deck export and as picking a theme: all three copy what a deck references into a folder that is not the one it is in. If that turns out to be true it is written once and called three times, and if it does not, Save As is a copy of one markdown file and quietly breaks every relative image in it.

## One way to make a deck (feat)

`New presentation` writes `untitled.md` into whatever folder the studio is rooted at, which for an app launched from an icon is the person's home directory. Nobody asked for that file and nobody asked for it there.

Not saving until asked is not available, and the reason is sharper than the render. A deck's images and its own theme folder resolve relative to the deck, so a draft written somewhere temporary and moved later is not a deferral, it is a rename that breaks every relative path in it. A drafts folder the app owns is the same problem plus a folder nobody asked for.

So a theme tile is the gesture: click one, get a native save panel with the name filled in and the folder defaulted to the last one used, and Enter is enough. The theme is one frontmatter line and the most reversible thing in the file, which is why it is a reasonable first question. File ▸ New opens the same picker, because two gestures that both create a deck are two behaviours that will drift. The browser has no native panel and should not pretend to: there the picker leads to the folder drill-down and a name field, which is what the chooser already is.

## Where your own themes live (feat)

A theme of yours lives in `themes/` in the checkout. After the shipping app there is no checkout and the shipped themes are inside the bundle, so a brand theme has nowhere to be. This is a hole the shipping app opens rather than one that exists today.

A library under `~/.ainsi/themes`, and an **Install a theme** button beside the tiles that validates a folder and copies it in. Picking one for a deck copies that folder beside the deck and writes `theme: ./acme`, so nothing ever points into `~/.ainsi` and the invariant above holds unchanged. The library is where a theme is kept, never where a deck reads it from.

`[invariant]` A bare name in frontmatter means a theme every ainsi has. A user theme in that namespace would not merely go missing on another machine, it would render the same deck differently on two machines that each have a theme called `acme`, and say nothing. Silent divergence is worse than the absence, which already warns and falls back to the default tokens.

The cost is copies: ten decks on your brand theme are ten folders, and changing the theme changes one of them. That is the right trade for now, because the alternative is ten decks that are wrong somewhere else, and a built deck carries its theme inlined anyway. A sync-from-library gesture is the answer if the copies start to hurt, and not before.

This does not reopen the static registry decision. A theme is CSS and that decision keeps data read from disk; every shipped theme's layout overrides are already CSS only, so a theme folder is never executed.

`[guess]` A tile is drawn from `--ainsi-ink`, `--ainsi-accent` and `--ainsi-ground` read out of the theme's own `variables.css`, rather than from a rendered sample. A rendering has no build step to happen at for a theme installed thirty seconds ago, and three tokens is a truer picture of a theme than one sample page anyway. Also wanted, and one button rather than a paragraph of explanation: reveal the themes folder.

## Sending one file (question)

A built `.html` is self-contained: the theme's CSS is inlined and every local image is base64 at build time. A `.md` is not, and never was. Send one markdown file and the recipient gets it without its images and, if it names a theme beside it, without its look.

Nothing is broken here and nothing may need building. The question is whether the studio should say so at the moment it matters, and where. A deck that names a relative theme or references a local image is a deck whose markdown does not travel alone, which the engine already knows at build time and reports to nobody.

`--to zip` now packs the deck and what it references, so there is an answer to give. The question left is whether the studio should say so unprompted, at the moment it matters, and where. The deliverable is a sentence in `ARCHITECTURE.md` about which artefact is the portable one, or a diagnostic, or the finding that people already understand this and it needs neither. Also open: a theme's font `@import` is a network fetch, so a built deck read offline falls back to system type, which is the one part of "self-contained" that is not.

## Measurement without a separate browser (feat)

`--fit`, PDF and PPTX all go through `playwright-core` and a chromium the person installed themselves, which is a reasonable thing to ask of a checkout and an impossible one to ask of someone who double-clicked an icon. Today the shell inherits the CLI's degradation: no browser, one diagnostic, unfitted pages.

The shell already contains a webview that lays out the same html the solver measures. Driving that instead of launching a second browser drops the dependency, the 150 MB it would otherwise cost to bundle, and the divergence between what was measured and what is shown. The `FitSession` port already exists and hides which browser is behind it, so this is a second implementation of it rather than a change to the solver.

Depends on nothing above; blocks the shipping app only if the shipping app is expected to export.

## The beta pin (defect)

`desktop/electrobun` is pinned to Electrobun `2.0.2-beta.17` because the stable template catalog is broken against the Hutch its npm bootstrap installs. The SDK also arrives from a projected devkit rather than npm, so it is not in a lockfile the way every other dependency here is.

Nothing is wrong today and the shell works. This is a row so that the pin is not mistaken for a choice: when stable resolves, move to it and say so.

# A deck is a URL

## Home, and a deck at its path (feat)

The studio is already a Bun server driving watch, rebuild, reload over a file, so hosting it is a container, one mounted folder as the root, and the same loop. Remote agents keep their door: git as transport first, or one HTTP pair, GET returns the markdown and PUT replaces it, which is the whole remote API because the write model is already whole-file. An MCP wrapper over that pair is an afternoon whenever it is wanted and not before; building the remote door before there is a remote is the over-engineering to refuse.

Everything is a URL. Home is `/`, a deck is its path under the root, opening is navigation and closing is the back button or a home link top-left beside the filename field, so no session object exists and "what was open" is the browser's history, not the server's problem. The CLI and the container are the same server: `ainsi serve deck.md` starts it and deep-links into the deck's URL, `ainsi serve` and the container start at `/`.

Home is a list, not a desktop: a type-to-filter field, md files ordered by mtime with their path beneath, and one New deck button. The mtime order is the recents list, and it is why no recents list is ever written down. All of it derived from disk each request; the server stores nothing. The audience is people driving Claude on local files and terminal-first devs who know markdown and hate PPT, so the intuitions to serve are files, URLs, and type-to-find, never a ribbon or a document manager.

Refused: the desktop metaphor; thumbnails, because a hundred stale renders on a launcher is its own project; multi-root and an add-repo list, until one mount stops being enough, at which point it is one JSON list under `~/.ainsi`; any auth layer while the bind address is localhost or the tailnet, where a password prompt is theatre.

Done: the container serves home and deck URLs off one mounted folder, a remote writer can read and replace a file through one of the doors above, and a cold restart loses nothing because nothing was held.

## Several decks at once (feat)

Two presentations side by side is the thing a window makes obvious and the current design cannot do: the studio has one deck at a time, the root is fixed when it starts, and the File menu restarts it to move. Two windows today would be two servers, two ports and two watchers over the same folder.

It is not a separate feat so much as the last consequence of the row above. Once a deck is a URL, a second window is a second URL against one studio, the File menu stops restarting anything, and the desktop app and the hosted studio stop being two designs. Done is two decks open in two windows, an edit in one leaving the other alone, and closing either leaving the studio up.

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

## Multi-user editing (feat)

Two humans typing in the same deck at once, which nothing today supports and nothing today needs. Deferred deliberately, not dropped: as long as the file stays the only mutation point, a CRDT arrives as a retrofit behind that door. The service holds the document as one CRDT text, a file write from any writer is text-diffed into it, a live client's edits export back to the file. Plain markdown makes the retrofit lossless because a whole-file text diff reconstructs everything; there is no rich schema or live editor state to migrate.

Refused now: picking a library (y.js, Loro, Automerge), because a persisted snapshot format chosen early is the one way deferral could still bind; per-block CRDT containers, because block identity is unstable under markdown edits and one text container merges fine; any CRDT surface for agents, which keep writing markdown through the same door while the service diffs their writes in like anyone else's. Depends on the hosted studio; opens only when simultaneous typing is real, and it flips the truth statement in ARCHITECTURE, so it is a pivot the maintainer opens.

## What forms a group when nothing matches (question) [guess]

A list renders as written, bullets or numbers, until a directive names timeline or boxes: the studio made the old guess visible, an author reading "auto · timeline" over a list they meant as bullets, and it went. The heuristics that remain pick a form for a heading at the top of a page, a table and an image, on the guess that plain rendering of those rarely fits a page. If a table or an image turns out to want the same treatment as lists, the answer is deleting that rule too, and the studio's show-as dropdown is where the author says otherwise. Answered by the three decks above, not by argument.

## One source, two projections (question)

A memo and a deck from the same markdown. A directive naming a deck component means nothing in a document vocabulary, and the file cannot hold two answers. The overlay design that was cut would solve it, at the cost of reintroducing block naming.

Cheaper answers exist and should be tried first: a shared component vocabulary across both output kinds, or a directive that carries a target, `<!-- ainsi deck: timeline -->`. Not worth deciding until a second projection is actually wanted.
