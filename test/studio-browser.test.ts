import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Page } from "playwright-core";

/**
 * The studio as a person meets it: clicks, keys and what the file says afterwards. Behaviour
 * in a real layout needs a real browser, so a skip here is the degrade a build without one
 * gives, the same as the fit tests.
 */

const chromium: boolean = await import("playwright-core")
    .then(({ chromium }) => chromium
        .launch(process.env.AINSI_CHROMIUM ? { executablePath: process.env.AINSI_CHROMIUM } : {})
        .then(browser => browser.close().then(() => true)))
    .catch(() => false);

const CLI = resolve(import.meta.dir, "..", "src", "cli.ts");
const DECK = "# Otsikko\n\nEnsimmäinen kappale.\n\nToinen kappale.\n\n---\n\n# Toinen sivu\n\nKolmas kappale.\n";

/** the studio on a deck of its own, and a page pointed at it */
async function open(deck = DECK) {
    const { chromium: browserType } = await import("playwright-core");
    const dir = await mkdtemp(join(tmpdir(), "ainsi-studio-"));
    const file = join(dir, "deck.md");
    await Bun.write(file, deck);

    const child = Bun.spawn({
        cmd: ["bun", CLI, file, "--port", "0"],
        env: { ...process.env, AINSI_HOST: "test" },
        stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    let url = "";
    while (!url) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
        url = /studio on (\S+)/.exec(seen)?.[1] ?? "";
    }

    const browser = await browserType.launch(process.env.AINSI_CHROMIUM ? { executablePath: process.env.AINSI_CHROMIUM } : {});
    // the clipboard is a permission, and a headless run has nobody to grant it
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector("[data-ainsi-edit]");

    return {
        page,
        /** what is on disk right now, which is the only place the studio keeps anything */
        source: () => Bun.file(file).text(),
        async stop() {
            await browser.close();
            child.kill();
            await rm(dir, { recursive: true, force: true });
        },
    };
}

/** how many of these are on the page right now */
const count = (page: Page, selector: string) => page.locator(selector).count();

/** waits for a condition rather than for a duration, so a slow machine is slow and not wrong */
async function until<T>(what: () => Promise<T>, holds: (value: T) => boolean, ms = 10_000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
        const value = await what();
        if (holds(value)) return value;
        if (Date.now() > deadline) return value;
        await Bun.sleep(50);
    }
}

/*
 * The clipboard, read through whatever reloads are in flight. A commit reloads the page onto
 * the rebuilt deck, so an evaluate started a moment too early loses its context; that is the
 * studio working, not the test failing, and the read is retried rather than timed.
 */
async function clipboard(page: Page, holds: (text: string) => boolean, ms = 10_000): Promise<string> {
    const deadline = Date.now() + ms;
    let last = "";
    for (;;) {
        try {
            last = await page.evaluate(() => navigator.clipboard.readText());
            if (holds(last)) return last;
        } catch {
            // a navigation took the context; the next turn of the loop gets the new one
        }
        if (Date.now() > deadline) return last;
        await Bun.sleep(50);
    }
}

/** the nth paragraph's handle, which is what a click lands on */
const paragraph = (page: Page, n: number) => page.locator("[data-ainsi-entity]").filter({ hasText: /kappale/ }).nth(n);

test.skipIf(!chromium)("one click selects a block and opens what can be done to it", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();

    expect(await count(studio.page, "[data-ainsi-selected]")).toBe(1);
    expect(await count(studio.page, ".ainsi-studio__bar")).toBe(1);
    // selected is not editing: nothing has a caret in it
    expect(await count(studio.page, "textarea")).toBe(0);

    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a second click on what is selected puts the caret in it", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await paragraph(studio.page, 0).click();

    expect(await until(() => count(studio.page, "textarea"), n => n === 1)).toBe(1);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("Enter opens the selection and Escape lets it go", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await studio.page.keyboard.press("Enter");
    expect(await until(() => count(studio.page, "textarea"), n => n === 1)).toBe(1);

    await studio.page.keyboard.press("Escape");
    expect(await until(() => count(studio.page, "textarea"), n => n === 0)).toBe(0);
    await studio.page.keyboard.press("Escape");
    expect(await until(() => count(studio.page, "[data-ainsi-selected]"), n => n === 0)).toBe(0);

    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("selecting another block moves the selection rather than adding one", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await paragraph(studio.page, 1).click();
    expect(await count(studio.page, "[data-ainsi-selected]")).toBe(1);
    expect(await studio.page.locator("[data-ainsi-selected]").innerText()).toContain("Toinen kappale");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("clicking away drops the selection", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await studio.page.mouse.click(4, 880);
    expect(await until(() => count(studio.page, "[data-ainsi-selected]"), n => n === 0)).toBe(0);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("an edit through the selection reaches the file", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await studio.page.keyboard.press("Enter");
    await studio.page.locator("textarea").fill("Muokattu kappale.");
    await studio.page.keyboard.press("Meta+Enter");

    const after = await until(studio.source, text => text.includes("Muokattu kappale."));
    expect(after).toContain("Muokattu kappale.");
    expect(after).not.toContain("Ensimmäinen kappale.");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a selected block copies as its own markdown", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await studio.page.keyboard.press("Meta+c");

    const held = await clipboard(studio.page, t => t.length > 0);
    expect(held.trim()).toBe("Ensimmäinen kappale.");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("paste lands after the selection and leaves it alone", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await studio.page.keyboard.press("Meta+c");
    await clipboard(studio.page, t => t.length > 0);

    await paragraph(studio.page, 1).click();
    await studio.page.keyboard.press("Meta+v");

    const after = await until(studio.source, t => t.split("Ensimmäinen kappale.").length === 3);
    // the copy sits after the block that was selected, and that block is still there
    expect(after).toContain("Toinen kappale.\n\nEnsimmäinen kappale.");
    expect(after.split("Ensimmäinen kappale.").length - 1).toBe(2);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("cut takes the block out of the file and puts it on the clipboard", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await studio.page.keyboard.press("Meta+x");

    const after = await until(studio.source, t => !t.includes("Ensimmäinen kappale."));
    expect(after).not.toContain("Ensimmäinen kappale.");
    expect(after).toContain("Toinen kappale.");
    // the cut reloads the page onto the new file, so the clipboard is read once that has landed
    const held = await clipboard(studio.page, t => t.trim() === "Ensimmäinen kappale.");
    expect(held.trim()).toBe("Ensimmäinen kappale.");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("markdown from anywhere pastes in, because the clipboard is only text", async () => {
    const studio = await open();
    await studio.page.evaluate(() => navigator.clipboard.writeText("## Ulkoa tuotu\n\nTeksti."));
    await paragraph(studio.page, 0).click();
    await studio.page.keyboard.press("Meta+v");

    const after = await until(studio.source, t => t.includes("Ulkoa tuotu"));
    expect(after).toContain("## Ulkoa tuotu");
    await studio.stop();
}, 60_000);

/** what a native menu item does: the studio is reached by an event, never by a keystroke */
const command = (page: Page, name: string) =>
    page.evaluate(n => document.dispatchEvent(new CustomEvent("ainsi:command", { detail: n })), name);

test.skipIf(!chromium)("the copy command acts on the selection when there is one", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await command(studio.page, "copy");
    const held = await clipboard(studio.page, t => t.length > 0);
    expect(held.trim()).toBe("Ensimmäinen kappale.");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("the copy command hands back to the field when a caret is in one", async () => {
    const studio = await open();
    await studio.page.evaluate(() => navigator.clipboard.writeText("vanha"));
    await paragraph(studio.page, 0).click();
    await studio.page.keyboard.press("Enter");
    await until(() => count(studio.page, "textarea"), n => n === 1);

    // the whole field selected, the way Select All leaves it
    await studio.page.locator("textarea").selectText();
    await command(studio.page, "copy");

    const held = await clipboard(studio.page, t => t !== "vanha");
    expect(held.trim()).toBe("Ensimmäinen kappale.");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("insert with nothing selected puts a block at the end of the page in view", async () => {
    const studio = await open();
    await command(studio.page, "insert");
    await until(() => count(studio.page, "textarea"), n => n === 1);
    await studio.page.locator("textarea").fill("Uusi lohko.");
    await studio.page.keyboard.press("Meta+Enter");

    const after = await until(studio.source, t => t.includes("Uusi lohko."));
    expect(after).toContain("Uusi lohko.");
    // it landed on the first page, which is the one in view, not at the end of the file
    expect(after.indexOf("Uusi lohko.")).toBeLessThan(after.indexOf("Toinen sivu"));
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("delete takes the selected block out of the file", async () => {
    const studio = await open();
    await paragraph(studio.page, 1).click();
    await command(studio.page, "delete");
    const after = await until(studio.source, t => !t.includes("Toinen kappale."));
    expect(after).not.toContain("Toinen kappale.");
    expect(after).toContain("Ensimmäinen kappale.");
    await studio.stop();
}, 60_000);

/** the page rail's grip, which is how a page is picked up */
async function selectPage(page: Page, n: number) {
    const box = (await page.locator(".ainsi-page").nth(n).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + 10, box.y + 10);
    const grip = page.locator('.ainsi-studio__rail:not([hidden]) [title^="Page layout"]');
    await grip.waitFor();
    await grip.click();
}

test.skipIf(!chromium)("a page is selected from its own grip, not from a block inside it", async () => {
    const studio = await open();
    await selectPage(studio.page, 0);
    expect(await count(studio.page, ".ainsi-page[data-ainsi-selected]")).toBe(1);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a page copies as every block on it, directives and all", async () => {
    const studio = await open();
    await selectPage(studio.page, 0);
    await command(studio.page, "copy");
    const held = await clipboard(studio.page, t => t.length > 0);
    expect(held).toContain("# Otsikko");
    expect(held).toContain("Ensimmäinen kappale.");
    expect(held).toContain("Toinen kappale.");
    expect(held).not.toContain("Toinen sivu");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a pasted page becomes a page, with the break in front of it", async () => {
    const studio = await open();
    await selectPage(studio.page, 0);
    await command(studio.page, "copy");
    await clipboard(studio.page, t => t.length > 0);
    await command(studio.page, "paste");

    const after = await until(studio.source, t => t.split("# Otsikko").length === 3);
    expect(after.split("# Otsikko").length - 1).toBe(2);
    // the copy sits between the page it came from and the one that followed
    expect(after.indexOf("Toinen sivu")).toBeGreaterThan(after.lastIndexOf("# Otsikko"));
    const pages = await until(() => count(studio.page, ".ainsi-page"), n => n === 3);
    expect(pages).toBe(3);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("cutting a page takes the whole page and its break", async () => {
    const studio = await open();
    await selectPage(studio.page, 1);
    await command(studio.page, "cut");

    const after = await until(studio.source, t => !t.includes("Toinen sivu"));
    expect(after).not.toContain("Toinen sivu");
    expect(after).not.toContain("Kolmas kappale.");
    expect(after).toContain("# Otsikko");
    expect(after.trim().endsWith("---")).toBe(false);
    const pages = await until(() => count(studio.page, ".ainsi-page"), n => n === 1);
    expect(pages).toBe(1);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("the grid command opens and closes the overview", async () => {
    const studio = await open();
    await command(studio.page, "grid");
    expect(await until(() => count(studio.page, ".ainsi-overview"), n => n === 1)).toBe(1);
    await command(studio.page, "grid");
    expect(await until(() => count(studio.page, ".ainsi-overview"), n => n === 0)).toBe(0);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("play presents from the page in view, and from start goes to the first", async () => {
    const studio = await open();
    // the second page in view, so from-here and from-start cannot agree by accident
    await studio.page.locator(".ainsi-page").nth(1).scrollIntoViewIfNeeded();
    await command(studio.page, "present");
    expect(await until(() => studio.page.evaluate(() => document.body.hasAttribute("data-present")), on => on)).toBe(true);
    const here = await studio.page.evaluate(() => document.querySelector("[data-current]")?.id);

    await command(studio.page, "present-from-start");
    const first = await until(
        () => studio.page.evaluate(() => document.querySelector("[data-current]")?.id),
        id => id !== here,
    );
    expect(first).toBe(await studio.page.evaluate(() => document.querySelector(".ainsi-page")?.id));
    expect(first).not.toBe(here);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("reading leaves both the grid and the presentation", async () => {
    const studio = await open();
    await command(studio.page, "present");
    await until(() => studio.page.evaluate(() => document.body.hasAttribute("data-present")), on => on);
    await command(studio.page, "reading");
    expect(await until(() => studio.page.evaluate(() => document.body.hasAttribute("data-present")), on => !on)).toBe(false);
    await studio.stop();
}, 60_000);
