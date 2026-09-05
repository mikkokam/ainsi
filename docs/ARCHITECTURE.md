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
     headless, the        the deck; chrome     never in a deck
     agent's surface      injected at runtime

## Where things run

|        | runs on              | needs a browser          | ships in the deck |
| ------ | -------------------- | ------------------------ | ----------------- |
| engine | anywhere JS runs     | no                       | no                |
| cli    | Bun                  | only for `--fit` and PDF | no                |
| player | the viewer's browser | is one                   | **yes**           |
| studio | Bun + a browser      | is one                   | no                |

`playwright-core` is an optional dependency that ships no browser binary. `build.ts` never imports it — there is a test — so a plain build on a machine that has never seen chromium works and stays fast. A missing browser degrades to one diagnostic and unchanged pages, never a thrown error.

## Surface: the CLI

## Surface: the player

## Surface: the studio

Every writer is equal: the studio commits by writing the deck file and riding the same watch, rebuild, reload loop as any external editor or agent; nothing updates the browser any other way.
