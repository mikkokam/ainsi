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
 * Right-click opens the block toolbar: what the block is, what it can become, how it shows,
 * delete. Each press is one splice computed in edits.ts and committed at once.
 *
 * Raw mode is the same mechanism at full size: the whole file in CodeMirror, replacing the
 * rendered deck in place, committed as a whole-file splice through the same hash guard.
 */

import { EditorView, minimalSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { ALERT_KINDS, alertOf, markerOf, remove, render as structural, retag, withAlert, type Target, type TextKind } from "./edits";
import { icons, type IconName } from "./icons";
import { ALERT_ICONS } from "../components/alert/icons";

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
interface DocComponent { name: string; fields: Field[] }
interface Doc { hash: string; source: string; file: string; entities: DocEntity[]; blocks: DocBlock[]; components: DocComponent[] }

type Caret = "start" | "end";
type Mode = "inplace" | "overlay" | "insert" | "deck";

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
        const target = handleAt(event.target as HTMLElement);
        if (!target) {
            if (chrome?.kind === "menu") shut();
            else if (onMark(event)) { event.preventDefault(); openDeck(); }
            return;
        }
        const range = rangeOf(target);
        if (!range) return;
        event.preventDefault();
        if (event.altKey) insertAfter(target, range.end);
        else edit(target, range, "end");
    });

    // the same toolbar from a visible door: a grip at the block's top-left corner while the
    // pointer is over it, so right-click is a shortcut rather than the only way in
    const grip = h("button", { class: "pac-studio__grip", type: "button", title: "Block menu", "aria-label": "Block menu" });
    grip.innerHTML = icons.grip;
    grip.hidden = true;
    let gripped: HTMLElement | undefined;
    let leaving: ReturnType<typeof setTimeout> | undefined;
    grip.addEventListener("click", event => { event.stopPropagation(); if (gripped) openMenu(gripped, gripped.getBoundingClientRect()); });
    // the pointer crosses a sliver of page on its way from the block to the grip; hiding
    // waits long enough for that crossing, and arriving on the grip cancels it
    grip.addEventListener("mouseenter", () => clearTimeout(leaving));
    document.body.append(grip);
    document.addEventListener("mouseover", event => {
        if (chrome?.kind === "block" || chrome?.kind === "raw" || document.body.hasAttribute("data-present")) return grip.hidden = true;
        const at = event.target as HTMLElement;
        if (at === grip || grip.contains(at)) return;
        const target = handleAt(at);
        clearTimeout(leaving);
        if (!target) { leaving = setTimeout(() => { grip.hidden = true; gripped = undefined; }, 400); return; }
        gripped = target;
        const rect = target.getBoundingClientRect();
        grip.style.left = `${Math.max(4, rect.left - 26)}px`;
        grip.style.top = `${rect.top}px`;
        grip.hidden = false;
    });
    addEventListener("scroll", () => (grip.hidden = true), { passive: true });

    document.addEventListener("contextmenu", event => {
        if (chrome?.kind === "block" || chrome?.kind === "raw" || document.body.hasAttribute("data-present")) return;
        const target = handleAt(event.target as HTMLElement);
        if (!target) return;
        event.preventDefault();
        openMenu(target, target.getBoundingClientRect());
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
            menuItem("Deck…", () => { close(); openDeck(); }),
            menuItem("Theme…", () => themeDrill(panel)),
            menuItem("Export…", () => exportDrill(panel, close)),
        );
    });

    document.addEventListener("pac:keys", event => {
        const { mode, rows, mod, alt } = (event as CustomEvent).detail as { mode: string; rows: [string, string][]; mod: string; alt: string };
        if (mode === "Editing" && chrome?.kind === "raw") rows.push([`${mod} ⏎`, "save"], [`${mod} F`, "find"], ["esc", "cancel"]);
        else if (mode === "Editing") rows.push([`${mod} ⏎`, "commit"], ["esc", "cancel"], ["↑ ↓ at the edge", "previous / next block"], [`${mod} B`, "bold"], [`${mod} I`, "italic"], ["select", "marks bar"], ["empty", "deletes the block"]);
        if (mode === "Studio") rows.unshift(["click", "edit"], [`${alt} click`, "add a block below"], ["E", "edit the whole file"]);
    });

    // the escape hatch for a block editor that lost focus: its own Escape handler lives on
    // the textarea, so a stranded editor (a commit that never came back, focus elsewhere)
    // would otherwise be closable by nothing but a manual reload
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape" || chrome?.kind !== "block") return;
        if ((event.target as HTMLElement).closest?.("textarea")) return;
        shut();
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

/** the handle at an element, or the one handle inside the component root it sits in */
function handleAt(at: HTMLElement): HTMLElement | null {
    const own = at.closest<HTMLElement>("[data-pac-entity], [data-pac-span]");
    if (own) return own;
    const root = at.closest<HTMLElement>("[data-pac]");
    const inside = root ? root.querySelectorAll<HTMLElement>("[data-pac-entity], [data-pac-span]") : [];
    return inside.length === 1 ? inside[0]! : null;
}

/*
 * The block toolbar, above the block it governs. Three groups, left to right: what the
 * block is (its family, with a level dropdown for text), what it can become (the other
 * families), and how it shows (the components that accept it, then that component's
 * options). Delete at the end. A family change rewrites the entity's slice; a show-as
 * change is a directive before it, which governs that entity alone; the heuristic's own
 * pick removes the directive instead. Each press is one splice and the rebuild closes the bar.
 */
let menu: HTMLElement | undefined;

type Family = "text" | "list" | "quote" | "code";
const FAMILY: Record<Family, string> = { text: "Text", list: "Bullets", quote: "Quote", code: "Code" };
/** the convert buttons: a family each, lists twice because the marker is the whole difference */
const CONVERT: [TextKind, string, IconName][] = [["paragraph", "Text", "text"], ["list", "Bullets", "list"], ["ordered", "Numbered", "ordered"], ["quote", "Quote", "quote"], ["code", "Code", "code"]];
const TEXT_LEVELS: [TextKind, string, string][] = [["paragraph", "Text", "¶"], ["heading1", "Heading 1", "#"], ["heading2", "Heading 2", "##"], ["heading3", "Heading 3", "###"], ["heading4", "Heading 4", "####"], ["heading5", "Heading 5", "#####"]];
/** components that are a family in disguise; the convert buttons already cover them. Plain
 * rendering is a look for a list, a table or an image, and only a family for text. */
const NOT_A_LOOK = ["quote", "lead"];
const notALook = (family: Family | undefined) => (family && family !== "list" ? [...NOT_A_LOOK, "prose"] : NOT_A_LOOK);
/** what the heuristic's plain rendering is called, by what it renders */
const PLAIN: Record<string, string> = { list: "bullets", ordered: "numbered", quote: "quote", code: "code" };

function openMenu(handle: HTMLElement, at: DOMRect): void {
    const id = handle.dataset.pacEntity ?? handle.dataset.pacSpan?.split(" ")[0];
    const entity = doc.entities.find(e => e.id === id);
    const block = doc.blocks.find(b => entity && b.ids.includes(entity.id));
    if (!entity || !block) return;
    const target = targetFor(entity, block);

    menu = document.createElement("div");
    menu.className = "pac-studio__bar";
    menu.addEventListener("click", event => event.stopPropagation());

    // what it is: a level dropdown for text and lists, a label for everything else. A span
    // over one entity is that entity, whichever handle the component left on it.
    const own = handle.dataset.pacEntity !== undefined || block.ids.length === 1;
    const current = kindOf(entity);
    const family = current && familyOf(current);
    const convert = (to: TextKind) => splice({ start: entity.start, end: entity.end, text: retag(entity.md, entity.kind, to, neighbours(entity)) });
    if (own && family === "text") menu.append(dropdown(TEXT_LEVELS.find(l => l[0] === current)![1], TEXT_LEVELS.map(([kind, label, hint]) => item(label, hint, kind === current, () => convert(kind)))));
    else if (own && family === "list") menu.append(label(current === "ordered" ? "Numbered" : "Bullets"));
    else menu.append(label(own && family ? FAMILY[family] : entity.kind));

    // what it can become
    if (own && family) {
        menu.append(divider());
        for (const [kind, title, icon] of CONVERT) {
            const active = familyOf(kind) === family && (family !== "list" || kind === current);
            menu.append(iconButton(icon, title, active, () => { if (!active) convert(kind); }));
        }
    }

    // how it shows: the looks that accept the target, the heuristic's own marked auto. A text
    // block has looks only when a component beyond plain rendering takes it.
    const accepted = block.origin === "directive" ? block.accepted : entity.accepted;
    const looks = accepted.filter(name => !notALook(family).includes(name) && name !== "alert" && doc.components.some(c => c.name === name));
    // an alert is a marker on the quote rather than a directive, so it is offered to text and
    // quotes as a look and its kind as the option beneath it
    const alerting = own && (family === "quote" || family === "text");
    const isAlert = block.component === "alert";
    const setAlert = (to: string | null) => splice({ start: entity.start, end: entity.end, text: withAlert(entity.md, entity.kind, to) });
    const showLooks = looks.length > 0 || alerting || (!!block.directive && !notALook(family).includes(block.component));
    if (showLooks) {
        menu.append(divider());
        const showing = block.component === block.heuristic && !block.directive ? "auto" : block.component;
        const plain = (name: string) => (name === "prose" ? PLAIN[current ?? entity.kind] ?? "text" : name);
        const auto = `auto · ${plain(block.heuristic)}`;
        menu.append(isAlert
            ? dropdown("alert", [item("quote", "", false, () => setAlert(null)), item("alert", "", true, closeMenu)])
            : dropdown(showing === "auto" ? auto : plain(block.component), [
                item(auto, "", showing === "auto", () => (block.directive ? splice(structural(target, null)) : closeMenu())),
                ...looks.filter(name => name !== block.heuristic).map(name => item(plain(name), "", name === showing, () => splice(structural(target, name)))),
                ...(alerting ? [item("alert", "", false, () => setAlert("note"))] : []),
            ]));
    }
    if (isAlert) {
        const kind = alertOf(entity.md);
        const row = h("span", { class: "pac-studio__field" });
        for (const k of ALERT_KINDS) {
            const chip = h("button", { class: "pac-studio__chip pac-studio__chip--icon", type: "button", title: k, "aria-label": k, "data-active": k === kind, click: () => setAlert(k) });
            chip.innerHTML = ALERT_ICONS[k]!;
            row.append(chip);
        }
        menu.append(row);
    }
    const component = doc.components.find(c => c.name === block.component);
    if (component?.fields.length && !showLooks) menu.append(divider());
    for (const field of component?.fields ?? []) {
        menu.append(control(field, block.props[field.name], value => {
            const props = explicit(component!, { ...block.props, [field.name]: value });
            splice(structural(target, block.component === block.heuristic && !Object.keys(props).length ? null : block.component, props));
        }));
    }

    menu.append(divider(), iconButton("trash", "Delete", false, () => splice(remove(doc.source, target))));
    document.body.append(menu);
    place(menu, at);
    addEventListener("keydown", menuKey);
    const bar = menu;
    show({ kind: "menu", holds: false, close() { bar.remove(); if (menu === bar) menu = undefined; removeEventListener("keydown", menuKey); } });
}

/** above the block's top-left corner, or below it when there is no room above */
function place(bar: HTMLElement, at: DOMRect): void {
    const { width, height } = bar.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.left, innerWidth - width - 8));
    const top = at.top - height - 8 >= 8 ? at.top - height - 8 : Math.min(at.bottom + 8, innerHeight - height - 8);
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
}

function menuKey(event: KeyboardEvent): void {
    if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
}

function closeMenu(): void {
    if (chrome?.kind === "menu") shut();
}

function kindOf(entity: DocEntity): TextKind | undefined {
    switch (entity.kind) {
        case "heading": {
            const depth = Math.min(5, /^#+/.exec(entity.md)?.[0].length ?? 1);
            return `heading${depth}` as TextKind;
        }
        case "paragraph": return "paragraph";
        case "list": return /^\s*\d/.test(entity.md) ? "ordered" : "list";
        case "quote": return "quote";
        case "code": return "code";
        default: return undefined;
    }
}

function familyOf(kind: TextKind): Family {
    if (kind === "list" || kind === "ordered") return "list";
    if (kind === "quote" || kind === "code") return kind;
    return "text";
}

/** the list markers on either side, so a new list does not merge into a neighbour */
function neighbours(entity: DocEntity): (string | undefined)[] {
    const i = doc.entities.indexOf(entity);
    return [doc.entities[i - 1], doc.entities[i + 1]].map(e => (e?.kind === "list" ? markerOf(e.md) : undefined));
}

/** a governed block is addressed as a whole; a heuristic one at the entity clicked */
function targetFor(entity: DocEntity, block: DocBlock): Target {
    const governed = block.origin === "directive";
    const first = governed ? doc.entities.find(e => e.id === block.ids[0])! : entity;
    const last = governed ? doc.entities.find(e => e.id === block.ids.at(-1))! : entity;
    return {
        start: first.start,
        end: last.end,
        md: doc.source.slice(first.start, last.end),
        kind: first.kind,
        ...(block.directive ? { directive: block.directive } : {}),
        ...(block.terminator ? { terminator: block.terminator } : {}),
    };
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

function label(text: string): HTMLElement {
    const element = document.createElement("span");
    element.className = "pac-studio__barlabel";
    element.textContent = text;
    return element;
}

function divider(): HTMLElement {
    const element = document.createElement("span");
    element.className = "pac-studio__bardivider";
    return element;
}

function iconButton(icon: IconName, title: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.className = "pac-studio__barbutton";
    element.type = "button";
    element.title = title;
    element.setAttribute("aria-label", title);
    element.innerHTML = icons[icon];
    if (active) element.setAttribute("data-active", "");
    element.addEventListener("click", onClick);
    return element;
}

/** a button that opens its list beneath it; one open at a time */
function dropdown(text: string, items: HTMLElement[]): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "pac-studio__drop";
    const button = document.createElement("button");
    button.className = "pac-studio__barbutton pac-studio__barbutton--drop";
    button.type = "button";
    button.innerHTML = `<span>${text}</span>${icons.chevron}`;
    const list = document.createElement("div");
    list.className = "pac-studio__droplist";
    list.hidden = true;
    list.append(...items);
    button.addEventListener("click", () => {
        const opening = list.hidden;
        for (const other of menu!.querySelectorAll<HTMLElement>(".pac-studio__droplist")) other.hidden = true;
        list.hidden = !opening;
    });
    wrap.append(button, list);
    return wrap;
}

function item(text: string, hint: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.className = "pac-studio__dropitem";
    element.type = "button";
    element.innerHTML = `<span>${text}</span><span class="pac-studio__drophint">${hint}</span>`;
    if (active) element.setAttribute("data-active", "");
    element.addEventListener("click", onClick);
    return element;
}

function chip(text: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.className = "pac-studio__chip";
    element.type = "button";
    element.textContent = text;
    if (active) element.setAttribute("data-active", "");
    element.addEventListener("click", onClick);
    return element;
}

/** one option of the showing component: a chip per choice, a toggle, or a field */
function control(field: Field, value: unknown, onChange: (value: unknown) => void): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "pac-studio__field";
    const name = document.createElement("span");
    name.className = "pac-studio__fieldname";
    name.textContent = field.name;
    wrap.append(name);
    if (field.type === "enum") {
        wrap.append(...(field.options ?? []).map(option => chip(option, option === value, () => onChange(option))));
    } else if (field.type === "boolean") {
        wrap.append(chip(value ? "on" : "off", value === true, () => onChange(!value)));
    } else {
        const input = document.createElement("input");
        input.className = "pac-studio__input";
        input.type = field.type === "number" ? "number" : "text";
        input.value = value === undefined ? "" : String(value);
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") onChange(field.type === "number" ? Number(input.value) : input.value);
            if (event.key === "Escape") closeMenu();
            event.stopPropagation();
        });
        wrap.append(input);
    }
    return wrap;
}

function menuItem(text: string, onClick: () => void): HTMLElement {
    return h("button", { class: "pac-menu__item", type: "button", click: onClick }, text);
}

/** a drill replaces the menu's panel with one section, in place */
function drill(panel: HTMLElement, title: string, ...rows: HTMLElement[]): void {
    panel.replaceChildren(h("div", { class: "pac-menu__head" }, title), ...rows);
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
 * fits, prints and opens the file, so the studio only reports how it went. Three image
 * levels: screen density, compact for attachments, full for print.
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
    } else if (options.mode === "deck") {
        // above the first page and outside it: the deck's own settings, not page one's
        target.insertAdjacentElement("beforebegin", area);
        scrollTo({ top: 0 });
    } else {
        target.insertAdjacentElement("afterend", area);
    }

    // the marks bar: the same wraps as the chords, shown above the textarea while a selection
    // is live, so the syntax is a click away and still visible in the text it lands in
    const marks = h("div", { class: "pac-studio__marks" },
        ...([["**", "B", `Bold (${MOD}B)`], ["*", "I", `Italic (${MOD}I)`], ["`", "</>", "Inline code"], ["==", "==", "Highlight"]] as const).map(([marker, text, title]) =>
            h("button", { class: "pac-studio__mark", type: "button", title, mousedown: (e: Event) => e.preventDefault(), click: () => mark(area, marker) }, text)));
    marks.hidden = true;
    document.body.append(marks);
    const selected = () => {
        marks.hidden = area.selectionStart === area.selectionEnd || document.activeElement !== area;
        if (marks.hidden) return;
        const rect = area.getBoundingClientRect();
        marks.style.left = `${Math.max(8, rect.left)}px`;
        marks.style.top = `${Math.max(8, rect.top - marks.offsetHeight - 6)}px`;
    };
    document.addEventListener("selectionchange", selected);

    let done = false;
    const editor: Chrome = {
        kind: "block",
        holds: true,
        close() {
            done = true;                                // removal blurs the textarea; that blur is not a commit
            document.removeEventListener("selectionchange", selected);
            marks.remove();
            area.remove();
            target.classList.remove("pac-studio--hidden", "pac-studio--dim");
        },
    };
    show(editor);

    size(area);
    area.focus();
    const at = options.caret === "end" ? area.value.length : 0;
    area.setSelectionRange(at, at);
    area.addEventListener("input", () => size(area));

    const commit = async (flowTo?: number, caret: Caret = "end") => {
        if (done) return;
        done = true;
        const change = options.commit(area.value);
        if (!change) {
            if (chrome === editor) shut();
            if (flowTo !== undefined) openAt(flowTo, caret);
            return;
        }
        // the editor stays, frozen, until the rebuilt page arrives: closing it now would
        // flash the old rendered value for the length of the commit round trip
        area.readOnly = true;
        hint("saving…");
        editor.holds = false;   // this write causes the next reload; a stale hash 409s and reloads anyway
        // the write reloads the page, so the flow target survives in sessionStorage
        if (flowTo !== undefined) sessionStorage.setItem(REOPEN, `${flowTo}|${caret}`);
        await splice(change);
    };

    area.addEventListener("blur", () => commit());
    area.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            if (chrome === editor) shut();
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
        hint("saving…");
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
            signal: AbortSignal.timeout(8000),      // a hung write lands in the failure path, not a frozen editor
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
        return;
    }
    // on success the server rebuilds and the reload arrives over the SSE channel; if it
    // never does (the rebuild threw, the channel dropped), the page frees itself rather
    // than leave a frozen editor. Generous, so a slow fit pass is not cut short.
    setTimeout(() => location.reload(), 5000);
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
