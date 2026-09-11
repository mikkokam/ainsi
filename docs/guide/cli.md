# The CLI

Two commands: the bare one opens the [studio](studio.md), `build` writes a file and exits.

    ainsi [deck.md] [--port 4321]
    ainsi build <deck.md> [-o out.html|out.pdf|out.zip|out.pptx] [--to html|pdf|zip|pptx] [--fit] [--pdf[=screen|compact|full]] [--no-viewer]
    ainsi --help

## ainsi

    ainsi deck.md            opens the studio on the deck
    ainsi                    opens the studio on the chooser: open a deck here, or make one

The chooser browses the folder you started in. `ainsi` on its own writes no file; **New presentation** is what creates `untitled.md`, or `untitled-2.md` when that name is taken.

The studio can now edit multiple decks at once, so it serves each under its own path `/d/<id>/`. The file browser reaches the folder you started in, and the deck's own folder when the deck lies outside it. It is an HTTP server on localhost. To work on a deck elsewhere, start the studio there or open it through the studio.

`--port` moves the server off 4321.

With stdout piped, the studio refuses to start and prints the build command instead, because an agent or a pipe wants a file, not a server it cannot see.

## ainsi build

    ainsi build deck.md               # deck.html beside the deck
    ainsi build deck.md --to pdf      # deck.pdf, fitted, one sheet per page
    ainsi build deck.md -o out.pdf    # the format follows the extension
    ainsi build deck.md --fit         # measure and fit before writing the html
    ainsi build deck.md --no-viewer   # no toolbar, for a headless render
    ainsi build deck.md --to zip      # deck.zip: the markdown and what it references
    ainsi build deck.md --to pptx     # deck.pptx: editable text boxes over a raster ground

`--to zip` writes the deck rather than a rendering of it: the markdown, the images it uses, its logos, and its theme when the theme is a folder beside it. Unpack it and there is an ordinary deck folder, which is the one artefact someone else can keep editing. A reference that already sits inside the deck's folder keeps the path it has; only what reaches outside is copied in and relinked. Nothing else in the folder travels, so a built `deck.html` or another deck beside it stays behind.

`--to` and `-o` must agree, and either one decides the format. A PDF always fits first, since printing unfitted pages loses their overflow silently.

`--pdf=screen` is the default and downsamples images to what the page actually shows. `--pdf=compact` goes further, `--pdf=full` keeps them at full resolution for print.

## Reading the output

A build prints the theme, the page count and the block count, then one line per page naming its layout and its blocks. A `*` marks a block a directive named; everything else came from the heuristics. `x0.8` on a page means the fit solver stepped its type down that far.

    theme default, 17 pages, 39 blocks -> deck.html
      page 1 [header]: prose, full*
      page 7 [default] x0.8: prose, comparison*

Warnings go to stderr as `warn:` lines and are the first thing to read after a build. An unknown component, a directive that names nothing, a missing image or logo, a page the solver could not fit: one line each, and the file is still written.

## The browser it sometimes needs

`--fit`, PDF and PPTX measure in a headless Chromium. Without one, a build says so and writes unfitted pages rather than failing. See [Install](install.md#the-browser).
