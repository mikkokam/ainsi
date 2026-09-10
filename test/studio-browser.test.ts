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

test.skipIf(!chromium)("Enter opens the selection, and Escape steps back out one level at a time", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await studio.page.keyboard.press("Enter");
    expect(await until(() => count(studio.page, "textarea"), n => n === 1)).toBe(1);

    await studio.page.keyboard.press("Escape");
    expect(await until(() => count(studio.page, "textarea"), n => n === 0)).toBe(0);

    // the block hands over to the page it is on, which is the only way to a page under a picture
    await studio.page.keyboard.press("Escape");
    expect(await until(() => count(studio.page, ".ainsi-page[data-ainsi-selected]"), n => n === 1)).toBe(1);

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

/** the plus on the hovered block's rail, which is how something new is put after it */
async function openInsert(page: Page) {
    const box = (await page.locator("[data-ainsi-entity]").first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + 4, box.y + 4);
    const plus = page.locator('.ainsi-studio__rail:not([hidden]) [title^="Add a block below"]');
    await plus.waitFor();
    await plus.click();
    await page.waitForSelector(".ainsi-studio__bar");
}

test.skipIf(!chromium)("insert offers the kinds the parser has, not a list of its own", async () => {
    const studio = await open();
    await openInsert(studio.page);
    const labels = await studio.page.locator(".ainsi-studio__bar button").allInnerTexts();
    for (const wanted of ["Page", "Text", "Bullets", "Numbered", "Quote", "Callout", "Code", "Table", "Image"]) {
        expect(labels.join(" ")).toContain(wanted);
    }
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a kind several components can shape offers them, from the registry", async () => {
    const studio = await open();
    await openInsert(studio.page);
    await studio.page.locator(".ainsi-studio__bar button", { hasText: "Bullets" }).first().click();
    const forms = await studio.page.locator(".ainsi-studio__droplist:not([hidden]) .ainsi-studio__dropitem").allInnerTexts();
    // whatever the registry says takes a list, which is these today and whatever is added later
    expect(forms.join(" ")).toContain("timeline");
    expect(forms.join(" ")).toContain("agenda");
    expect(forms.join(" ")).toContain("boxes");
    expect(forms.join(" ")).not.toContain("prose");   // what grouping picks anyway is not a choice
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("inserting a shaped list writes the directive and the list under it", async () => {
    const studio = await open();
    await openInsert(studio.page);
    await studio.page.locator(".ainsi-studio__bar button", { hasText: "Bullets" }).first().click();
    await studio.page.locator(".ainsi-studio__droplist:not([hidden]) .ainsi-studio__dropitem", { hasText: "timeline" }).first().click();

    const after = await until(studio.source, t => t.includes("ainsi: timeline"));
    expect(after).toContain("<!-- ainsi: timeline -->");
    expect(after).toContain("- One");
    // and it renders as the component it named, rather than as a plain list
    expect(await until(() => count(studio.page, '[data-ainsi="timeline"]'), n => n === 1)).toBe(1);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("inserting a table writes a table a person could have typed", async () => {
    const studio = await open();
    await openInsert(studio.page);
    await studio.page.locator(".ainsi-studio__bar button", { hasText: "Table" }).first().click();
    await studio.page.locator(".ainsi-studio__droplist:not([hidden]) .ainsi-studio__dropitem", { hasText: "plain" }).first().click();

    const after = await until(studio.source, t => t.includes("| --- |"));
    expect(after).toContain("| A | B |");
    expect(await until(() => count(studio.page, "table"), n => n >= 1)).toBeGreaterThan(0);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("insert can add a page, from the same place a block comes from", async () => {
    const studio = await open();
    await openInsert(studio.page);
    await studio.page.locator(".ainsi-studio__bar button", { hasText: "Page" }).first().click();
    expect(await until(() => count(studio.page, ".ainsi-page"), n => n === 3)).toBe(3);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("the insert commands a native menu sends name the same kinds", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await command(studio.page, "insert:Table");
    const after = await until(studio.source, t => t.includes("| --- |"));
    expect(after).toContain("| A | B |");
    // after the block that was selected, not at the end of the file
    expect(after.indexOf("| A | B |")).toBeLessThan(after.indexOf("Toinen kappale."));
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("duplicate puts a copy straight after, without touching the clipboard", async () => {
    const studio = await open();
    await studio.page.evaluate(() => navigator.clipboard.writeText("koskematon"));
    await paragraph(studio.page, 0).click();
    await command(studio.page, "duplicate");

    const after = await until(studio.source, t => t.split("Ensimmäinen kappale.").length === 3);
    expect(after.split("Ensimmäinen kappale.").length - 1).toBe(2);
    expect(await clipboard(studio.page, t => t.length > 0)).toBe("koskematon");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("duplicating a page copies the whole page after it", async () => {
    const studio = await open();
    await selectPage(studio.page, 0);
    await command(studio.page, "duplicate");
    expect(await until(() => count(studio.page, ".ainsi-page"), n => n === 3)).toBe(3);
    const after = await studio.source();
    expect(after.split("# Otsikko").length - 1).toBe(2);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("clicking a page where no block is picks the page", async () => {
    const studio = await open();
    const box = (await studio.page.locator(".ainsi-page").first().boundingBox())!;
    // just inside the page's own edge, which no block reaches
    await studio.page.mouse.click(box.x + 6, box.y + box.height - 6);

    expect(await until(() => count(studio.page, ".ainsi-page[data-ainsi-selected]"), n => n === 1)).toBe(1);
    expect(await count(studio.page, ".ainsi-studio__bar")).toBe(1);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("clicking outside every page lets go rather than picking one", async () => {
    const studio = await open();
    await paragraph(studio.page, 0).click();
    await studio.page.mouse.click(4, 880);
    expect(await until(() => count(studio.page, "[data-ainsi-selected]"), n => n === 0)).toBe(0);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a picture covering the page is picked before the page it covers", async () => {
    const studio = await open("---\nlayout: header\n---\n\n# Kansi\n\n![](kuva.png)\n");
    const box = (await studio.page.locator(".ainsi-page").first().boundingBox())!;
    await studio.page.mouse.click(box.x + box.width - 20, box.y + 20);

    // the image is a block, and a block is the innermost thing under the pointer
    expect(await until(() => count(studio.page, ".ainsi-page[data-ainsi-selected]"), n => n === 0)).toBe(0);
    expect(await count(studio.page, "[data-ainsi-selected]")).toBe(1);
    await studio.stop();
}, 60_000);

/** the grip on a hovered block, which is what a drag is picked up by */
async function grip(page: Page, on: ReturnType<typeof paragraph>) {
    const box = (await on.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + 4, box.y + 4);
    const handle = page.locator('.ainsi-studio__rail:not([hidden]) [title="Block menu"]');
    await handle.waitFor();
    return (await handle.boundingBox())!;
}

/** picks a block up by its grip and drops it on the given fraction of another block's height */
async function drag(studio: Awaited<ReturnType<typeof open>>, from: number, onto: number, at: number) {
    const handle = await grip(studio.page, paragraph(studio.page, from));
    const box = (await paragraph(studio.page, onto).boundingBox())!;
    await studio.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await studio.page.mouse.down();
    await studio.page.mouse.move(box.x + box.width / 2, box.y + box.height * at, { steps: 12 });
    const line = await studio.page.locator(".ainsi-studio__drop-line").boundingBox();
    await studio.page.mouse.up();
    return { line, box };
}

test.skipIf(!chromium)("dropping on the lower half of a block lands after it", async () => {
    const studio = await open();
    const { line, box } = await drag(studio, 0, 1, 0.8);
    expect(line!.y).toBeGreaterThan(box.y + box.height / 2);

    const after = await until(studio.source, t => t.indexOf("Toinen kappale.") < t.indexOf("Ensimmäinen kappale."));
    expect(after.indexOf("Toinen kappale.")).toBeLessThan(after.indexOf("Ensimmäinen kappale."));
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("dropping on the upper half lands before it, which is how a block reaches the top", async () => {
    const studio = await open();
    const { line, box } = await drag(studio, 1, 0, 0.2);
    expect(line!.y).toBeLessThan(box.y + box.height / 2);

    const after = await until(studio.source, t => t.indexOf("Toinen kappale.") < t.indexOf("Ensimmäinen kappale."));
    expect(after.indexOf("Toinen kappale.")).toBeLessThan(after.indexOf("Ensimmäinen kappale."));
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a drop that would change nothing does not write the file", async () => {
    const studio = await open();
    const before = await studio.source();
    await drag(studio, 0, 1, 0.2);      // just above the block it already sits above
    await Bun.sleep(700);
    expect(await studio.source()).toBe(before);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("the block being carried is dimmed where it still is", async () => {
    const studio = await open();
    const handle = await grip(studio.page, paragraph(studio.page, 0));
    await studio.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await studio.page.mouse.down();
    await studio.page.mouse.move(handle.x + 200, handle.y + 60, { steps: 8 });
    expect(await count(studio.page, "[data-ainsi-carried]")).toBe(1);
    await studio.page.mouse.up();
    expect(await until(() => count(studio.page, "[data-ainsi-carried]"), n => n === 0)).toBe(0);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a press that does not move is a click, and still opens the menu", async () => {
    const studio = await open();
    const from = await grip(studio.page, paragraph(studio.page, 0));
    await studio.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await studio.page.mouse.down();
    await studio.page.mouse.up();

    expect(await until(() => count(studio.page, ".ainsi-studio__bar"), n => n === 1)).toBe(1);
    expect(await count(studio.page, ".ainsi-studio__drop-line")).toBe(0);
    expect(await studio.source()).toContain("Ensimmäinen kappale.\n\nToinen kappale.");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a drag dropped on nothing leaves the deck as it was", async () => {
    const studio = await open();
    const before = await studio.source();
    const from = await grip(studio.page, paragraph(studio.page, 0));
    await studio.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await studio.page.mouse.down();
    await studio.page.mouse.move(6, 880, { steps: 12 });
    await studio.page.mouse.up();

    await Bun.sleep(600);
    expect(await studio.source()).toBe(before);
    expect(await count(studio.page, ".ainsi-studio__drop-line")).toBe(0);
    await studio.stop();
}, 60_000);

const TABLE_DECK = "# Hinnasto\n\n| Name | Qty | Price |\n| --- | ---: | :---: |\n| Apples | 12 | 1,20 |\n| Pears | 3 | 0,90 |\n";

/** the table on the page, opened the way anything else is: click to select, Enter to edit */
async function openTable(studio: Awaited<ReturnType<typeof open>>) {
    await studio.page.locator("table").first().click();
    await studio.page.keyboard.press("Enter");
    await studio.page.waitForSelector(".ainsi-studio__table");
}

test.skipIf(!chromium)("a table opens as a grid of its cells, not as pipes", async () => {
    const studio = await open(TABLE_DECK);
    await openTable(studio);

    expect(await count(studio.page, ".ainsi-studio__table textarea")).toBe(0);
    const values = await studio.page.locator(".ainsi-studio__grid input").evaluateAll(
        inputs => inputs.map(i => (i as HTMLInputElement).value));
    expect(values).toEqual(["Name", "Qty", "Price", "Apples", "12", "1,20", "Pears", "3", "0,90"]);
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a cell typed into reaches the file as a table", async () => {
    const studio = await open(TABLE_DECK);
    await openTable(studio);
    await studio.page.locator(".ainsi-studio__grid input").nth(3).fill("Omenat");
    await studio.page.keyboard.press("Meta+Enter");

    const after = await until(studio.source, t => t.includes("Omenat"));
    expect(after).toContain("| Omenat |");
    expect(after).toContain("| ---    | ---: | :---: |");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a column added reaches every row", async () => {
    const studio = await open(TABLE_DECK);
    await openTable(studio);
    await studio.page.locator('.ainsi-studio__gridadd [title="Add column"]').first().click();
    expect(await count(studio.page, ".ainsi-studio__grid input")).toBe(12);
    await studio.page.keyboard.press("Meta+Enter");

    const after = await until(studio.source, t => t.split("|").length > 17);
    for (const line of after.split("\n").filter(l => l.startsWith("|"))) {
        expect(line.split("|").length).toBe(6);        // four columns, and the edge on each side
    }
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a column's alignment is a button, and lands in the rule row", async () => {
    // every column starts left, so any alignment in the result came from the click
    const studio = await open("# T\n\n| Name | Qty |\n| --- | --- |\n| A | 12 |\n");
    await openTable(studio);
    await studio.page.locator('.ainsi-studio__gridhead').first().locator('[title="right"]').click();
    await studio.page.keyboard.press("Meta+Enter");

    const after = await until(studio.source, t => t.includes("---:"));
    expect(after).toContain("| ---: | --- |");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a component that renders a table as something else still edits as a grid", async () => {
    // comparison draws columns and dl rows, so its handle is a block and not a table; the
    // markdown is what decides, which is the only thing that does not vary between them
    const table = "| Feature | A | B |\n| --- | --- | --- |\n| Speed | fast | slow |";
    const studio = await open(`<!-- ainsi: comparison -->\n\n${table}\n`);
    expect(await count(studio.page, "table")).toBe(0);

    const box = (await studio.page.locator(".ainsi-page").first().boundingBox())!;
    await studio.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await studio.page.keyboard.press("Enter");
    await studio.page.waitForSelector(".ainsi-studio__table");

    expect(await count(studio.page, "textarea")).toBe(0);
    await studio.page.locator(".ainsi-studio__grid input").nth(3).fill("Nopeus");
    await studio.page.keyboard.press("Meta+Enter");

    const after = await until(studio.source, t => t.includes("Nopeus"));
    expect(after).toContain("<!-- ainsi: comparison -->");
    expect(after).toContain("| Nopeus");
    await studio.stop();
}, 60_000);

test.skipIf(!chromium)("a row removed leaves the rest of the table alone", async () => {
    const studio = await open(TABLE_DECK);
    await openTable(studio);
    await studio.page.locator('.ainsi-studio__gridadd [title="Remove row"]').first().click();
    await studio.page.keyboard.press("Meta+Enter");

    const after = await until(studio.source, t => !t.includes("Apples"));
    expect(after).not.toContain("Apples");
    expect(after).toContain("Pears");
    expect(after).toContain("| Name");
    await studio.stop();
}, 60_000);
