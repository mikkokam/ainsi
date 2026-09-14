import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The landing's server side: theme previews, the recents store and the skills check. All of
 * it is plain fetch against the studio's dev server, no browser needed — the keyboard model
 * and layout are covered by a browser test elsewhere (or, for CI without chromium, by nothing;
 * see studio-browser.test.ts for that trade-off).
 */

const CLI = resolve(import.meta.dir, "..", "src", "cli.ts");

/** a studio process of its own, with an isolated HOME so recents.json and the skills check
 *  never touch the machine running the test. A deck named here is written before the process
 *  starts, since the studio tries to build whatever it is pointed at on launch. */
async function open(deck?: string) {
    const home = await mkdtemp(join(tmpdir(), "ainsi-home-"));
    const dir = await mkdtemp(join(tmpdir(), "ainsi-landing-"));
    if (deck !== undefined) await Bun.write(join(dir, "deck.md"), deck);
    const cmd = deck === undefined ? ["bun", CLI, "--port", "0"] : ["bun", CLI, join(dir, "deck.md"), "--port", "0"];

    const child = Bun.spawn({
        cmd,
        cwd: dir,
        env: { ...process.env, AINSI_HOST: "test", HOME: home },
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

    return {
        url,
        dir,
        home,
        async stop() {
            child.kill();
            await rm(dir, { recursive: true, force: true });
            await rm(home, { recursive: true, force: true });
        },
    };
}

/** polls for a condition rather than a duration, so a slow rebuild is slow and not wrong */
async function until<T>(what: () => Promise<T>, holds: (value: T) => boolean, ms = 10_000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
        const value = await what();
        if (holds(value)) return value;
        if (Date.now() > deadline) return value;
        await Bun.sleep(50);
    }
}

test("theme previews carry the shipped themes' real tokens, with no deck open yet", async () => {
    const studio = await open();
    const response = await fetch(`${studio.url}/__theme-previews`);
    expect(response.status).toBe(200);
    const { themes } = await response.json();
    const swiss = themes.find((t: { id: string }) => t.id === "swiss");
    expect(swiss).toMatchObject({ name: "Swiss", kind: "shipped", ground: "#ffffff", ink: "#000000", accent: "#e2231a", rule: "#000000" });
    // swiss's font-display is `var(--ainsi-font)`; the endpoint resolves it rather than handing back the raw reference
    expect(swiss.display).toContain("Helvetica");
    await studio.stop();
}, 30_000);

test("skills status is checked, not assumed: an isolated HOME with no plugin reports false", async () => {
    const studio = await open();
    const response = await fetch(`${studio.url}/__skills`);
    expect(await response.json()).toEqual({ installed: false });
    await studio.stop();
}, 30_000);

test("a new deck on a highlighted theme is born with that theme's frontmatter", async () => {
    const studio = await open();
    const response = await fetch(`${studio.url}/__new`, { method: "POST", body: JSON.stringify({ theme: "swiss" }) });
    expect(response.status).toBe(200);
    const { file } = await response.json();
    const source = await Bun.file(join(studio.dir, file)).text();
    expect(source).toContain("theme: swiss");
    await studio.stop();
}, 30_000);

test("opening a deck records it as a recent, with the page count and theme from its own build", async () => {
    const studio = await open("---\ntheme: acme\n---\n\n# Otsikko\n\nKappale.\n\n---\n\n# Toinen\n\nKappale.\n");
    // the initial build on launch runs before the server has printed its url, but the recents
    // write itself is not awaited by anything the launch line waits on
    const recents = await until(
        () => fetch(`${studio.url}/__recents`).then(r => r.json()),
        (list: unknown[]) => list.length > 0,
    );
    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({ file: "deck.md", pages: 2, theme: "acme", pinned: false });
    await studio.stop();
}, 30_000);

test("pinning a recent survives its next rebuild, and sorts it first", async () => {
    const studio = await open("# Otsikko\n\nKappale.\n");
    const first = await until(
        () => fetch(`${studio.url}/__recents`).then(r => r.json()),
        (list: unknown[]) => list.length > 0,
    );
    const path = (first[0] as { path: string }).path;

    await fetch(`${studio.url}/__pin`, { method: "POST", body: JSON.stringify({ path, pinned: true }) });
    // a second deck, opened after the pin, must not knock the pinned one out of first place
    await fetch(`${studio.url}/__new`, { method: "POST", body: JSON.stringify({}) });
    await until(
        () => fetch(`${studio.url}/__recents`).then(r => r.json()),
        (list: { path: string }[]) => list.length > 1,
    );

    const after = await fetch(`${studio.url}/__recents`).then(r => r.json());
    expect(after[0]).toMatchObject({ path, pinned: true });
    await studio.stop();
}, 30_000);

test("a recent whose file is gone is still listed, marked not found", async () => {
    const studio = await open("# Otsikko\n\nKappale.\n");
    await until(
        () => fetch(`${studio.url}/__recents`).then(r => r.json()),
        (list: unknown[]) => list.length > 0,
    );
    await rm(join(studio.dir, "deck.md"));
    const after = await fetch(`${studio.url}/__recents`).then(r => r.json());
    expect(after[0]).toMatchObject({ found: false });
    await studio.stop();
}, 30_000);

test("the samples list carries each shipped deck's own title, theme and page count", async () => {
    const studio = await open();
    const response = await fetch(`${studio.url}/__samples`);
    expect(response.status).toBe(200);
    const samples = await response.json();
    const meridian = samples.find((s: { id: string }) => s.id === "meridian");
    expect(meridian).toMatchObject({ theme: "swiss", ground: "#ffffff" });
    expect(meridian.pages).toBeGreaterThan(1);
    await studio.stop();
}, 30_000);

test("copying a sample writes a folder of its own and leaves the shipped deck alone", async () => {
    const studio = await open();
    const shipped = resolve(import.meta.dir, "..", "samples", "boring-inc", "boring-inc.md");
    const before = await Bun.file(shipped).text();

    const response = await fetch(`${studio.url}/__sample-copy`, { method: "POST", body: JSON.stringify({ id: "boring-inc" }) });
    expect(response.status).toBe(200);
    const { path } = await response.json();
    // macOS resolves the temp dir through /private, so the tail is what this can assert on
    expect(path).toEndWith(join("boring-inc", "boring-inc.md"));
    expect(await Bun.file(path).text()).toBe(before);

    // a second copy is a second folder rather than an overwrite of the first
    const again = await fetch(`${studio.url}/__sample-copy`, { method: "POST", body: JSON.stringify({ id: "boring-inc" }) });
    expect((await again.json()).path).toEndWith(join("boring-inc-2", "boring-inc.md"));

    expect(await Bun.file(shipped).text()).toBe(before);
    await studio.stop();
}, 30_000);

test("a theme tile's cover is headed with the theme, not with the title of the sample it borrows", async () => {
    const studio = await open();
    // default's sample is lehto, whose own h1 is "Lehto & Mänty" and whose frontmatter opens
    // with a `#` comment line the heading swap must not take for the title
    const { html } = await fetch(`${studio.url}/__thumb?theme=default`).then(r => r.json());
    expect(html).toContain("Default");
    expect(html).not.toContain("Lehto &");
    await studio.stop();
}, 30_000);
