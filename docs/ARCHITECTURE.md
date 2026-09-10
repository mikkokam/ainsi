# Architecture

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
     headless, the        the deck; chrome     never in a deck; the
     agent's surface      injected at runtime  app is a window on it

## Where things run

|        | runs on              | needs a browser          | ships in the deck |
| ------ | -------------------- | ------------------------ | ----------------- |
| engine | anywhere JS runs     | no                       | no                |
| cli    | Bun                  | only for `--fit` and PDF | no                |
| player | the viewer's browser | is one                   | **yes**           |
| studio | Bun + a browser      | is one, or brings one    | no                |

`playwright-core` ships no browser binary and `build.ts` never imports it, so a build on a machine that has never seen chromium works. A missing browser is one diagnostic and unchanged pages, never a throw.

`[decision]` Discovery never runs code. Components and layouts are named by a static import list; themes are CSS, read from disk. `load.ts` still scans folders, and that is the last of it.

## Surface: the CLI

## Surface: the player

## Surface: the studio

Every writer is equal: the studio commits by writing the deck file and riding the same watch, rebuild, reload loop as any external editor or agent; nothing updates the browser any other way.

A visual editor over the same markdown, run by the dev server, never shipped in a deck. A player is not an editor: baking editor code into the exported file would bloat it, and chrome that is not in the markup cannot leak into a print, an export or a measurement.

`[invariant]` The Studio holds no document state. Selection and the text in an open editor, yes; anything that changes what is rendered goes to the file first and comes back through the engine. The moment the Studio can show something the markdown does not say, there are two writers and a lossy bridge between them, which is the failure every markdown WYSIWYG dies of. This bites hardest on the tempting case, previewing a theme without committing: don't. The theme is one frontmatter line — write it, and make undo a write of the old value rather than a pile of unwritten state.

`[invariant]` Nothing ever serializes HTML back to markdown. Not in the Studio, not anywhere.

`[decision]` The Studio and an agent share one vocabulary and one write path. Both edit markdown by splicing at an offset; if it is literally the same function, the Studio's writes are testable headlessly with no browser, and a human tweak and an agent tweak are the same kind of event.

`[decision]` Every write hashes the file first and refuses on a mismatch. The deck will be open in an editor at the same time, and a splice against a stale offset corrupts the file rather than merely losing an edit.
