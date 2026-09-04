# Data model

The pipeline is five stages. Each stage takes one shape and produces the next. One artefact is authored: the markdown.

    content.md ──parse─────▶ Entity[] + Directive[]
                ──paginate──▶ page candidates
                ──group─────▶ Block[]
                ──fit───────▶ Page[]
                ──render────▶ blocks into a layout, into output

`[invariant]` The content file may carry form selection. It may not carry style. "This list is a timeline" belongs in the content, the way `class="hero"` does. What a timeline looks like belongs to the theme, and no deck ever says.

## Entity

An entity is one markdown block, split exactly where markdown already splits. Paragraphs are separate. A list is one entity, not one per item. This is the whole point: the page is a set of entities, not a flow of text.

    type EntityKind =
        | "heading" | "paragraph" | "list" | "table" | "image"
        | "code" | "quote" | "break";

    interface Entity {
        id: EntityId;           // "e:<hash>:<n>", derived, never authored
        kind: EntityKind;
        depth?: number;         // heading level, 1..6
        ordered?: boolean;      // list only
        text: string;           // plain text, for heuristics and measurement
        md: string;             // the original source slice
        ast: MdastNode;         // parsed, for rendering inline marks
    }

An image that stands alone is an entity. An image inside a paragraph is not: it is inline content of that paragraph, and it renders inline. That distinction is the parser's, not a selection.

`break` is the entity produced by `---`. It ends a page candidate and keeps the layout. `[decision]` An `h1` also starts a new page by default; the policy is deck-level and can be turned off.

Ids are content hashes plus an ordinal for duplicates. They are internal: they key measurement caches and build diagnostics, and nothing in the content file ever refers to one.

## Directive

A directive is an HTML comment on its own line, namespaced, governing the entities that follow it. `layout` is reserved and addresses the page instead.

    <!-- pac: timeline axis=horizontal -->
    <!-- pac:layout header align=center -->

    interface Directive {
        component: string;
        props: Record<string, string>;
        after: EntityId;        // the entity it was found before
    }

`[decision]` HTML comment, not `{.attr}` and not `[component]: # "..."`. The attribute form must sit on the first line of the block it modifies, which conflates it with the content and reads badly, and on its own line it renders as visible text in Obsidian. The link-reference form is invisible in a strict CommonMark renderer but is a link definition, so a linter will flag it as unused and a formatter may move it. The comment form is invisible everywhere, is left alone by formatters, and is what Marp, prettier and markdownlint already use for block directives.

`[decision]` The `pac:` prefix is required. Without a namespace, every comment already in a file becomes a directive.

`[invariant]` A directive names a component and its props. It never names a colour, a size in pixels, a font or a position. A directive that would only make sense against one theme is a bug in the vocabulary, not a feature.

`[decision]` `layout` is a reserved first word, so no component may be named `layout`. One
directive form rather than two is worth the one lost name.

### Extent

A component directive governs from the entity that follows it until the next directive, the next page boundary, or the end of the document, whichever comes first. Extent is adjacency, which is why the model needs no anchors and no way to address a span by name.

A layout directive starts a page and governs that page alone. Writing one next to an `h1`
produces one page rather than an empty one, since an empty candidate is dropped. Two
directives on one page is a warning and the last wins, and an unknown name leaves the page on
the deck's own layout.

`[decision]` Page scope, not sticky. A sticky layout fails silently and without bound: a
forgotten reset restyles every page after it and nothing warns, and reordering pages can
change the layout of pages nobody touched. A missing directive costs one visibly wrong page.
Bounded and local beats unbounded and non-local.

`[decision]` A deck with a house layout declares it once in frontmatter, which is the case
sticky was for, kept where deck-wide facts already live and where it can be read without
scrolling.

## Block

A block is a contiguous span of entities rendered by one component.

    interface Block {
        id: BlockId;            // the id of the first entity in the span
        span: [EntityId, EntityId];
        component: string;
        props: Record<string, unknown>;
        origin: "directive" | "heuristic";
    }

`[invariant]` Blocks partition the entity stream. Every entity belongs to exactly one block, in source order, no gaps and no overlap.

### Default grouping

`[invariant]` Zero directives must already produce a good deck. Heuristics do the grouping and the component choice; a directive exists only where the author disagrees.

The heuristics, in order:

- A heading followed by exactly one paragraph, alone on a page, is a `lead`.
- A list whose items all match `<label>: <text>` is a `timeline`.
- A list of two to five short items with no sentence punctuation is `boxes`.
- A two-column table, or a label column plus two, is a `comparison`; anything wider stays a `table`.
- A standalone image followed by a paragraph is an `aside`; an image alone is a `full`.
- Anything unmatched is `prose`, which absorbs the run of ordinary blocks around it.

`[decision]` Timeline is tested before boxes. `Q1: Datamalli` items satisfy both rules, and the labelled reading is the specific one. `prose` never absorbs past an entity a directive claims or one another rule could match, or it swallows the list behind a heading.

A heuristic result is a real block with `origin: "heuristic"`. There is no separate "unstyled" path.

A directive naming a component whose `accepts` rejects the span is a warning, not an error: the block falls back to its heuristic and the build says so. `[invariant]` A wrong directive degrades, it never fails the build.

## Component schema

`[invariant]` The schema and the theme are separate. The schema is the contract a directive is written against. The theme is one implementation. A rebrand swaps the theme and touches no content file.

A component is a folder, discovered by scanning at startup. There is no barrel file and no
registration list, so adding one is adding a directory.

    components/timeline/
        index.ts        default-exports the definition below
        style.css       optional; every selector begins .pac-timeline
        script.ts       optional; exports mount(root), .tsx and .jsx also taken

    interface ComponentDefinition {
        accepts: (entities: Entity[]) => boolean;   // can this span be rendered?
        props: ZodSchema;                           // validation, defaults and coercion
        splittable: boolean;                        // may the fit stage cut it across pages?
        density: string[];                          // variants, loosest first
        render: (ctx: RenderContext) => string;     // html, never a DOM or framework node
    }

`[invariant]` The name is the folder name and appears nowhere inside the folder. A name and
its directory cannot disagree if only one of them exists.

`[decision]` `props` is a zod schema rather than a hand-written parameter list, because
validation, defaults, coercion and the error message a bad directive gets are all one
declaration.

`[decision]` Roots are a list and later ones win by name, so a third-party pack is a
directory and overriding a builtin is naming a folder after it.

`[invariant]` `render` returns an HTML string. Returning a DOM node or a framework element would bind the pipeline to a runtime, and the fit solver needs to measure in a headless browser while a later pptx renderer needs no runtime at all.

### Islands

`[decision]` Interactivity is islands. `script.ts` exports `mount(root)`; the engine generates
the entry that finds `[data-pac="<name>"]` and calls it once per instance, bundles it, and
inlines the result. A component never queries the document, so instance scoping is a
property of the contract rather than a discipline.

Scoping is `root.querySelector` and listeners on `root`. A component that wanted a framework
would take the same `mount(root)`: `createRoot(root)` is React's own boundary, and the
bundle would land inside that component's script alone, so a deck not using it ships none of
it. `.tsx` and `.jsx` entries are accepted for that reason, and to stop a JSX component from
silently getting no script.

`[decision]` No component in the vocabulary ships a script. Nothing in a deck needs
behaviour yet, and a clickable step exists to exercise a seam rather than to serve a reader,
so the seam is exercised by a test fixture instead. The mechanism stays because it costs one
generated entry and a bundler call.

`[decision]` No framework component is built and none is planned. One was tried to check the
seam holds, and it does, at 383 kB for the island. If one is ever wanted, its content reaches
mount time as data, a JSON carrier written inside the root at render and read at mount,
never by re-parsing the rendered markup, which would put the same logic in two places. That
sentence is the whole design; the helper was deleted rather than kept unused.

`[invariant]` `render` must emit complete static markup, and mounting must not change the
block's size. A deck has to print, measure and export with no script running, and the fit
solver measures before anything mounts. Interaction may change appearance; mounting may not.

`[decision]` A component ships its own `style.css`. Structure, layout and class names belong
to the component, `pac-<name>` and `pac-<name>__<part>`. A theme that had to style every
component would need editing for every component anyone adds, which is not modular.

`[invariant]` Every selector in a component's stylesheet names that component's class and no
other's. Ambient state may come first, so `body[data-present] [data-current] .pac-boxes__box`
is fine and `.pac-full` inside `boxes` is not. The loader checks it and reports a violation by
name, because CSS has no scope of its own and hoping is not a mechanism.

`[decision]` Only what a deck uses is emitted. The stylesheet and script of every component
no block chose are absent from the output, and the output is one self-contained file.

`[invariant]` A prop never restates what the component can see. `boxes` takes no column
count: the items are in front of it and CSS lays them out, growing to fill a row and wrapping
when one would fall under its basis. A prop exists for a decision the content cannot make.

`[invariant]` A component emits no element that carries no meaning. `prose` adds no wrapper
at all, because the page's own flow already positions its entities, and an image renders as
`<figure><img></figure>` rather than as markdown's paragraph around an image. The output has
to read as the semantic HTML someone would have written by hand, or the layer is not earning
anything.

`[decision]` The vocabulary is capped at about ten. `prose` is the escape hatch, and `raw` passes HTML through untouched. Adding a component for every one-off is how the agent starts choosing badly between near-duplicates.

Starting vocabulary: `lead`, `prose`, `boxes`, `timeline`, `comparison`, `table`, `aside`, `full`, `quote`, `raw`.

## Layout

A layout is a folder like a component, in a separate registry, because a component takes a
span of entities and a layout takes a whole page.

    layouts/header/
        style.css       required; every selector begins [data-layout="header"]
        index.ts        optional; almost never present

`[invariant]` A layout is a stylesheet. Only `default` ships a template; every other layout
folder inherits it, so writing one means writing CSS and no TypeScript.

    interface LayoutDefinition {              // default's, and rarely anyone else's
        props: ZodSchema;
        render: (ctx: LayoutContext) => string;
    }

    interface LayoutContext {
        content: string;        // every block of the page, rendered
        props: Record<string, unknown>;
        index: number;          // 1-based page number
        total: number;
    }

`[decision]` A layout is handed the page's content as one string and nothing else: no blocks,
no components, no entities. A layout that wants to place blocks individually would be logic,
and logic in a layout is the road to a worse JSX. `split` puts the image in its own column by
grid placement, which is the difference between CSS and a template language. A layout that
seems to need logic is a signal the component vocabulary is wrong.

`[decision]` `default` renders each layout prop as a `data-*` attribute on `<main>`, which is
how a stylesheet-only layout is parameterised: `align=center` becomes
`main[data-align="center"]` for its CSS to select on.

`[invariant]` A layout must place the content it is given. The engine checks the rendered page
contains it and reports the layout by name if it does not. This is the "article must exist"
rule made checkable: what matters is not which element the content lands in but that none of
it is lost.

`[decision]` The engine ships `default`, `header` and `split`, of which only `default` has a
template, and a theme replaces or extends one by using the same folder name. Layouts in the theme alone would mean a deck naming one breaks
under a theme that lacks it. A theme's `style.css` for a layout adds to the engine's rather
than replacing it, so a theme can accent a layout without reimplementing it.

`[invariant]` Every selector in a layout's stylesheet names `[data-layout="<name>"]` and no
other layout. A layout may restyle any component on its own page, so what it must name is the
page rather than a class. That attribute on the page section is what confines it there.

## Deck settings

Frontmatter, once at the top of the file. Theme, aspect ratio, page policy. Nothing per-page and nothing per-block lives here.

    ---
    theme: acme
    ratio: "16:9"
    h1StartsPage: true
    layout: default
    ---

## Page candidates and fit

`[invariant]` Pages are an output, not an input. Fixed page height is where markdown-to-slides tools die, so fit is a solver in the pipeline from the first version, not a rendering afterthought.

    interface Page {
        index: number;          // 0-based, reassigned at render so a split renumbers for free
        blocks: Block[];
        layout: string;
        layoutProps: Record<string, unknown>;
        scale: number;          // 1.0 unless the solver stepped down
        overflow: boolean;      // true if the ladder ran out; rendered anyway, flagged
    }

Page candidates come from break entities and the h1 policy, and they resolve before grouping, because the `lead` heuristic has to know it is alone on a page. The fit solver only ever splits a candidate further; it never merges two. Each candidate is measured in the real output box. On overflow the solver escalates, in order: step the type scale down within the theme's allowed range; move a block to a denser `density` variant; split the page at a block boundary; split inside a block if it declares `splittable`. If none of that fits, the page renders overflowing and is reported.

`[decision]` HTML is the first target because the browser measures for us. A renderer that cannot measure cannot fit, which is what rules out generating pptx directly from this model.

### Fit checking

`[decision]` The measuring browser is `playwright-core`, an optional dependency and never a
hard one. `bun install` must succeed and a plain build must run on a machine that has never
seen a browser binary; `playwright-core` is the small JS wrapper only, and `chromium.launch()`
succeeds only once `bunx playwright install chromium` has been run separately, or
`PAC_CHROMIUM` names a browser binary already on the machine, which is the case on most CI
images and is the difference between the fit tests running there and silently skipping. Fit is
requested with `--fit`; a plain build never imports the module that imports it, so importing
`build.ts` alone can never pull a browser dependency in.

`[decision]` A missing browser degrades to one diagnostic and the pages pass through
unchanged, never a thrown error. The alternative, a heuristic estimate of text height, was
rejected: it would contradict the reason HTML was chosen as the target in the first place, and
a wrong estimate is worse than an honest skip.

`[decision]` The scale rung is discrete, `--pac-step` in steps of 0.04 down to the theme's
`--pac-step-min`, rather than a computed ratio. Height does not shrink in proportion to type
size, because line wrapping is quantised and the page inset is a percentage of width, so a
computed ratio would be a guess dressed as arithmetic; and a deck whose pages each land on
their own size looks unfinished. Discrete rungs make a deck use two or three sizes at most.
The floor is a theme token, read from the rendered deck rather than the theme file, because
that is where a cascade is actually resolved.

`[decision]` A split cuts where the page fills at **full** type size, not at the size the page
shrank to on its way down the ladder. The scale rung exists to save a page from being split at
all; once a split is happening anyway, packing the head at the smallest type a theme allows
only guarantees the head has to shrink again, and the deck ends up uniformly cramped. Both
halves start the ladder over, so each page ends at the size its own content asks for.

`[decision]` A split moves the whole remainder to one following page, which re-enters the
ladder and is cut again if it has to be. Moving one block at a time and letting the outer loop
repeat gives every moved block a page of its own, which is a worse deck than the clipping it
replaces. The cut point is found by bisection over prefixes: fitting is monotone in how much a
page carries, so the search is sound, and each candidate is measured as a one-page deck rather
than guessed at.

`[decision]` Density variants, the second rung, are still not built. Every component declares
`density` and nothing consumes it. It is the rung with the least to offer: the other three
between them fit every deck written so far, and a variant needs CSS in each component before
the solver has anything to step to.

`[invariant]` A page that exhausts the ladder renders clipped and says so: `overflow` on the
page, `data-overflow` on the section, a hairline mark along the bottom edge in the reading
view, and a diagnostic naming the page. Silently clipping is the one outcome the model does not
allow, because a deck that quietly loses a paragraph is worse than one that visibly does not
fit.

`[invariant]` Measuring overflow requires forcing the measured element out of
`overflow: visible` first. Chromium's `scrollHeight` reports true overflow only once overflow
is `hidden`, `auto` or `scroll`; left at the CSS default it silently equals `clientHeight`
regardless of how much content is clipped. The fit pass sets `overflow: hidden` on `main`
immediately before reading `scrollHeight`, in the browser, for the read only.

## Theme

A theme is a folder.

    themes/acme/
        variables.css       the tokens; required
        styles.css          optional escape hatch
        layouts/header/     optional override of a layout by name

`[invariant]` `variables.css` is a token list. It names no component, no page part and no
deck. Adding a component requires no theme change.

`[decision]` How far the fit solver may shrink type is a token, `--pac-step-min`. It is the
one thing the solver needs from a theme and cannot work out for itself: whether this type at
80% is still readable is a typographic judgement, and a theme with a generous inset or a
large body size can afford more of it than one already set tight. Set it to 1 and the theme
opts out of the rung entirely, taking a split wherever it would have taken smaller type.

`[decision]` Motion is a token too. `--pac-motion` and `--pac-ease` set how a presented page
settles, and a theme that wants none sets `--pac-motion: 0s` rather than asking every
component to opt out. `prefers-reduced-motion` overrides all of it regardless of theme.

`[decision]` Entrance animation belongs to presentation mode and nothing else. The reading
form and the printed page are still, because motion in a document is noise, and a page only
animates while it is `[data-current]` under `[data-present]`.

`[decision]` The engine staggers a page's blocks; a component staggers its own parts one
level finer. Neither knows about the other, so a third-party component either animates its
insides or does not, and the page-level entrance happens either way.

`[decision]` Material is a token, not a component's opinion. `--pac-shadow` and `--pac-blur`
let a theme make surfaces flat, soft or glassy without reaching inside anything, and
`--pac-font-display` lets it set a serif for headings against a sans body. The alternative
was themes editing component internals, which the contract forbids for good reason.

`[decision]` `styles.css` exists for what no token should carry: `@font-face`, a letter-spacing
choice, a texture. It may not reach inside a component, and the loader reports it when a
selector contains `__`. Without it a theme could not load a font, which is not speculative.

`[invariant]` A component may reference the declared tokens and its own `--pac-<name>-*` variables, nothing else, and hard-codes no colour. A test enforces all three, because prose cannot: the rule is exactly the kind a grep can falsify.

The token set is capped like the component vocabulary, at a token per decision a theme is allowed to make rather than a token per property a component happens to set. It lives in `src/tokens.ts`, which is the contract.

Page structure, the page box and element defaults, belongs to the engine rather than to a theme, because it is mechanism. It is written against the tokens, so a theme still moves it without restating it.

## Viewer

Chrome for reading a deck: a floating toolbar and presentation mode. It is neither content nor
theme, so it is neither a component nor a layout, and it lives in `src/viewer/`.

`[decision]` The toolbar is injected at runtime and appears nowhere in the written file. A
deck on disk is content and nothing else, and chrome that is not in the markup cannot leak
into a print, an export or a measurement.

`[invariant]` A deck has two forms, and they are different renderings of the same blocks.
The **paged** form has a fixed aspect ratio and is what gets projected, printed and measured.
The **reading** form is fluid: below 900px the page loses its aspect ratio, type scales with
the viewport, and every component and layout collapses itself. Fit governs the paged form
only, because the reading form has no pages to overflow.

`[invariant]` Presentation mode presents whichever form the device is in. On a screen holding
the paged form it scales: the page keeps its 1280px design width and takes a transform, so
what is presented is what was measured and reflowing cannot invalidate the solver. On a narrow
screen it presents the reading form, one page filling the viewport and flowing, because the
paged form scaled to a phone is a letterbox strip nobody can read. Swipe advances there,
since a tap belongs to the page's own scroll.

`[decision]` Each component and layout carries its own narrow-screen rules. The engine has no
list of what collapses how, so a third-party component is responsive or is not, on its own
terms.

`[decision]` Icons are lucide-shaped SVG paths written inline, not the package. One icon is a
few bytes of path data and the dependency is the whole set.

`[decision]` The viewer is a build option, not a fixture. A headless render for a PDF passes
no viewer and the output contains no trace of it.

## Not in the model

`[decision]` No slide object with authored coordinates. Position is derived, always.

`[decision]` No parser knowledge of components. Parse yields entities and directives; the grouper is what consults the registry. That is what keeps the parser testable with no vocabulary loaded and the vocabulary swappable.

`[decision]` No separate selections file, and so no anchors and no span addressing. An external overlay has to name the blocks it modifies, and naming prose is the problem that sinks the scheme: derived names break silently on a reword, authored ones tax every block. Adjacency is free. The overlay earns its place only when one source is projected two ways, or when the content cannot be edited at all, and neither is true yet.

`[guess]` pptx is a later subset renderer over the plain components, not a design constraint now. Semantic components map to SmartArt-shaped output better than pixels do, but text measurement has to be solved on that side separately.
