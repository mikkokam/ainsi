# Claude Code

This repo is also a Claude Code plugin. The plugin carries one skill, `ainsi`, which teaches the agent the deck grammar, the directives, and the build loop, so the deck it writes is a deck rather than a markdown file with slides in mind.

## Adding it

    claude plugin marketplace add mikkokam/ainsi
    claude plugin install ainsi@ainsi

The skill calls the `ainsi` on your PATH, so [install the tool](install.md) first. If the command is missing, the skill says so rather than working around it.

Both commands are one-off. The plugin is then available in every project on the machine, and the skill loads itself when a deck, slides, a presentation or a pitch is asked for, or when an existing `.md` deck is edited.

To update it, `claude plugin marketplace update ainsi`.

## What it changes

The agent writes the markdown and runs `ainsi build deck.md`, then reads the warnings, which is the loop that catches an unknown component, a directive that governs nothing, a missing image, or a page the fit solver could not fit. A deck that has not been built has not been checked, and the skill says so.

It knows what a deck never contains: no CSS, no inline styles, no font sizes, no colours. Asked for a look the theme does not give, it should propose a [theme](themes.md) change rather than a slide-level exception.

`build` is the agent's whole surface. The studio needs a terminal and refuses to start when stdout is piped, and the PPTX export lives in the studio only.

## Working alongside it

Run `ainsi deck.md` in one terminal and let the agent work the same file in another. The studio reloads on every external write, so you watch pages appear, then take over for the last mile: retype a line, change what a block is, try a theme. The agent's next read sees your edits, because there is only the one file.

## Diagrams

Pictures do not come from the deck. Draw one with whatever tool draws it, build a PNG or an SVG beside the deck, and reference it as an ordinary image.

## The skill itself

`skills/ainsi/SKILL.md` in this repo. It is the agent's copy of the grammar these pages document for people, kept deliberately short: an agent reads it in full on every deck, so anything it does not need costs tokens on every run.
