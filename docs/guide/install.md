# Install

There are three ways to use Ainsi: as a native desktop app, as a CLI tool, or in Docker. All are entirely local with no services to sign into.

## 1. Desktop App (MacOS)

**The easiest way to start is the desktop app.** It's a single binary you can install, and it auto-updates itself.

Download the latest `.dmg` from the [GitHub releases page](https://github.com/mikkokam/ainsi/releases/latest).

The auto-update is included: the app checks for its own update at launch and offers it in the studio along with an option in the app menu.

**Beta: the build is not signed or notarised yet.** Gatekeeper says the downloaded app is damaged and offers only Trash. After dragging it to Applications, clear the quarantine flag macOS set on the download and it opens normally from then on:

    xattr -cr /Applications/Ainsi.app

### Build it yourself

A locally built app never gets the quarantine flag, since that is only set on something macOS watched arrive from outside. Requires [Bun](https://bun.sh) and Xcode's Command Line Tools (`xcode-select --install`; the full Xcode app is not needed):

    git clone https://github.com/mikkokam/ainsi.git
    cd ainsi
    bun install
    bun run app:build

The app lands in `desktop/electrobun/build/stable-macos-arm64/Ainsi.app` and opens straight away; the same build writes `desktop/electrobun/artifacts/macos-arm64-Ainsi.dmg` if you want the disk image. Electrobun builds for the machine it runs on (macOS 14+, Windows 11+, Ubuntu 24.04+), and this app has only been built on macOS with Apple Silicon: the release above is that build, and the updater only knows it. A Windows or Linux build is untried rather than impossible; the [CLI](#2-cli-tool) or [Docker](#3-docker) below is the studio there today.

## 2. CLI Tool

If you prefer using the terminal and a local web server (with the GUI in your browser), you can install the CLI. Requires [Bun](https://bun.sh).

    git clone https://github.com/mikkokam/ainsi.git
    cd ainsi
    bun install --production          # 25 MB
    bun link                          # puts `ainsi` on the PATH, globally

`bun link` is what makes `ainsi` work in any folder. The clone stays where it is; the themes and components ship from inside it.

## 3. Docker

For the studio server on Linux, or reached from a browser on a different machine:

    git clone https://github.com/mikkokam/ainsi.git
    cd ainsi
    docker build -t ainsi .
    docker run -d -t -p 4321:4321 ainsi

The image bundles Chromium (`playwright-core install --with-deps`), so a build takes a few minutes and the image is a few hundred MB. There is no published image; building locally is the only way to get one today.

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
