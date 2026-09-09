# ainsi

Markdown decks built to one self-contained HTML page, a PDF or a PPTX, with a studio for the last mile.

`docs/VISION.md` is what it is for, `docs/ARCHITECTURE.md` how it is built, `docs/FEATS.md` what is not built yet. All three are short; read them before changing anything.

`skills/ainsi/SKILL.md` is the deck grammar as an agent reads it. Writing or editing a deck goes through that. `docs/guide/` is the human reference for the same grammar and is not a second place to state a rule.

## The loop

`bun test`, `bun run dev <deck.md>` for the studio in a browser, `bun run app` for the desktop app. README's Development section has the rest.

## Traps

Building or opening a sample writes `<sample>.html` beside it, and those files are tracked. Check `git status` and revert what you did not mean to change.

The studio refuses to start without a terminal, so an agent or a pipe is told to run `ainsi build` instead. A script that needs it anyway sets `AINSI_HOST`, pipes stdin, and holds that pipe open: the studio exits when it closes.

Tests that need a browser skip when there is none rather than failing, so a green run on a machine without chromium is not a full run.
