# The studio

`ainsi deck.md` opens a browser page over your markdown file. It is not a second copy of the document: every change is written to the `.md` before it comes back through the engine, and anything you can see, the file already says.

The studio is served by the dev server and is never in a built deck. What ships inside a deck is the player: the toolbar, the grid and presenting, and nothing that edits.

## Editing a block

Click a block to edit its text. The markdown is what you type; the marks bar above the selection carries bold, italic, inline code and `==highlight==` for the syntax you would rather click.

A rail appears at the block's top-left corner while the pointer is over it: a grip for the block menu and a plus for a block below. Right-click anywhere on the block opens the same menu, and ⌥ click inserts, so the rail is a visible door rather than the only way in.

The block menu is what this block is, what it can become, and its props. Converting a list to a `timeline` writes the directive; changing `axis` rewrites that directive's props. Deleting takes the directive with the block.

Move up and Move down sit beside the delete, and swap the block with its neighbour on the same page. What moves is what the menu addresses: a block a directive governs moves whole, directive and end marker with it, while a paragraph inside a run of ordinary markdown moves on its own, so reordering within the run is the same gesture. Only the moves that exist are drawn, so the first block on a page offers no Move up.

The page has its own rail one scope up, at the page's top-left corner: the grip carries the page's layout and its props, ⌥ click on it adds a page below, and so does the plus beside it. The page menu moves pages the same way, taking the layout directive along and writing the break a directive alone was holding open.

`E` opens the whole file's source in a code editor, for when a splice is faster than a form. **Edit source** on the page menu opens the same editor over one page's slice, which is what you want when the page you are splicing is the one on screen. Escape closes whatever is open.

## Images

Clicking an image opens a form of two fields, name and URL, rather than the raw markdown. A local file works by path, relative to the deck folder or absolute, and stays linked rather than copied: change the file and the deck shows the new one. Markup the form does not cover, a link around the image or attributes on it, falls back to the source editor.

## The deck's own settings

**Deck settings…** in the menu edits the [frontmatter](frontmatter.md) as text, above the first page, since it belongs to the deck and not to page one.

**Theme…** lists the themes and writes the one you pick to `theme:` in the frontmatter. There is no preview state: a theme you are trying is a theme the file says, and undo writes the old value back.

**Open deck…** browses for another markdown file in the folder the studio started in, and opening one is the same as having launched the studio on it. **New presentation** creates the file.

The file name sits in the toolbar. Type over it to rename.

## Exports

**Export…** writes beside the deck:

- HTML, the self-contained page.
- PDF, at screen resolution, compact, or with full-resolution images.
- PPTX, editable.

The PPTX is the deck in two layers: everything that is not text is one background picture per page, exactly as Chromium painted it, and every run of text sits above it as a native PowerPoint text box at the same position, size, colour and weight. Whoever receives it can click any line and retype it, and cannot break the design, because the design is pixels underneath.

## Presenting

⌘⏎ presents from the current slide, Ctrl+Enter where there is no ⌘. Arrows move, ⌘ arrows jump to the first or last, ⌘G is the grid, Escape leaves. Blocks arrive in order as you reach a page; `prefers-reduced-motion` turns that off.

Clicking a picture lifts it over the deck at the page's own radius, and a click anywhere puts it back. It works while reading and while presenting, but not in the studio, where a click on a picture is an edit.

Hold ⌘ to see the shortcuts for whatever mode you are in.

These work in a built deck too. The toolbar and the grid ship with the file, so the HTML you send presents the same way on someone else's machine, offline.

## While an agent is working

The studio reloads when the file changes underneath it, so an agent rewriting a page is something you watch happen. Every write hashes the file first and refuses on a mismatch, because a splice against a stale offset corrupts a file rather than merely losing an edit. If a write is refused, the file moved under you: the studio reloads and you make the edit again.

⌘Z and ⇧⌘Z undo and redo at the level of commits, with nothing open. An open editor keeps its own undo.
