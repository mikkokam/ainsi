# Install

Requires [Bun](https://bun.sh). There is nothing else to install and no service to sign into.

    git clone git@github.com:mikkokam/ainsi.git
    cd ainsi
    bun install --production          # 25 MB
    bun link                          # puts `ainsi` on the PATH, globally

`bun link` is what makes `ainsi` work in any folder. The clone stays where it is; the themes and components ship from inside it.

## The browser

Three things measure a page in a real browser, because overflow is a layout fact and no heuristic replaces measuring it: `--fit`, PDF export and PPTX export. `--production` leaves the browser wrapper out, so those need one of:

    bun install                       # the full tree, 38 MB, then:
    bunx playwright install chromium

or an existing browser on the machine:

    export AINSI_CHROMIUM=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome

Without a browser a build still writes a file. It says so in a warning and the pages go out unfitted, which for a deck written to fit is often the same file.

## Updating

    cd /path/to/ainsi && git pull && bun install --production

`bun link` survives a pull. Every deck you have already built keeps working; a rebuild picks up whatever changed in the engine or the themes.
