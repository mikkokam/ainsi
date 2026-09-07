import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// a 1x1 png
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("a build inlines a local image as a data url and leaves a remote one alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ainsi-"));
    await writeFile(join(dir, "pic.png"), PNG);
    await writeFile(join(dir, "deck.md"), "# A\n\n![local](pic.png)\n\n---\n\n# B\n\n![remote](https://example.com/x.png)\n");
    const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "src", "cli.ts"), "build", join(dir, "deck.md")], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    const html = await Bun.file(join(dir, "deck.html")).text();
    expect(html).toContain(`src="data:image/png;base64,${PNG.toString("base64")}"`);
    expect(html).toContain('src="https://example.com/x.png"');
    expect(html).not.toContain('src="pic.png"');
});
