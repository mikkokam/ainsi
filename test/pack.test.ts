import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pack, zip } from "../src/pack";
import type { Diagnostic } from "../src/types";

/**
 * The deck as one file someone else can open and carry on editing. What is checked here is the
 * property the whole thing exists for: unpack it somewhere else and it is still the same deck.
 */

const PNG = resolve(import.meta.dir, "..", "desktop", "icon.png");

/** a deck with one reference of every kind: beside it, outside it, a logo, a theme, and a miss */
async function deck() {
    const root = await mkdtemp(join(tmpdir(), "ainsi-pack-"));
    await mkdir(join(root, "deck", "assets"), { recursive: true });
    await mkdir(join(root, "outside"), { recursive: true });
    await mkdir(join(root, "mytheme", "layouts", "header"), { recursive: true });
    const png = await Bun.file(PNG).bytes();
    for (const at of ["deck/assets/inside.png", "deck/assets/mark.png", "outside/far.png"]) {
        await Bun.write(join(root, at), png);
    }
    await Bun.write(join(root, "mytheme/variables.css"), ":root { --ainsi-ink: #111; }");
    await Bun.write(join(root, "mytheme/layouts/header/style.css"), '[data-layout="header"] { color: red; }');
    await Bun.write(join(root, "deck/d.md"), [
        "---", "theme: ../mytheme", "logo: assets/mark.png", "---", "",
        "# Yksi", "", "![inside](assets/inside.png)", "",
        "<!-- ainsi: figures -->", "",
        "- ![far](../outside/far.png)", "- ![again](assets/inside.png)", "",
        "---", "", "# Kaksi", "", "![gone](assets/nope.png)", "",
    ].join("\n"));
    return { root, md: join(root, "deck", "d.md"), stop: () => rm(root, { recursive: true, force: true }) };
}

/** the archive read back through the system's own unzip, not through our writer */
async function unpack(bytes: Uint8Array, into: string): Promise<string[]> {
    const archive = join(into, "packed.zip");
    await Bun.write(archive, bytes);
    const run = Bun.spawnSync(["unzip", "-q", archive, "-d", into]);
    expect(run.exitCode).toBe(0);
    const listed = Bun.spawnSync(["unzip", "-Z1", archive]);
    return new TextDecoder().decode(listed.stdout).trim().split("\n").sort();
}

test("a packed deck holds what it references, and nothing else it sits beside", async () => {
    const source = await deck();
    // the outputs a build leaves behind are not the deck and must not travel with it
    await Bun.write(join(source.root, "deck", "d.html"), "<html></html>");
    await Bun.write(join(source.root, "deck", "other.md"), "# not this one");

    const diagnostics: Diagnostic[] = [];
    const packed = await pack(source.md, diagnostics);
    const into = await mkdtemp(join(tmpdir(), "ainsi-unpack-"));
    const names = await unpack(packed.bytes, into);

    expect(names).toEqual([
        "d/assets/far.png", "d/assets/inside.png", "d/assets/mark.png", "d/d.md",
        "d/theme/layouts/header/style.css", "d/theme/variables.css",
    ]);
    expect(diagnostics.map(d => d.message)).toEqual(["not found beside the deck, so not packed: assets/nope.png"]);

    await rm(into, { recursive: true, force: true });
    await source.stop();
});

test("what reaches outside the folder is carried in and its link rewritten; the rest is left alone", async () => {
    const source = await deck();
    const packed = await pack(source.md);
    const into = await mkdtemp(join(tmpdir(), "ainsi-unpack-"));
    await unpack(packed.bytes, into);
    const moved = await Bun.file(join(into, "d", "d.md")).text();

    expect(moved).toContain("![far](assets/far.png)");           // came from ../outside
    expect(moved).toContain("![inside](assets/inside.png)");     // already inside, untouched
    expect(moved).toContain("theme: ./theme");
    expect(moved).toContain("logo: assets/mark.png");
    expect(moved).toContain("![gone](assets/nope.png)");         // a miss is reported, never dropped

    await rm(into, { recursive: true, force: true });
    await source.stop();
});

test("the same deck packs to the same bytes, so two archives diff as decks", async () => {
    const source = await deck();
    const once = await pack(source.md);
    const twice = await pack(source.md);
    expect(Buffer.from(once.bytes).equals(Buffer.from(twice.bytes))).toBe(true);
    await source.stop();
});

test("a file survives the round trip byte for byte", async () => {
    const bytes = await Bun.file(PNG).bytes();
    const into = await mkdtemp(join(tmpdir(), "ainsi-zip-"));
    await unpack(zip([{ path: "a/pic.png", bytes }]), into);
    const back = await Bun.file(join(into, "a", "pic.png")).bytes();
    expect(Buffer.from(back).equals(Buffer.from(bytes))).toBe(true);
    await rm(into, { recursive: true, force: true });
});
