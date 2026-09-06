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
import { markerOf, remove, render as structural, retag, type Target, type TextKind } from "./edits";
import { icons, type IconName } from "./icons";

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
 * The block toolbar, above the block it governs. Three groups, left to right: what the
 * block is (its family, with a level dropdown for text and a bullets/numbered one for a
 * list), what it can become (the other families), and how it shows (the components that
 * accept it, then that component's options). Delete at the end. A family change rewrites
 * the entity's slice; a show-as change is a directive before it, bounded by an end marker
 * when the heuristic's run would carry on past it; the heuristic's own pick removes the
 * directive instead. Each press is one splice and the rebuild closes the bar.
 */
let menu: HTMLElement | undefined;

type Family = "text" | "list" | "quote" | "code";
const FAMILY: Record<Family, { label: string; kind: TextKind; icon: IconName }> = {
    text: { label: "Text", kind: "paragraph", icon: "text" },
    list: { label: "Bullets", kind: "list", icon: "list" },
    quote: { label: "Quote", kind: "quote", icon: "quote" },
    code: { label: "Code", kind: "code", icon: "code" },
};
const TEXT_LEVELS: [TextKind, string, string][] = [["paragraph", "Text", "¶"], ["heading1", "Heading 1", "#"], ["heading2", "Heading 2", "##"], ["heading3", "Heading 3", "###"]];
const LIST_LEVELS: [TextKind, string, string][] = [["list", "Bullets", "-"], ["ordered", "Numbered", "1."]];

function openMenu(handle: HTMLElement, at: DOMRect): void {
    closeMenu();
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
    else if (own && family === "list") menu.append(dropdown(LIST_LEVELS.find(l => l[0] === current)![1], LIST_LEVELS.map(([kind, label, hint]) => item(label, hint, kind === current, () => convert(kind)))));
    else menu.append(label(own && family ? FAMILY[family].label : entity.kind));

    // what it can become
    if (own && family) {
        menu.append(divider());
        for (const [name, def] of Object.entries(FAMILY) as [Family, typeof FAMILY[Family]][]) {
            menu.append(iconButton(def.icon, def.label, name === family, () => { if (name !== family) convert(def.kind); }));
        }
    }

    // how it shows: the components that accept the target, the heuristic's own marked auto
    const accepted = block.origin === "directive" ? block.accepted : entity.accepted;
    const choices = accepted.filter(name => doc.components.some(c => c.name === name));
    if (choices.length > 1) {
        menu.append(divider());
        const showing = block.component === block.heuristic && !block.directive ? "auto" : block.component;
        menu.append(dropdown(showing === "auto" ? `auto · ${block.heuristic}` : block.component, [
            item(`auto · ${block.heuristic}`, "", showing === "auto", () => (block.directive ? splice(structural(target, null)) : closeMenu())),
            ...choices.filter(name => name !== block.heuristic).map(name => item(name, "", name === showing, () => splice(structural(target, name)))),
        ]));
    }
    const component = doc.components.find(c => c.name === block.component);
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
    menu?.remove();
    menu = undefined;
    removeEventListener("keydown", menuKey);
}

function kindOf(entity: DocEntity): TextKind | undefined {
    switch (entity.kind) {
        case "heading": {
            const depth = /^#+/.exec(entity.md)?.[0].length ?? 1;
            return depth === 1 ? "heading1" : depth === 2 ? "heading2" : "heading3";
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
        runsOn: !governed && block.ids.indexOf(entity.id) < block.ids.length - 1,
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
