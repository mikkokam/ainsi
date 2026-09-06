/*
 * Studio proof of concept. Click an entity: its markdown slice opens for editing. Blur
 * commits: a splice into the source file by offset, over /__edit. The dev server's watcher
 * rebuilds and reloads; the only browser state is the open editor.
 *
 * Two placements, one mechanism. A prose-shaped entity (heading, paragraph) edits in place:
 * the rendered element hides and the textarea takes its box, wearing its computed type, so
 * the text reads as having become editable. A structure-shaped entity (image, list, table)
 * keeps its rendered form, dimmed, and the editor floats over it in source monospace.
 *
 * Alt-click inserts a new block below. Arrow past the top or bottom of a textarea flows to
 * the neighbouring entity. Escape cancels. Emptying a block deletes it. The viewer's
 * shortcut card lists these; the studio only supplies its rows.
 *
 * Raw mode is the same mechanism at full size: the whole file in CodeMirror, replacing the
 * rendered deck in place, committed as a whole-file splice through the same hash guard.
 */

import { EditorView, minimalSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";

interface DocEntity { id: string; kind: string; start: number; end: number; md: string }
interface Doc { hash: string; source: string; file: string; entities: DocEntity[] }

type Caret = "start" | "end";
type Mode = "inplace" | "overlay" | "insert";

let doc: Doc = { hash: "", source: "", file: "", entities: [] };
let open = false;

/*
 * An open editor holds the reload: the server's SSE handler defers to __pacReload, and a
 * reload that arrives mid-edit waits until the editor closes instead of eating the buffer.
 * A commit releases its hold before writing, because that write is what causes the reload.
 */
let holding = 0;
let pendingReload = false;

function hold(): () => void {
    holding++;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holding--;
    };
}

(window as unknown as { __pacReload(): void }).__pacReload = () => {
    if (holding > 0) {
        pendingReload = true;
        hint("the file changed elsewhere; reloads when this editor closes");
        return;
    }
    location.reload();
};

const SCROLL = "pac-scroll";
const REOPEN = "pac-reopen";
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** raw mode, when open: the whole file in one CodeMirror view over the rendered deck */
let raw: { view: EditorView; container: HTMLElement; release(): void } | undefined;
let discardArmed: ReturnType<typeof setTimeout> | undefined;

init();

async function init(): Promise<void> {
    doc = await (await fetch("/__doc")).json();
    document.body.setAttribute("data-pac-edit", "");

    const scrolled = sessionStorage.getItem(SCROLL);
    if (scrolled) scrollTo(0, Number(scrolled));
    addEventListener("scroll", () => sessionStorage.setItem(SCROLL, String(scrollY)), { passive: true });

    document.addEventListener("click", event => {
        if (open || document.body.hasAttribute("data-present")) return;
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-pac-entity], [data-pac-span]");
        if (!target) return;
        const range = rangeOf(target);
        if (!range) return;
        event.preventDefault();
        if (event.altKey) insertAfter(target, range.end);
        else edit(target, range, "end");
    });

    const reopen = sessionStorage.getItem(REOPEN);
    if (reopen !== null) {
        sessionStorage.removeItem(REOPEN);
        const [index, caret] = reopen.split("|");
        openAt(Number(index), (caret as Caret) ?? "end");
    }

    // the viewer's menu announces itself on open and offers a slot; theme and export are
    // studio business, because both need the server and the player ships without one
    document.addEventListener("pac:menu", event => {
        const { panel, slot } = (event as CustomEvent).detail as { panel: HTMLElement; slot: HTMLElement };
        slot.append(
            menuItem("Edit source (E)", () => openRaw()),
            menuItem("Theme…", () => themeDrill(panel)),
            menuItem("Export…", () => exportDrill(panel)),
        );
    });

    document.addEventListener("pac:keys", event => {
        const { mode, rows, mod, alt } = (event as CustomEvent).detail as { mode: string; rows: [string, string][]; mod: string; alt: string };
        if (mode === "Editing" && raw) rows.push([`${mod} ⏎`, "save"], [`${mod} F`, "find"], ["esc", "cancel"]);
        else if (mode === "Editing") rows.push([`${mod} ⏎`, "commit"], ["esc", "cancel"], ["↑ ↓ at the edge", "previous / next block"], [`${mod} B`, "bold"], [`${mod} I`, "italic"], ["empty", "deletes the block"]);
        if (mode === "Studio") rows.unshift(["click", "edit"], [`${alt} click`, "add a block below"], ["E", "edit the whole file"]);
    });

    // a bare key, not a chord: ⌘E belongs to the browser's own Edit menu in Chromium, and a
    // single key can only fire in the one state the toggle is valid in, nothing focused
    document.addEventListener("keydown", event => {
        if (event.key !== "e" || event.metaKey || event.ctrlKey || event.altKey) return;
        if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
        if (raw || open || document.body.hasAttribute("data-present")) return;
        event.preventDefault();
        openRaw();
    });
}

function menuItem(text: string, onClick: () => void): HTMLButtonElement {
    const row = document.createElement("button");
    row.className = "pac-menu__item";
    row.type = "button";
    row.textContent = text;
    row.addEventListener("click", onClick);
    return row;
}

/** a drill replaces the menu's panel with one section, in place */
function drill(panel: HTMLElement, title: string, ...rows: HTMLElement[]): void {
    const header = document.createElement("div");
    header.className = "pac-menu__head";
    header.textContent = title;
    panel.replaceChildren(header, ...rows);
}

async function themeDrill(panel: HTMLElement): Promise<void> {
    const { themes, current } = await (await fetch("/__themes")).json() as { themes: string[]; current: string };
    drill(panel, "Theme", ...themes.map(theme => {
        const row = menuItem(theme, () => splice(themeChange(theme)));
        if (theme === current) row.setAttribute("data-active", "");
        return row;
    }));
}

/*
 * Export writes beside the deck under its own name and replaces what is there; the server
 * fits, prints and opens the file, so the studio only reports how it went.
 */
function exportDrill(panel: HTMLElement): void {
    const target = `${doc.file.replace(/\.[^.]+$/, "")}.pdf`;
    drill(panel, "Export", menuItem(`PDF, as ${target}`, async () => {
        hint(`writing ${target}…`);
        try {
            const response = await fetch("/__pdf", { method: "POST" });
            if (response.ok) hint(`wrote ${target}`);
            else hint(await response.text() || `export failed: ${response.status}`, true);
        } catch {
            hint("export failed: server unreachable", true);
        }
    }));
}

/** the theme is one frontmatter line; changing it is a splice like any other edit */
function themeChange(theme: string): { start: number; end: number; text: string } {
    const matter = /^---\n([\s\S]*?)\n---/.exec(doc.source);
    if (matter) {
        const line = /^theme:.*$/m.exec(matter[1]!);
        if (line) {
            const start = 4 + line.index;
            return { start, end: start + line[0].length, text: `theme: ${theme}` };
        }
        return { start: 4, end: 4, text: `theme: ${theme}\n` };
    }
    return { start: 0, end: 0, text: `---\ntheme: ${theme}\n---\n\n` };
}

interface Range { start: number; end: number; md: string; kind: string }

/** an entity handle is one slice; a block handle spans the entities its component inlined */
function rangeOf(target: HTMLElement): Range | undefined {
    const byId = (id: string | undefined) => doc.entities.find(e => e.id === id);
    if (target.dataset.pacEntity) {
        const entity = byId(target.dataset.pacEntity);
        return entity && { start: entity.start, end: entity.end, md: entity.md, kind: entity.kind };
    }
    const [firstId, lastId] = (target.dataset.pacSpan ?? "").split(" ");
    const first = byId(firstId);
    const last = byId(lastId);
    return first && last
        ? { start: first.start, end: last.end, md: doc.source.slice(first.start, last.end), kind: "block" }
        : undefined;
}

/** every edit target in document order: entity handles and the block handles between them */
const wrappers = () => [...document.querySelectorAll<HTMLElement>("[data-pac-entity], [data-pac-span]:not([data-pac-entity])")];

/** ids are content hashes and change on every commit, so flow lands by position */
function openAt(index: number, caret: Caret): void {
    const all = wrappers();
    const target = all[Math.max(0, Math.min(all.length - 1, index))];
    const range = target && rangeOf(target);
    if (target && range) edit(target, range, caret);
}

function edit(target: HTMLElement, range: Range, caret: Caret): void {
    const mode: Mode = range.kind === "heading" || range.kind === "paragraph" ? "inplace" : "overlay";
    openEditor(target, {
        initial: range.md,
        caret,
        mode,
        commit: text => (text === range.md ? undefined : { start: range.start, end: range.end, text }),
    });
}

function insertAfter(target: HTMLElement, at: number): void {
    openEditor(target, {
        initial: "",
        caret: "end",
        mode: "insert",
        placeholder: "markdown… a blank line makes two blocks",
        commit: text => (text.trim() ? { start: at, end: at, text: `\n\n${text.trim()}` } : undefined),
    });
}

interface EditorOptions {
    initial: string;
    caret: Caret;
    mode: Mode;
    placeholder?: string;
    /** undefined means nothing changed: close with no write */
    commit(text: string): { start: number; end: number; text: string } | undefined;
}

function openEditor(target: HTMLElement, options: EditorOptions): void {
    const area = document.createElement("textarea");
    area.rows = 1;                                      // the default of 2 floors scrollHeight a row too high
    area.className = `pac-studio__editor pac-studio__editor--${options.mode}`;
    area.value = options.initial;
    if (options.placeholder) area.placeholder = options.placeholder;

    if (options.mode === "inplace") {
        // measured and styled before the element hides, so the textarea takes its box
        const rect = target.getBoundingClientRect();
        const style = getComputedStyle(target);
        for (const property of ["font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "margin"] as const) {
            area.style.setProperty(property, style.getPropertyValue(property));
        }
        area.style.minHeight = `${rect.height}px`;
        target.insertAdjacentElement("afterend", area);
        target.classList.add("pac-studio--hidden");
    } else if (options.mode === "overlay") {
        const rect = target.getBoundingClientRect();
        area.style.left = `${rect.left + scrollX}px`;
        area.style.top = `${rect.top + scrollY}px`;
        area.style.width = `${Math.min(rect.width, 680)}px`;
        document.body.append(area);
        target.classList.add("pac-studio--dim");
    } else {
        target.insertAdjacentElement("afterend", area);
    }
    open = true;

    size(area);
    area.focus();
    const at = options.caret === "end" ? area.value.length : 0;
    area.setSelectionRange(at, at);
    area.addEventListener("input", () => size(area));

    let done = false;
    const release = hold();
    const close = () => {
        open = false;
        area.remove();
        target.classList.remove("pac-studio--hidden", "pac-studio--dim");
        release();
        if (pendingReload && holding === 0) location.reload();
    };

    const commit = async (flowTo?: number, caret: Caret = "end") => {
        if (done) return;
        done = true;
        const change = options.commit(area.value);
        if (!change) {
            close();
            if (flowTo !== undefined) openAt(flowTo, caret);
            return;
        }
        // the editor stays, frozen, until the rebuilt page arrives: closing it now would
        // flash the old rendered value for the length of the commit round trip
        area.readOnly = true;
        release();      // this write causes the next reload; a stale hash 409s and reloads anyway
        // the write reloads the page, so the flow target survives in sessionStorage
        if (flowTo !== undefined) sessionStorage.setItem(REOPEN, `${flowTo}|${caret}`);
        await splice(change);
    };

    area.addEventListener("blur", () => commit());
    area.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            done = true;
            close();
            return;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commit(); return; }
        if ((event.key === "b" || event.key === "i") && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            mark(area, event.key === "b" ? "**" : "*");
            return;
        }
        const index = wrappers().indexOf(target);
        if (index === -1) return;                       // a block handle has no place in the flow
        const collapsed = area.selectionStart === area.selectionEnd;
        if (event.key === "ArrowDown" && collapsed && area.selectionStart === area.value.length) {
            event.preventDefault();
            commit(index + 1, "start");
        }
        if (event.key === "ArrowUp" && collapsed && area.selectionStart === 0 && index > 0) {
            event.preventDefault();
            commit(index - 1, "end");
        }
    });
}

/*
 * Raw mode. Inline, not split: the source replaces the rendered deck, one toggle. The buffer
 * is the same kind of state as a block textarea, alive while open, dead on commit; a commit
 * is a whole-file replace through the hash guard, so the server learns nothing new.
 */
async function openRaw(): Promise<void> {
    if (raw || open || document.body.hasAttribute("data-present")) return;
    // refetched rather than trusted: a held reload means the module's copy can be stale
    doc = await (await fetch("/__doc")).json();

    const container = document.createElement("div");
    container.className = "pac-studio__raw";

    const bar = document.createElement("div");
    bar.className = "pac-studio__rawbar";
    const name = document.createElement("span");
    name.className = "pac-studio__rawname";
    name.textContent = doc.file;
    const gap = document.createElement("span");
    gap.className = "pac-studio__rawgap";
    const cancel = barButton("Cancel", "esc", () => cancelRaw());
    const save = barButton("Save", `${MOD}⏎`, () => commitRaw());
    save.setAttribute("data-primary", "");
    bar.append(name, gap, cancel, save);

    const view = new EditorView({
        doc: doc.source,
        extensions: [
            minimalSetup,
            markdown(),
            EditorView.lineWrapping,
            highlightSelectionMatches(),
            keymap.of([
                ...searchKeymap,            // before ours, so Escape closes an open search first
                { key: "Mod-Enter", run: () => (commitRaw(), true) },
                { key: "Mod-s", run: () => (commitRaw(), true) },
                { key: "Escape", run: () => (cancelRaw(), true) },
            ]),
        ],
    });

    container.append(bar, view.dom);
    document.body.append(container);
    document.body.setAttribute("data-pac-raw", "");
    raw = { view, container, release: hold() };
    view.focus();
}

function barButton(text: string, key: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.className = "pac-studio__rawbutton";
    element.type = "button";
    element.textContent = text;
    element.title = key;
    element.addEventListener("click", onClick);
    return element;
}

async function commitRaw(): Promise<void> {
    if (!raw) return;
    const text = raw.view.state.doc.toString();
    if (text === doc.source) return closeRaw();
    // frozen, not closed, until the rebuilt page arrives; same reasoning as the block editor
    raw.container.setAttribute("data-committing", "");
    raw.view.contentDOM.setAttribute("contenteditable", "false");
    raw.release();
    await splice({ start: 0, end: doc.source.length, text });
}

function cancelRaw(): void {
    if (!raw || raw.container.hasAttribute("data-committing")) return;
    if (raw.view.state.doc.toString() !== doc.source && !discardArmed) {
        hint("unsaved changes; esc again to discard");
        discardArmed = setTimeout(() => (discardArmed = undefined), 1600);
        return;
    }
    clearTimeout(discardArmed);
    discardArmed = undefined;
    closeRaw();
}

function closeRaw(): void {
    if (!raw) return;
    raw.view.destroy();
    raw.container.remove();
    raw.release();
    raw = undefined;
    document.body.removeAttribute("data-pac-raw");
    document.querySelector(".pac-studio__hint")?.remove();
    if (pendingReload && holding === 0) location.reload();
}

async function splice(change: { start: number; end: number; text: string }): Promise<void> {
    let failure: string | undefined;
    try {
        const response = await fetch("/__edit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hash: doc.hash, ...change }),
        });
        if (!response.ok) {
            failure = response.status === 409 ? "the file changed under the studio; reloading" : `edit failed: ${response.status}`;
        }
    } catch {
        failure = "edit failed: server unreachable; reloading";
    }
    if (failure) {
        sessionStorage.removeItem(REOPEN);
        hint(failure, true);
        setTimeout(() => location.reload(), 900);
    }
    // on success the watcher rebuilds and the reload arrives over the existing SSE channel
}

function mark(area: HTMLTextAreaElement, marker: string): void {
    const { selectionStart: a, selectionEnd: b, value } = area;
    area.setRangeText(`${marker}${value.slice(a, b)}${marker}`, a, b, "select");
    size(area);
}

function size(area: HTMLTextAreaElement): void {
    area.style.height = "auto";
    // scrollHeight is content only; the offset/client difference restores the border
    area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
}

function hint(text: string, alarm = false): void {
    document.querySelector(".pac-studio__hint")?.remove();
    const bar = document.createElement("div");
    bar.className = `pac-studio__hint${alarm ? " pac-studio__hint--alarm" : ""}`;
    bar.textContent = text;
    document.body.append(bar);
}
