# The Studio


## A cropped field cannot be stepped down (defect)

`tiles` caps a picture's height in em, so the fit solver's type step takes the field down with everything else and a page that is a little too tall becomes a page that fits. Under `crop` that cap is `none`: the cell's height comes from its width, the width comes from the column count, and the type step moves neither. A cropped field that overflows is therefore clipped and warned about rather than reduced, which is the one outcome the ladder exists to avoid.

Seen on a photographer's contact sheet: six pictures, three columns, and the page missed by about a tenth. Four columns fit, but choosing the column count to satisfy the solver is the author doing the solver's job.

The fix is a cap that survives cropping: the cell keeps its aspect ratio and takes a `max-height` in em the same way an uncropped picture does, so the row shrinks when the type does. Done is a page like that one fitting at three columns, and no warning.


## The chrome and the component scripts still bundle at run time (defect)

Discovery is static now, but two things still call `Bun.build` while the server runs: the viewer's and the studio's `script.ts`, and a component's own `script.ts` if it has one. Neither is discovery, both are builds of a known input, and both need the file on disk, which a compiled binary does not have.

The chrome is two known entrypoints and moves into the build with everything else the executable needs. A component script is the harder half, because a component is a folder and the thing shipped has to be browser JS rather than the TypeScript that produced it: either a build step emits it beside the component and the list imports it as text, or components stop carrying scripts.

Blocks the compiled binary and nothing else. `load.ts` keeps a `root` argument only for this; when it lands, that argument goes too.


## One executable, two entry points (feat)

The app spawns `bun src/cli.ts` from a path baked in at build time, so it runs on one machine, and the CLI is a checkout with a `bun` in front of it. One artefact should be both. The app bundle already carries a Bun and the bundled code, so a shim on `PATH` execs that same Bun against that same code with your arguments: one 60 MB runtime rather than two, and it goes around the launcher, which swallows argv. That is also what makes a brew formula possible.

The grammar changes with it, and this is the breaking change the major version is for. `ainsi` opens a window. `ainsi deck.md` opens a window on that deck, which is what Open With and a double-click do too. `ainsi serve [deck.md]` is what v1 does today, under a name: it prints a URL and opens nothing. `ainsi build` is untouched, because that is the agent's surface and agents already have it. Verbs for modes and flags for options, so no `-serve`. `ainsi deck.md` with no display fails saying `serve` or `build`, the way the no-terminal guard does now.

Refused: claiming `.md` as the default handler, which would make every markdown file on the machine open a presentation tool. Open With and an explicit association are enough. Depends on static registries. Done is a brew formula, and `ainsi build deck.md` working on a machine with no bun and no checkout.

## One way to make a deck (feat)

`New presentation` writes `untitled.md` into whatever folder the studio is rooted at, which for an app launched from an icon is the person's home directory. Nobody asked for that file and nobody asked for it there.

Not saving until asked is not available, and the reason is sharper than the render. A deck's images and its own theme folder resolve relative to the deck, so a draft written somewhere temporary and moved later is not a deferral, it is a rename that breaks every relative path in it. A drafts folder the app owns is the same problem plus a folder nobody asked for.

So a theme tile is the gesture: click one, get a native save panel with the name filled in and the folder defaulted to the last one used, and Enter is enough. The theme is one frontmatter line and the most reversible thing in the file, which is why it is a reasonable first question. File ▸ New opens the same picker, because two gestures that both create a deck are two behaviours that will drift. The browser has no native panel and should not pretend to: there the picker leads to the folder drill-down and a name field, which is what the chooser already is.


## The beta pin (defect)

`desktop/electrobun` is pinned to Electrobun `2.0.2-beta.17` because the stable template catalog is broken against the Hutch its npm bootstrap installs. The SDK also arrives from a projected devkit rather than npm, so it is not in a lockfile the way every other dependency here is.

Nothing is wrong today and the shell works. This is a row so that the pin is not mistaken for a choice: when stable resolves, move to it and say so.


## Several decks at once (feat)

Two presentations side by side is the thing a window makes obvious and the current design cannot do: the studio has one deck at a time, the root is fixed when it starts, and the File menu restarts it to move. Two windows today would be two servers, two ports and two watchers over the same folder.

It is not a separate feat so much as the last consequence of the row above. Once a deck is a URL, a second window is a second URL against one studio, the File menu stops restarting anything, and the desktop app and the hosted studio stop being two designs. Done is two decks open in two windows, an edit in one leaving the other alone, and closing either leaving the studio up.

# Later

## A generated reference (feat)

`docs/guide/` is written by hand, and half of it restates what the code already declares: every prop table under Components and Layouts is a copy of a zod schema, and a prop added without touching the guide leaves a page that is quietly wrong. The skill is a third copy of the same grammar, kept deliberately short for an agent to read whole.

Generate those pages from the registry instead: walk the components and layouts, emit `about`, what each accepts, whether it splits, and the props with their defaults. Then the hand-written pages keep only what no schema holds, which is most of Writing, Themes, the CLI and the studio.

Done is a build step plus a test that fails when a generated page is stale, so the copy cannot drift silently. A site rendering the same pages comes after that, if ever; the drift is the problem, the site is a nicety.


## Granular page swap (feat)

Every rebuild is a full `location.reload()`, and the studio carries state to make that invisible: scroll position and the reopen target parked in sessionStorage, the hold counter that defers a reload while an editor is open, the read-only textarea that hides the flash. It works, and nothing a person does solo shows a symptom. What does show is narrow: an external writer, an agent working the file while a person watches, drops presenting, the grid or the menu back to the reading view at the same slide.

The build: on the reload event fetch the page, parse it, replace only the `.ainsi-page` sections whose markup changed, append or remove tail pages when a split changes the count, refetch the doc for fresh offsets. The viewer re-queries its pages instead of capturing them once. Roughly the lines it deletes, so the payoff is the machinery going and presenting surviving a rebuild, not the milliseconds; full re-render on the server stays.

Nice to have. Opens when the agent-writes-while-presenting flow is in daily use and the drop starts to grate, not before.

## Multi-user editing (feat)

Two humans typing in the same deck at once, which nothing today supports and nothing today needs. Deferred deliberately, not dropped: as long as the file stays the only mutation point, a CRDT arrives as a retrofit behind that door. The service holds the document as one CRDT text, a file write from any writer is text-diffed into it, a live client's edits export back to the file. Plain markdown makes the retrofit lossless because a whole-file text diff reconstructs everything; there is no rich schema or live editor state to migrate.

Refused now: picking a library (y.js, Loro, Automerge), because a persisted snapshot format chosen early is the one way deferral could still bind; per-block CRDT containers, because block identity is unstable under markdown edits and one text container merges fine; any CRDT surface for agents, which keep writing markdown through the same door while the service diffs their writes in like anyone else's. Depends on the hosted studio; opens only when simultaneous typing is real, and it flips the truth statement in ARCHITECTURE, so it is a pivot the maintainer opens.

## Density variants (feat)

Every component declares `density` and nothing consumes it. The fit solver is what will, stepping a block to a tighter variant before splitting a page. Each variant needs a class the component's own CSS implements, `ainsi-<name>--tight`, so the theme is still not involved.

The last unbuilt rung of the ladder, and the least urgent. Scale, block boundary and in-block split between them fit every deck written so far, and this rung's case is narrow: a page a little too tall where a tighter `boxes` or `comparison` saves it and smaller type does not. Worth building when a real deck produces that case, and not before — a variant with nothing asking for it is a guess about what will help.

## Measurement of islands (defect)

The fit solver measures static markup, and an island that changes size when it mounts makes that measurement a lie.

Cheap now that the machinery exists: `openFit` already holds a page open and `measure` already renders one page and reads its overflow. Measure a page, mount, measure again, report any block that moved.
