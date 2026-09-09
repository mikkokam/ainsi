import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { images, parse } from "./parse";
import type { Diagnostic } from "./types";

/*
 * The deck as one file someone else can open and carry on editing.
 *
 * The archive is a courier, not a format. Nothing ever reads it as an archive: it is unpacked
 * and what is inside is an ordinary deck folder, plain text and pictures, editable by anything.
 * That is the whole difference from a slide format that happens to be a zip, and the reason
 * there is no manifest inside it. The folder layout is the manifest.
 *
 * Only what the deck references travels. A deck's folder also holds its own html, its pdf and
 * often other decks, and none of that is the deck.
 */

/** where a reference lands inside the archive when it came from outside the deck's folder */
const CARRIED = "assets";
/** the folder a relative theme is copied into, so the frontmatter can name it the same way always */
const THEME = "theme";

export interface Packed {
    bytes: Uint8Array;
    /** the folder name inside the archive, which is the deck's own name */
    name: string;
    diagnostics: Diagnostic[];
}

export async function pack(deck: string, diagnostics: Diagnostic[] = []): Promise<Packed> {
    const dir = dirname(deck);
    const name = basename(deck, extname(deck));
    const source = await Bun.file(deck).text();
    const parsed = parse(source);

    const files = new Map<string, Uint8Array>();
    /** what a url outside the folder was renamed to, so the same picture is carried once */
    const carried = new Map<string, string>();
    /** splices into the markdown, applied from the end so earlier offsets stay true */
    const edits: { start: number; end: number; text: string }[] = [];

    /*
     * A reference already inside the deck's folder keeps the path it has: the markdown is what
     * the recipient reads, and an export that rewrote every link would arrive worse than it
     * left. Only what reaches outside is copied in and renamed.
     */
    async function carry(url: string): Promise<string | undefined> {
        if (/^(https?:|data:|#)/.test(url)) return undefined;
        const from = resolve(dir, url);
        const file = Bun.file(from);
        if (!(await file.exists())) {
            diagnostics.push({ level: "warn", message: `not found beside the deck, so not packed: ${url}` });
            return undefined;
        }

        const inside = relative(dir, from);
        if (!inside.startsWith("..")) {
            files.set(inside, await file.bytes());
            return undefined;                       // the link already says where it is
        }

        const held = carried.get(from);
        if (held) return held;
        const at = free(join(CARRIED, basename(from)), files);
        files.set(at, await file.bytes());
        carried.set(from, at);
        return at;
    }

    for (const image of images(parsed.doc.entities)) {
        const moved = await carry(image.url);
        if (moved && image.span) edits.push(...rewrite(source, image.span, image.url, moved));
    }

    // the logos are frontmatter, so the search for what to replace is bounded by it: a path
    // like assets/mark.png is short enough to appear in the body meaning something else
    const settings = parsed.doc.settings;
    const matter = MATTER.exec(source);
    for (const key of ["logo", "coverLogo"] as const) {
        const url = settings[key];
        if (!url || !matter) continue;
        const moved = await carry(url);
        if (moved) edits.push(...rewrite(source, { start: 0, end: matter[0].length }, url, moved));
    }

    if (settings.theme.startsWith(".") || settings.theme.includes("/")) {
        const copied = await folder(resolve(dir, settings.theme), THEME, files);
        if (copied && matter) {
            edits.push(...rewrite(source, { start: 0, end: matter[0].length }, settings.theme, `./${THEME}`));
        } else if (!copied) {
            diagnostics.push({ level: "warn", message: `theme folder not found, so not packed: ${settings.theme}` });
        }
    }

    files.set(basename(deck), new TextEncoder().encode(splice(source, edits)));
    return { bytes: zip([...files].map(([path, bytes]) => ({ path: `${name}/${path}`, bytes }))), name, diagnostics };
}

/** the frontmatter, which is where a logo path is written */
const MATTER = /^---\n[\s\S]*?\n---\n*/;

/** the url replaced only inside the span that holds it, never anywhere else it happens to read */
function rewrite(source: string, span: { start: number; end: number }, from: string, to: string) {
    const edits: { start: number; end: number; text: string }[] = [];
    const within = source.slice(span.start, span.end);
    for (let i = within.indexOf(from); i !== -1; i = within.indexOf(from, i + 1)) {
        edits.push({ start: span.start + i, end: span.start + i + from.length, text: to });
    }
    return edits;
}

/** splices applied from the end, so an earlier offset is still the offset it was */
function splice(source: string, edits: { start: number; end: number; text: string }[]): string {
    let out = source;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    return out;
}

/** a name nothing else has taken; a picture called cover.png from two folders needs two */
function free(path: string, files: Map<string, unknown>): string {
    if (!files.has(path)) return path;
    const stem = path.slice(0, path.length - extname(path).length);
    for (let n = 2; ; n++) {
        const candidate = `${stem}-${n}${extname(path)}`;
        if (!files.has(candidate)) return candidate;
    }
}

/** a whole folder, one level of nesting deep, which is as deep as a theme goes */
async function folder(from: string, into: string, files: Map<string, Uint8Array>): Promise<boolean> {
    let entries;
    try {
        entries = await readdir(from, { withFileTypes: true });
    } catch {
        return false;
    }
    for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const path = join(from, entry.name);
        if (entry.isDirectory()) await folder(path, join(into, entry.name), files);
        else files.set(join(into, entry.name), await Bun.file(path).bytes());
    }
    return true;
}

/*
 * A zip, written here rather than taken from a dependency. Bun has no zip writer, but
 * `deflateSync` with a negative window is raw deflate, which is exactly what a zip entry
 * stores; the rest is two headers, a directory and a checksum.
 *
 * A zip rather than the tar.gz Bun does ship, because whoever receives a deck is often not a
 * developer and a zip opens with a double click on every machine there is.
 */
export function zip(files: { path: string; bytes: Uint8Array }[]): Uint8Array {
    const local: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;

    for (const { path, bytes } of files) {
        const deflated = Bun.deflateSync(bytes, { windowBits: -15 });
        const name = new TextEncoder().encode(path);
        const sum = crc32(bytes);

        const head = new Uint8Array(30 + name.length);
        const h = new DataView(head.buffer);
        h.setUint32(0, 0x04034b50, true);
        h.setUint16(4, 20, true);                   // the version that understands deflate
        h.setUint16(8, 8, true);                    // deflated
        h.setUint16(12, DOS_DATE, true);
        h.setUint32(14, sum, true);
        h.setUint32(18, deflated.length, true);
        h.setUint32(22, bytes.length, true);
        h.setUint16(26, name.length, true);
        head.set(name, 30);

        const entry = new Uint8Array(46 + name.length);
        const e = new DataView(entry.buffer);
        e.setUint32(0, 0x02014b50, true);
        e.setUint16(4, 20, true);
        e.setUint16(6, 20, true);
        e.setUint16(10, 8, true);
        e.setUint16(14, DOS_DATE, true);
        e.setUint32(16, sum, true);
        e.setUint32(20, deflated.length, true);
        e.setUint32(24, bytes.length, true);
        e.setUint16(28, name.length, true);
        e.setUint32(42, offset, true);
        entry.set(name, 46);

        local.push(head, deflated);
        central.push(entry);
        offset += head.length + deflated.length;
    }

    const size = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, offset, true);

    const out = new Uint8Array(offset + size + 22);
    let at = 0;
    for (const chunk of [...local, ...central, end]) { out.set(chunk, at); at += chunk.length; }
    return out;
}

/*
 * A fixed timestamp, 1 January 2020, rather than the clock. Packing the same deck twice should
 * give the same bytes, so a diff of two archives is a diff of the deck.
 */
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

const TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const byte of bytes) c = TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
