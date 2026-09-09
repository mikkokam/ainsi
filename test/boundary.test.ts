import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/**
 * The layering, made checkable. One engine and three consumers of it:
 *
 *     engine    parse → paginate → group → fit → render, and the vocabulary
 *      ├─ cli     writes a file, headless, what an agent drives
 *      ├─ player  the viewer: toolbar and presentation mode, ships in the deck
 *      └─ studio  anything that edits, which is a dev-server concern and never in a deck
 *
 * The engine has to run wherever a renderer does, so it may not reach for the filesystem, a
 * browser binary, or Bun's own globals. Three modules are declared adapters and may; the
 * viewer is browser code and is a consumer rather than engine. Everything else is engine,
 * including anything added tomorrow — the default is the strict side of the fence on purpose,
 * because a rule you have to remember to opt into is a rule that erodes.
 */

const SRC = resolve(import.meta.dir, "..", "src");

/** The platform boundary. These modules exist to touch a platform; nothing else may. */
const ADAPTERS = new Set(["cli.ts", "load.ts", "serve.ts", "fit.ts", "pdf.ts", "pptx.ts", "pack.ts"]);

/** The player. Browser code by nature, so the rules below do not describe it. */
const CONSUMERS = new Set(["viewer"]);

async function engineModules(dir = SRC): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!CONSUMERS.has(entry.name)) found.push(...await engineModules(path));
        } else if (entry.name.endsWith(".ts") && !ADAPTERS.has(relative(SRC, path))) {
            found.push(path);
        }
    }
    return found;
}

/** Comments are stripped: a rule that cannot survive being explained in one is a bad rule. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const engine = await engineModules();
const source = new Map(await Promise.all(
    engine.map(async path => [relative(SRC, path), code(await Bun.file(path).text())] as const),
));

test("the engine is a real set of modules, not an empty one the rules pass over", () => {
    // a rename that emptied this list would make every rule below vacuously true
    expect([...source.keys()]).toContain("build.ts");
    expect([...source.keys()]).toContain("parse.ts");
    expect(source.size).toBeGreaterThan(8);
});

test("the engine reaches for no platform: no node builtins, no browser, no Bun globals", () => {
    // matched as imports and member access, never as bare words: `node: any` is an mdast
    // field and appears all over the engine, which is exactly the false positive that makes
    // a lazier grep useless here
    const offences: string[] = [];
    for (const [name, text] of source) {
        for (const [match] of text.matchAll(/from\s+"node:[a-z/]+"|require\("node:[a-z/]+"\)|\bBun\.\w+|playwright/g)) {
            offences.push(`${name}: ${match}`);
        }
    }
    expect(offences).toEqual([]);
});

test("the engine imports no adapter, so the dependency runs one way", () => {
    // the direction is the whole point: an adapter may build on the engine, and an engine
    // module that reached back for `load` or `serve` would drag a platform in behind it
    const offences: string[] = [];
    for (const [name, text] of source) {
        for (const [, specifier] of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
            const module = specifier!.split("/").pop()!;
            if (ADAPTERS.has(`${module}.ts`)) offences.push(`${name} imports ${module}`);
        }
    }
    expect(offences).toEqual([]);
});

test("every adapter named in the fence exists", () => {
    // a deleted or renamed adapter must fail here rather than silently widen what may be dirty
    const missing = [...ADAPTERS].filter(name => !Bun.file(join(SRC, name)).size);
    expect(missing).toEqual([]);
});
