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
 * Right-click opens the block menu: turn the entity into another kind of block, render it
 * through another component, set that component's options, delete it. Each pick is one
 * splice computed in edits.ts and committed at once; the rebuild closes the menu.
 *
 * Raw mode is the same mechanism at full size: the whole file in CodeMirror, replacing the
 * rendered deck in place, committed as a whole-file splice through the same hash guard.
 */

import { EditorView, minimalSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { remove, render as structural, retag, textShaped, TEXT_KINDS, type Target, type TextKind } from "./edits";

interface DocEntity { id: string; kind: string; start: number; end: number; md: string; accepted: string[] }
interface DocBlock {
    ids: string[];
    component: string;
    origin: "directive" | "heuristic";
    props: Record<string, unknown>;
    accepted: string[];
    heuristic: string;
    directive?: { start: number; end: number };
    terminator?: { start: number; end: number };
}
interface Field { name: string; type: "enum" | "boolean" | "number" | "string"; options?: string[]; default?: unknown }
interface DocComponent { name: string; fields: Field[]; takesList: boolean }
interface Doc { hash: string; source: string; file: string; entities: DocEntity[]; blocks: DocBlock[]; components: DocComponent[] }

type Caret = "start" | "end";
type Mode = "inplace" | "overlay" | "insert";

let doc: Doc = { hash: "", source: "", file: "", entities: [], blocks: [], components: [] };

/*
 * One piece of chrome at a time: a block editor, raw mode, or the block menu. Opening one
 * closes what was open; every exit routes through shut(). `holds` is whether a reload must
 * wait for this chrome — editors hold, the menu does not — and a commit clears it, because
 * that write is what causes the next reload.
 */
interface Chrome { kind: "block" | "raw" | "menu"; holds: boolean; close(): void }
let chrome: Chrome | undefined;
let pendingReload = false;

function show(next: Chrome): void {
    chrome?.close();
    chrome = next;
}

function shut(): void {
    const current = chrome;
    chrome = undefined;
    current?.close();
    if (pendingReload) location.reload();
}

(window as unknown as { __pacReload(): void }).__pacReload = () => {
    if (chrome?.holds) {
        pendingReload = true;
        hint("the file changed elsewhere; reloads when this editor closes");
        return;
    }
    location.reload();
};

/** hyperscript: element, attributes (true = bare attribute, function = listener), children */
function h(tag: string, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElement {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (typeof value === "function") element.addEventListener(key, value as EventListener);
        else if (value === true) element.setAttribute(key, "");
        else if (value !== false && value !== undefined) element.setAttribute(key, String(value));
    }
    element.append(...children);
    return element;
}

const SCROLL = "pac-scroll";
const REOPEN = "pac-reopen";
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

init();

async function init(): Promise<void> {
    doc = await (await fetch("/__doc")).json();
    document.body.setAttribute("data-pac-edit", "");

    const scrolled = sessionStorage.getItem(SCROLL);
    if (scrolled) scrollTo(0, Number(scrolled));
    addEventListener("scroll", () => sessionStorage.setItem(SCROLL, String(scrollY)), { passive: true });

    document.addEventListener("click", event => {
        if (chrome?.kind === "block" || chrome?.kind === "raw" || document.body.hasAttribute("data-present")) return;
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-pac-entity], [data-pac-span]");
        if (!target) {
            if (chrome?.kind === "menu") shut();
            return;
        }
        const range = rangeOf(target);
        if (!range) return;
        event.preventDefault();
        if (event.altKey) insertAfter(target, range.end);
        else edit(target, range, "end");
    });

    document.addEventListener("contextmenu", event => {
        if (chrome?.kind === "block" || chrome?.kind === "raw" || document.body.hasAttribute("data-present")) return;
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-pac-entity], [data-pac-span]");
        if (!target) return;
        event.preventDefault();
        openMenu(target, event.clientX, event.clientY);
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
        const { panel, slot, close } = (event as CustomEvent).detail as { panel: HTMLElement; slot: HTMLElement; close(): void };
        slot.append(
            menuItem("Edit source (E)", () => openRaw()),
            menuItem("Theme…", () => themeDrill(panel)),
            menuItem("Export…", () => exportDrill(panel, close)),
        );
    });

    document.addEventListener("pac:keys", event => {
        const { mode, rows, mod, alt } = (event as CustomEvent).detail as { mode: string; rows: [string, string][]; mod: string; alt: string };
        if (mode === "Editing" && chrome?.kind === "raw") rows.push([`${mod} ⏎`, "save"], [`${mod} F`, "find"], ["esc", "cancel"]);
        else if (mode === "Editing") rows.push([`${mod} ⏎`, "commit"], ["esc", "cancel"], ["↑ ↓ at the edge", "previous / next block"], [`${mod} B`, "bold"], [`${mod} I`, "italic"], ["empty", "deletes the block"]);
        if (mode === "Studio") rows.unshift(["click", "edit"], [`${alt} click`, "add a block below"], ["E", "edit the whole file"]);
    });

    // a bare key, not a chord: ⌘E belongs to the browser's own Edit menu in Chromium, and a
    // single key can only fire in the one state the toggle is valid in, nothing focused
    document.addEventListener("keydown", event => {
        if (event.key !== "e" || event.metaKey || event.ctrlKey || event.altKey) return;
        if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
        if (chrome || document.body.hasAttribute("data-present")) return;
        event.preventDefault();
        openRaw();
    });
}

/*
 * The block menu. A kind change is the entity's own slice rewritten. A component change is
 * a directive: before the block's first entity when one already governs it, before the
 * clicked entity otherwise, bounded by an end marker when the heuristic's run would carry
 * on past it. A pick the heuristic would make anyway removes the directive instead.
 */
function openMenu(handle: HTMLElement, x: number, y: number): void {
    const id = handle.dataset.pacEntity ?? handle.dataset.pacSpan?.split(" ")[0];
    const entity = doc.entities.find(e => e.id === id);
    const block = doc.blocks.find(b => entity && b.ids.includes(entity.id));
    if (!entity || !block) return;

    const element = h("div", { class: "pac-studio__menu", click: (event: Event) => event.stopPropagation() });
    const section = (title: string, chips: HTMLElement[]) => element.append(h("div", { class: "pac-studio__menurow" },
        ...(title ? [h("div", { class: "pac-studio__menuhead" }, title)] : []),
        h("div", { class: "pac-studio__chips" }, ...chips)));

    if (handle.dataset.pacEntity && textShaped(entity.kind)) {
        const current = kindOf(entity);
        section("Turn into", TEXT_KINDS.map(kind => chip(KIND_LABEL[kind], kind === current, () =>
            splice({ start: entity.start, end: entity.end, text: retag(entity.md, entity.kind, kind) }))));
    }

    const target = targetFor(entity, block);
    section("Render as", doc.components.map(c => chip(c.name === block.heuristic ? `${c.name} · auto` : c.name, c.name === block.component, () => pick(target, block, c))));

    const component = doc.components.find(c => c.name === block.component);
    if (component?.fields.length) {
        section("Options", component.fields.map(field => control(field, block.props[field.name], value => {
            const props = explicit(component, { ...block.props, [field.name]: value });
            splice(structural(target, block.component === block.heuristic && !Object.keys(props).length ? null : block.component, props));
        })));
    }

    section("", [chip("Delete", false, () => splice(remove(doc.source, target)))]);

    document.body.append(element);
    const { width, height } = element.getBoundingClientRect();
    element.style.left = `${Math.min(x, innerWidth - width - 8)}px`;
    element.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
    const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") { event.preventDefault(); shut(); }
    };
    addEventListener("keydown", onKey);
    show({
        kind: "menu",
        holds: false,
        close() {
            element.remove();
            removeEventListener("keydown", onKey);
        },
    });
}

const KIND_LABEL: Record<TextKind, string> = { heading1: "H1", heading2: "H2", heading3: "H3", paragraph: "Text", list: "List", quote: "Quote" };

function kindOf(entity: DocEntity): TextKind | undefined {
    if (entity.kind === "heading") {
        const depth = /^#+/.exec(entity.md)?.[0].length ?? 1;
        return depth === 1 ? "heading1" : depth === 2 ? "heading2" : "heading3";
    }
    return entity.kind === "paragraph" ? "paragraph" : entity.kind === "list" ? "list" : entity.kind === "quote" ? "quote" : undefined;
}

/** a governed block is addressed as a whole; a heuristic one at the entity clicked */
function targetFor(entity: DocEntity, block: DocBlock): Target {
    const governed = block.origin === "directive";
    const first = governed ? doc.entities.find(e => e.id === block.ids[0])! : entity;
    const last = governed ? doc.entities.find(e => e.id === block.ids.at(-1))! : entity;
    const next = doc.entities[doc.entities.indexOf(last) + 1];
    return {
        start: first.start,
        end: last.end,
        md: doc.source.slice(first.start, last.end),
        kind: first.kind,
        ...(block.directive ? { directive: block.directive } : {}),
        ...(block.terminator ? { terminator: block.terminator } : {}),
        runsOn: !governed && block.ids.indexOf(entity.id) < block.ids.length - 1,
        beforeList: next?.kind === "list",
    };
}

function pick(target: Target, block: DocBlock, component: DocComponent): void {
    const accepted = block.origin === "directive" ? block.accepted : doc.entities.find(e => e.start === target.start)?.accepted ?? [];
    if (component.name === block.heuristic) {
        if (block.directive) splice(structural(target, null));
        else shut();
        return;
    }
    if (accepted.includes(component.name)) return void splice(structural(target, component.name));
    // the one reshape there is: a text block becomes a one-item list for a component that reads items
    const single = block.origin === "heuristic" || block.ids.length === 1;
    if (component.takesList && single && textShaped(target.kind)) {
        return void splice(structural(target, component.name, {}, retag(target.md, target.kind, "list")));
    }
    hint(`${component.name} cannot render this block`, true);
}

/** the props worth writing: those that differ from the schema's own defaults */
function explicit(component: DocComponent, props: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of component.fields) {
        const value = props[field.name];
        if (value !== undefined && value !== field.default) out[field.name] = value;
    }
    return out;
}

const chip = (text: string, active: boolean, onClick: () => void): HTMLElement =>
    h("button", { class: "pac-studio__chip", type: "button", "data-active": active, click: onClick }, text);

function control(field: Field, value: unknown, onChange: (value: unknown) => void): HTMLElement {
    const wrap = h("div", { class: "pac-studio__field" }, h("span", { class: "pac-studio__fieldname" }, field.name));
    if (field.type === "enum") {
        wrap.append(...(field.options ?? []).map(option => chip(option, option === value, () => onChange(option))));
    } else if (field.type === "boolean") {
        wrap.append(chip(value ? "on" : "off", value === true, () => onChange(!value)));
    } else {
        const input = h("input", {
            class: "pac-studio__input",
            type: field.type === "number" ? "number" : "text",
            value: value === undefined ? "" : String(value),
            keydown: (event: KeyboardEvent) => {
                if (event.key === "Enter") onChange(field.type === "number" ? Number((input as HTMLInputElement).value) : (input as HTMLInputElement).value);
                if (event.key === "Escape") shut();
                event.stopPropagation();
            },
        });
        wrap.append(input);
    }
    return wrap;
}

const menuItem = (text: string, onClick: () => void): HTMLElement =>
    h("button", { class: "pac-menu__item", type: "button", click: onClick }, text);

/** a drill replaces the menu's panel with one section, in place */
function drill(panel: HTMLElement, title: string, ...rows: HTMLElement[]): void {
    panel.replaceChildren(h("div", { class: "pac-menu__head" }, title), ...rows);
}

async function themeDrill(panel: HTMLElement): Promise<void> {
    const { themes, current } = (await (await fetch("/__themes")).json()) as { themes: string[]; current: string };
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
function exportDrill(panel: HTMLElement, close: () => void): void {
    const target = `${doc.file.replace(/\.[^.]+$/, "")}.pdf`;
    const write = (images: string) => async () => {
        close();
        hint(`Writing ${target}…`);
        try {
            const response = await fetch(`/__pdf?images=${images}`, { method: "POST" });
            if (response.ok) hint(`Wrote ${target}`, false, 2500);
            else hint((await response.text()) || `export failed: ${response.status}`, true, 6000);
        } catch {
            hint("Export failed: server unreachable", true, 6000);
        }
    };
    drill(panel, "Export",
        menuItem(`PDF, as ${target}`, write("screen")),
        menuItem("PDF, compact", write("compact")),
        menuItem("PDF, full-resolution images", write("full")),
    );
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

    const self: Chrome = {
        kind: "block",
        holds: true,
        close() {
            area.remove();
            target.classList.remove("pac-studio--hidden", "pac-studio--dim");
        },
    };
    show(self);

    size(area);
    area.focus();
    const at = options.caret === "end" ? area.value.length : 0;
    area.setSelectionRange(at, at);
    area.addEventListener("input", () => size(area));

    let done = false;

    const commit = async (flowTo?: number, caret: Caret = "end") => {
        if (done) return;
        done = true;
        const change = options.commit(area.value);
        if (!change) {
            shut();
            if (flowTo !== undefined) openAt(flowTo, caret);
            return;
        }
        // the editor stays, frozen, until the rebuilt page arrives: closing it now would
        // flash the old rendered value for the length of the commit round trip
        area.readOnly = true;
        self.holds = false;     // this write causes the next reload; a stale hash 409s and reloads anyway
        // the write reloads the page, so the flow target survives in sessionStorage
        if (flowTo !== undefined) sessionStorage.setItem(REOPEN, `${flowTo}|${caret}`);
        await splice(change);
    };

    area.addEventListener("blur", () => commit());
    area.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            done = true;
            shut();
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
let discardArmed: ReturnType<typeof setTimeout> | undefined;

async function openRaw(): Promise<void> {
    if (chrome?.kind === "block" || chrome?.kind === "raw" || document.body.hasAttribute("data-present")) return;
    // refetched rather than trusted: a held reload means the module's copy can be stale
    doc = await (await fetch("/__doc")).json();

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

    const save = barButton("Save", `${MOD}⏎`, () => commitRaw());
    save.setAttribute("data-primary", "");
    const container = h("div", { class: "pac-studio__raw" },
        h("div", { class: "pac-studio__rawbar" },
            h("span", { class: "pac-studio__rawname" }, doc.file),
            h("span", { class: "pac-studio__rawgap" }),
            barButton("Cancel", "esc", () => cancelRaw()),
            save),
        view.dom);

    document.body.append(container);
    document.body.setAttribute("data-pac-raw", "");
    show({
        kind: "raw",
        holds: true,
        close() {
            view.destroy();
            container.remove();
            document.body.removeAttribute("data-pac-raw");
            document.querySelector(".pac-studio__hint")?.remove();
        },
    });
    view.focus();

    async function commitRaw(): Promise<void> {
        if (container.hasAttribute("data-committing")) return;
        const text = view.state.doc.toString();
        if (text === doc.source) return shut();
        // frozen, not closed, until the rebuilt page arrives; same reasoning as the block editor
        container.setAttribute("data-committing", "");
        view.contentDOM.setAttribute("contenteditable", "false");
        if (chrome?.kind === "raw") chrome.holds = false;
        await splice({ start: 0, end: doc.source.length, text });
    }

    function cancelRaw(): void {
        if (container.hasAttribute("data-committing")) return;
        if (view.state.doc.toString() !== doc.source && !discardArmed) {
            hint("unsaved changes; esc again to discard");
            discardArmed = setTimeout(() => (discardArmed = undefined), 1600);
            return;
        }
        clearTimeout(discardArmed);
        discardArmed = undefined;
        shut();
    }
}

const barButton = (text: string, key: string, onClick: () => void): HTMLElement =>
    h("button", { class: "pac-studio__rawbutton", type: "button", title: key, click: onClick }, text);

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

/** a hint stays until replaced; one given a lifetime fades out on its own after that many ms */
function hint(text: string, alarm = false, lifetime?: number): void {
    document.querySelector(".pac-studio__hint")?.remove();
    const bar = h("div", { class: `pac-studio__hint${alarm ? " pac-studio__hint--alarm" : ""}` }, text);
    document.body.append(bar);
    if (lifetime === undefined) return;
    setTimeout(() => {
        if (!bar.isConnected) return;
        bar.setAttribute("data-fading", "");
        bar.addEventListener("transitionend", () => bar.remove(), { once: true });
    }, lifetime);
}
