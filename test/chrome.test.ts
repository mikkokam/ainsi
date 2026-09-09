import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Studio chrome against viewer chrome. The toolbar is fixed in the top-left corner of the
 * window and a rail is placed at the top-left corner of whatever it points at, so a page that
 * fills the window puts them in the same place. This is geometry in a real layout, so it takes
 * a real browser, and a skip here is the same degrade a build without one gives.
 */

const chromium: boolean = await import("playwright-core")
    .then(({ chromium }) => chromium
        .launch(process.env.AINSI_CHROMIUM ? { executablePath: process.env.AINSI_CHROMIUM } : {})
        .then(browser => browser.close().then(() => true)))
    .catch(() => false);

const CLI = resolve(import.meta.dir, "../src/cli.ts");
const DECK = "---\nlayout: header\n---\n\n# Yksi\n\nEnsimmäinen\n\n---\n\n# Kaksi\n\nToinen\n";

/** the studio on a deck of its own, so no sample gets an html written beside it */
async function studio() {
    const dir = await mkdtemp(join(tmpdir(), "ainsi-chrome-"));
    const deck = join(dir, "deck.md");
    await Bun.write(deck, DECK);
    const child = Bun.spawn({
        cmd: ["bun", CLI, deck, "--port", "0"],
        // the host flag lets it start without a terminal; the pipe is the lifeline it watches
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
    return { url, stop: async () => { child.kill(); await rm(dir, { recursive: true, force: true }); } };
}

interface Box { left: number; top: number; right: number; bottom: number }
const overlap = (a: Box | null, b: Box | null) =>
    !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

test.skipIf(!chromium)("no rail is placed under the viewer's toolbar, at any window size", async () => {
    const { chromium: browserType } = await import("playwright-core");
    const server = await studio();
    const browser = await browserType.launch(process.env.AINSI_CHROMIUM ? { executablePath: process.env.AINSI_CHROMIUM } : {});

    // wide enough that the page is letterboxed, and tight enough that it fills the window
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1000, height: 560 }, { width: 700, height: 420 }]) {
        const page = await browser.newPage({ viewport });
        await page.goto(server.url, { waitUntil: "load" });
        await page.waitForSelector(".ainsi-toolbar");

        // in from the middle, so the rails see a move rather than the pointer starting on them
        const first = (await page.locator(".ainsi-page").first().boundingBox())!;
        await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
        await page.mouse.move(first.x + 10, first.y + 10);
        await page.waitForFunction(() => [...document.querySelectorAll(".ainsi-studio__rail")].some(r => !(r as HTMLElement).hidden));

        const { toolbar, rails } = await page.evaluate(() => {
            const box = (el: Element | null) => {
                const e = el as HTMLElement | null;
                if (!e || e.hidden) return null;
                const { left, top, right, bottom, width } = e.getBoundingClientRect();
                return width ? { left, top, right, bottom } : null;
            };
            return {
                toolbar: box(document.querySelector(".ainsi-toolbar")),
                rails: [...document.querySelectorAll(".ainsi-studio__rail")].map(box),
            };
        });

        expect(toolbar).not.toBeNull();
        expect(rails.some(Boolean)).toBe(true);
        for (const rail of rails) expect(overlap(rail, toolbar)).toBe(false);
        await page.close();
    }

    await browser.close();
    await server.stop();
}, 60_000);
