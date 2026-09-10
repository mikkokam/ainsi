import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * One studio, many decks. Both of these are about routing rather than about anything on screen:
 * which deck an id names, and that a second window on one file is never made. A browser shows
 * neither, so they are driven with fetch.
 */

const CLI = resolve(import.meta.dir, "..", "src", "cli.ts");

/** a studio of its own on a.md, with b.md beside it, and an isolated HOME for the recents store */
async function studio() {
    const home = await mkdtemp(join(tmpdir(), "ainsi-home-"));
    const dir = await mkdtemp(join(tmpdir(), "ainsi-decks-"));
    await Bun.write(join(dir, "a.md"), "# Yksi\n\nEnsimmäinen.\n");
    await Bun.write(join(dir, "b.md"), "# Kaksi\n\nToinen.\n");

    const child = Bun.spawn({
        cmd: ["bun", CLI, join(dir, "a.md"), "--port", "0"],
        cwd: dir,
        env: { ...process.env, AINSI_HOST: "test", HOME: home },
        stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    let root = "";
    let first = "";
    while (!first) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
        root ||= /studio on (\S+)/.exec(seen)?.[1] ?? "";
        first = /deck on (\S+)/.exec(seen)?.[1] ?? "";
    }

    return {
        root,
        first,
        dir,
        open: (path: string) => fetch(`${root}/__open`, { method: "POST", body: JSON.stringify({ path }) })
            .then(r => r.json() as Promise<{ id: string; url: string; file: string }>),
        async stop() {
            child.kill();
            await rm(dir, { recursive: true, force: true });
            await rm(home, { recursive: true, force: true });
        },
    };
}

test("a deck opened twice is the window it is already in, never a second one", async () => {
    const it = await studio();

    const once = await it.open(join(it.dir, "b.md"));
    const twice = await it.open(join(it.dir, "b.md"));
    expect(twice.id).toBe(once.id);

    // the deck the studio was launched on is no different: it is already open
    const again = await it.open(join(it.dir, "a.md"));
    expect(`${it.root}${again.url}`).toBe(it.first);

    const { decks } = await fetch(`${it.root}/__state`).then(r => r.json());
    expect(decks.map((d: { file: string }) => d.file).sort()).toEqual(["a.md", "b.md"]);
    await it.stop();
}, 30_000);

test("an edit through one deck's prefix reaches that deck and no other", async () => {
    const it = await studio();
    const b = await it.open(join(it.dir, "b.md"));

    expect(await fetch(`${it.root}${b.url}__doc`).then(r => r.json())).toMatchObject({ file: "b.md" });
    expect(await fetch(`${it.first}__doc`).then(r => r.json())).toMatchObject({ file: "a.md" });

    const { hash } = await fetch(`${it.root}${b.url}__doc`).then(r => r.json());
    const wrote = await fetch(`${it.root}${b.url}__edit`, {
        method: "POST",
        body: JSON.stringify({ hash, start: 0, end: 0, text: "# Nolla\n\n" }),
    });
    expect(wrote.status).toBe(200);
    expect(await Bun.file(join(it.dir, "b.md")).text()).toStartWith("# Nolla");
    expect(await Bun.file(join(it.dir, "a.md")).text()).toStartWith("# Yksi");

    // the same endpoint at the root names no deck, so it writes nothing
    expect((await fetch(`${it.root}/__edit`, { method: "POST", body: "{}" })).status).toBe(409);
    await it.stop();
}, 30_000);
