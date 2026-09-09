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

One version, four places. Three of them are `package.json`, `.claude-plugin/plugin.json` and `desktop/electrobun/electrobun.config.ts`, and a test fails when they disagree, so bumping one means bumping all three. The fourth is the git tag, which no test can see: tag after those three land, never before, so a tag and a bundle never claim different things. A plugin claiming a version the tool does not have hands an agent a grammar the binary cannot render; an app bundle doing it is worse, because by then it is on someone else's machine.

Every studio action needs a name, because it has two triggers. The studio's own chrome is written for a browser and the app hides it, so an action reachable only from a button in that chrome does not exist on the desktop. Give it a case in the `ainsi:command` handler and have the button call the same function; the app's menu item then dispatches the name and the behaviour stays in one place. A click handler written inline has no name and the app cannot offer it.


When developing, do not try to do screenshots on your own. instead do the change that you asked and then send a heads up to the user to do the testing - The user probably already has the development server running and the browser open so they can comment.
