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
import { ALERT_KINDS, addPage, alertOf, directiveLine, markerOf, move, movePage, moveTo, pageSpan, relayout, remove, removePage, render as structural, retag, withAlert, type Target, type TextKind } from "./edits";
import { icons, type IconName } from "./icons";
import { ALERT_ICONS } from "../components/alert/icons";
import { barButton, clash, control, divider, drill, dropdown, GAP, h, hint, iconButton, item, label, mark, menuItem, place, size, type Field } from "./widgets";

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
interface DocComponent { name: string; about: string; fields: Field[]; takes: string[] }
interface DocPage {
    ids: string[];
    layout: string;
    props: Record<string, unknown>;
    first: number;
    last: number;
    held: boolean;
    directive?: { start: number; end: number };
}
interface DocLayout { name: string; fields: Field[] }
interface Doc {
    hash: string; source: string; file: string;
    layout: string;
    entities: DocEntity[]; blocks: DocBlock[]; pages: DocPage[];
    components: DocComponent[]; layouts: DocLayout[];
}

/** select: the text past a heading marker, so typing replaces a placeholder title */
type Caret = "start" | "end" | "select";
type Mode = "inplace" | "overlay" | "insert" | "deck";

let doc: Doc = { hash: "", source: "", file: "", layout: "default", entities: [], blocks: [], pages: [], components: [], layouts: [] };

/*
 * One piece of chrome at a time: a block editor, raw mode, or the block menu. Opening one
 * closes what was open; every exit routes through shut(). `holds` is whether a reload must
 * wait for this chrome — editors hold, the menu does not — and a commit clears it, because
 * that write is what causes the next reload.
 */
interface Chrome { kind: "block" | "raw" | "menu"; holds: boolean; close(): void }
let chrome: Chrome | undefined;

/*
 * The state between hovering something and typing in it. A click selects, a second click or
 * Enter puts the caret in, Escape steps back out. Everything a menu can act on hangs off this:
 * with a selection the commands are the studio's, and with a caret they are the text field's.
 *
 * The handle is the element, not an id, because a rebuild replaces the document and a
 * selection does not survive one. What survives a rebuild is the file, which is the point.
 */
interface Selection { kind: "block" | "page"; handle: HTMLElement }
let selected: Selection | undefined;

function select(handle: HTMLElement | undefined, kind: Selection["kind"] = "block"): void {
    if (selected?.handle === handle) return;
    selected?.handle.removeAttribute("data-ainsi-selected");
    selected = handle ? { kind, handle } : undefined;
    handle?.setAttribute("data-ainsi-selected", "");
}
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

/*
 * A commit is the studio's slowest visible thing: "saving…" stays up from the blur until the
 * rebuilt page has loaded, across a reload that wipes any in-page timer. The legs are kept in
 * sessionStorage and read back on the next load, and a round trip over SLOW reports itself, so
 * an occasional stall leaves a record without devtools having been open at the time.
 */
const TRACE = "ainsi:trace";
const SLOW = 600;

function traceMark(leg: "sent" | "answered" | "told"): void {
    try {
        const at = Date.now();
        const kept = sessionStorage.getItem(TRACE);
        const record = leg === "sent" ? { sent: at } : { ...(kept ? JSON.parse(kept) : {}), [leg]: at };
        sessionStorage.setItem(TRACE, JSON.stringify(record));
    } catch { /* private mode, or a full quota: a trace is never worth breaking an edit for */ }
}

function traceReport(): void {
    try {
        const kept = sessionStorage.getItem(TRACE);
        if (!kept) return;
        sessionStorage.removeItem(TRACE);
        const { sent, answered, told } = JSON.parse(kept) as { sent: number; answered?: number; told?: number };
        const total = Date.now() - sent;
        if (total < SLOW && !localStorage.getItem(TRACE)) return;
        console.log(`ainsi commit ${total} ms: write ${(answered ?? sent) - sent}, `
            + `rebuild ${(told ?? answered ?? sent) - (answered ?? sent)}, reload ${Date.now() - (told ?? sent)}`);
    } catch { /* as above */ }
}

traceReport();

(window as unknown as { __ainsiReload(): void }).__ainsiReload = () => {
    traceMark("told");
    if (chrome?.holds) {
        pendingReload = true;
        hint("the file changed elsewhere; reloads when this editor closes");
        return;
    }
    location.reload();
};

/*
 * A rail wants the top-left corner of whatever it points at, which on a page that fills the
 * window is the corner the viewer's toolbar is fixed in. One that would land inside fixed
 * chrome drops below it. Called after the rail is shown, so its height is its real one and the
 * correction lands in the same paint as the placement.
 */
function belowChrome(rail: HTMLElement): void {
    const hit = clash(rail.getBoundingClientRect());
    if (hit) rail.style.top = `${hit.bottom + GAP}px`;
}

/*
 * The file name in the toolbar, editable: blur or Enter renames the deck on disk, the same
 * write-through the content gets, applied to the path. The server retargets its watcher and
 * the reload that follows brings the new name back through /__doc.
 */
function mountFileField(): void {
    const field = h("input", {
        class: "ainsi-studio__file", type: "text", value: doc.file, spellcheck: "false", "aria-label": "File name",
        title: "Rename the deck",
    }) as HTMLInputElement;
    let renaming = false;
    async function commit(): Promise<void> {
        const name = field.value.trim();
        if (renaming || !name || name === doc.file) { field.value = doc.file; return; }
        renaming = true;
        const response = await fetch("/__rename", { method: "POST", body: JSON.stringify({ name }) });
        renaming = false;
        if (!response.ok) {
            hint(await response.text(), true, 3000);
            field.value = doc.file;
            return;
        }
        doc.file = (await response.json() as { file: string }).file;
        field.value = doc.file;
        hint(`renamed to ${doc.file}`, false, 2000);
    }
    field.addEventListener("blur", () => void commit());
    field.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); field.blur(); }
        if (event.key === "Escape") { event.preventDefault(); field.value = doc.file; field.blur(); }
        event.stopPropagation();
    });
    (document.querySelector(".ainsi-toolbar") ?? document.body).append(field);
}

const SCROLL = "ainsi-scroll";
const REOPEN = "ainsi-reopen";
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

init();

async function init(): Promise<void> {
    doc = await (await fetch("/__doc")).json();
    document.body.setAttribute("data-ainsi-edit", "");
    mountFileField();

    const scrolled = sessionStorage.getItem(SCROLL);
    if (scrolled) scrollTo(0, Number(scrolled));
    addEventListener("scroll", () => sessionStorage.setItem(SCROLL, String(scrollY)), { passive: true });

    document.addEventListener("click", event => {
        if (chrome?.kind === "block" || chrome?.kind === "raw" || document.body.hasAttribute("data-present")) return;
        const target = handleAt(event.target as HTMLElement);
        if (!target) {
            if (chrome?.kind === "menu") { select(undefined); shut(); return; }
            if (onMark(event)) { event.preventDefault(); select(undefined); openDeck(); return; }
            // the ground of a page that wants a picture is already an offer to add one, and the
            // badge on it says so; taking that space for the page would take the offer away
            if (onEmptyGround(event)) { event.preventDefault(); select(undefined); return; }
            /*
             * Anything else inside a page is the page. A click picks the innermost thing under
             * it, and the page is the outermost, so a full-bleed picture is picked before the
             * page it covers, which is the same rule and not an exception to it.
             */
            const section = (event.target as HTMLElement).closest?.<HTMLElement>(".ainsi-page");
            if (section) selectPage(section);
            else select(undefined);
            return;
        }
        const range = rangeOf(target);
        if (!range) return;
        event.preventDefault();
        if (event.altKey) return insertAfter(target, range.end);
        // the first click picks the block and shows what can be done to it; the second says do
        if (selected?.handle === target) edit(target, range, "end");
        else { select(target); openMenu(target, target.getBoundingClientRect()); }
    });

    /*
     * The clipboard, on what is selected. A block's markdown is what goes on it, so a slide
     * pastes into any editor and markdown from anywhere pastes into a deck, and nothing here
     * knows what a block means. With a caret in a field these keys belong to the field, which
     * is what the guard is.
     */
    document.addEventListener("keydown", event => {
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
        const key = event.key.toLowerCase();
        if (key !== "c" && key !== "x" && key !== "v") return;
        if (chrome?.kind === "block" || chrome?.kind === "raw") return;
        if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
        if (document.body.hasAttribute("data-present")) return;
        if (!selected) return;
        event.preventDefault();
        void clipboard(key === "c" ? "copy" : key === "x" ? "cut" : "paste");
    });

    /*
     * Enter opens what is selected and Escape lets it go. Both are ignored while anything is
     * typing, where the key belongs to the field, and while presenting, where nothing is.
     */
    document.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        if (!selected || chrome?.kind === "block" || chrome?.kind === "raw") return;
        if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
        if (document.body.hasAttribute("data-present")) return;
        event.preventDefault();
        /*
         * Escape steps out rather than straight to nothing: a block hands over to its page,
         * and the page lets go. It is the only way to reach a page a full-bleed picture covers.
         */
        if (event.key === "Escape") {
            const section = selected.kind === "block" ? selected.handle.closest<HTMLElement>(".ainsi-page") : undefined;
            if (chrome?.kind === "menu") shut();
            if (section) selectPage(section);
            else select(undefined);
            return;
        }
        if (selected.kind === "page") return;
        const range = rangeOf(selected.handle);
        if (range) edit(selected.handle, range, "end");
    });

    // the toolbar and insertion from a visible door: a rail at the block's top-left corner
    // while the pointer is over it, the grip for the menu and a plus for a block below, so
    // right-click and alt-click are shortcuts rather than the only way in
    const grip = h("button", { class: "ainsi-studio__grip", type: "button", title: "Block menu", "aria-label": "Block menu" });
    grip.innerHTML = icons.grip;
    const plus = h("button", { class: "ainsi-studio__grip", type: "button", title: "Add a block below (⌥ click)", "aria-label": "Add a block below" });
    plus.innerHTML = icons.plus;
    const rail = h("div", { class: "ainsi-studio__rail" }, grip, plus);
    rail.hidden = true;
    let gripped: HTMLElement | undefined;
    let leaving: ReturnType<typeof setTimeout> | undefined;
    grip.addEventListener("click", event => { event.stopPropagation(); if (gripped) openMenu(gripped, gripped.getBoundingClientRect()); });
    // the icon is six dots, which promises a drag; this is the promise
    grip.addEventListener("mousedown", event => { if (gripped) startDrag(event, gripped); });
    plus.addEventListener("click", event => {
        event.stopPropagation();
        const range = gripped && rangeOf(gripped);
        if (range) openInsertMenu(gripped!, range.end, plus.getBoundingClientRect());
    });
    // the pointer crosses a sliver of page on its way from the block to the rail; hiding
    // waits long enough for that crossing, and arriving on the rail cancels it
    rail.addEventListener("mouseenter", () => clearTimeout(leaving));
    document.body.append(rail);
    document.addEventListener("mouseover", event => {
        if (chrome?.kind === "block" || chrome?.kind === "raw" || document.body.hasAttribute("data-present")) return rail.hidden = true;
        const at = event.target as HTMLElement;
        if (at === rail || rail.contains(at)) return;
        const target = handleAt(at);
        clearTimeout(leaving);
        if (!target) { leaving = setTimeout(() => { rail.hidden = true; gripped = undefined; }, 400); return; }
        gripped = target;
        const rect = target.getBoundingClientRect();
        rail.style.left = `${Math.max(4, rect.left - 26)}px`;
        rail.style.top = `${rect.top}px`;
        rail.hidden = false;
        belowChrome(rail);
    });
    addEventListener("scroll", () => (rail.hidden = true), { passive: true });

    // the page's own rail, the block rail one scope up, at its top-left corner: the layout
    // and its options govern the whole page, so the control sits on the page rather than
    // on any block inside it, and the plus adds a page below
    const pageGrip = h("button", { class: "ainsi-studio__grip", type: "button", title: "Page layout (⌥ click adds a page below)", "aria-label": "Page layout" });
    pageGrip.innerHTML = icons.layout;
    const pagePlus = h("button", { class: "ainsi-studio__grip", type: "button", title: "Add a page below", "aria-label": "Add a page below" });
    pagePlus.innerHTML = icons.plus;
    const pageRail = h("div", { class: "ainsi-studio__rail" }, pageGrip, pagePlus);
    pageRail.hidden = true;
    document.body.append(pageRail);
    let pageAt: HTMLElement | undefined;
    let pageLeaving: ReturnType<typeof setTimeout> | undefined;
    pageGrip.addEventListener("click", event => {
        event.stopPropagation();
        if (!pageAt) return;
        if (event.altKey) return insertPage(pageAt);
        selectPage(pageAt);
    });
    pagePlus.addEventListener("click", event => { event.stopPropagation(); if (pageAt) insertPage(pageAt); });
    // the rail sits outside the page, so the pointer crosses the shell on its way over;
    // hiding waits for that crossing, and arriving on the rail cancels it
    pageRail.addEventListener("mouseenter", () => clearTimeout(pageLeaving));
    document.addEventListener("mouseover", event => {
        if (chrome?.kind === "block" || chrome?.kind === "raw" || document.body.hasAttribute("data-present")) return pageRail.hidden = true;
        const at = event.target as HTMLElement;
        if (at === pageRail || pageRail.contains(at)) return;
        const page = at.closest<HTMLElement>(".ainsi-page");
        clearTimeout(pageLeaving);
        if (!page) { pageLeaving = setTimeout(() => { pageRail.hidden = true; pageAt = undefined; }, 400); return; }
        pageAt = page;
        const rect = page.getBoundingClientRect();
        pageRail.style.left = `${Math.max(4, rect.left - 26)}px`;
        pageRail.style.top = `${Math.max(4, rect.top)}px`;
        pageRail.hidden = false;
        belowChrome(pageRail);
    });
    addEventListener("scroll", () => (pageRail.hidden = true), { passive: true });

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
    document.addEventListener("ainsi:menu", event => {
        const { panel, slot, close } = (event as CustomEvent).detail as { panel: HTMLElement; slot: HTMLElement; close(): void };
        slot.append(
            menuItem("Edit source (E)", () => openRaw()),
            menuItem("Open deck…", () => openDrill(panel)),
            menuItem("Deck settings…", () => { close(); openDeck(); }),
            menuItem("Theme…", () => themeDrill(panel)),
            menuItem("Export…", () => exportDrill(panel, close)),
            h("div", { class: "ainsi-menu__rule" }),
        );
    });

    /*
     * A desktop shell has a native menu bar and no way into this page but an event. What its
     * File menu runs is what this menu runs, so the two are one implementation and a shell
     * never learns an endpoint.
     */
    document.addEventListener("ainsi:command", event => {
        const name = (event as CustomEvent).detail as string;
        const base = doc.file.replace(/\.[^.]+$/, "");
        if (name === "new") void repoint("/__new", {});
        else if (name === "source") openRaw();
        else if (name === "settings") openDeck();
        else if (name === "pptx") void exportTo("/__pptx", `${base}.pptx`);
        else if (name === "zip") void exportTo("/__zip", `${base}.zip`);
        else if (name === "copy" || name === "cut" || name === "paste") void clipboard(name);
        else if (name === "insert") insertHere();
        else if (name.startsWith("insert:")) insertHere(name.slice("insert:".length));
        else if (name === "duplicate") duplicateSelection();
        else if (name === "delete") deleteSelection();
        else if (name.startsWith("pdf")) void exportTo(`/__pdf?images=${name.slice(4) || "screen"}`, `${base}.pdf`);
    });

    document.addEventListener("ainsi:keys", event => {
        const { mode, rows, mod, alt } = (event as CustomEvent).detail as { mode: string; rows: [string, string][]; mod: string; alt: string };
        if (mode === "Editing" && chrome?.kind === "raw") rows.push([`${mod} ⏎`, "save"], [`${mod} F`, "find"], ["esc", "cancel"]);
        else if (mode === "Editing") rows.push([`${mod} ⏎`, "commit"], ["esc", "cancel"], ["↑ ↓ at the edge", "previous / next block"], [`${mod} B`, "bold"], [`${mod} I`, "italic"], ["select", "marks bar"], ["empty", "deletes the block"]);
        if (mode === "Studio") rows.unshift(["click", "edit"], [`${alt} click`, "add a block below"], ["E", "edit the whole file"], [`${mod} Z`, "undo the last commit"], [`${mod} ⇧ Z`, "redo"]);
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

    // commit-level undo, only with nothing open: an open textarea or CodeMirror keeps its own
    document.addEventListener("keydown", event => {
        if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
        if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
        if (chrome || document.body.hasAttribute("data-present")) return;
        event.preventDefault();
        step(event.shiftKey ? "redo" : "undo");
    });
}

/*
 * Undo is the inverse splice of each commit, kept in sessionStorage because every commit
 * reloads the page. An entry whose replaced text is no longer at its offset (the file moved
 * under the studio) is dropped rather than applied; the server's hash guard is the backstop.
 */
interface Splice { start: number; end: number; text: string }
interface Entry extends Splice { was: string }   // what the range holds now; a mismatch means the file moved
const UNDO = "ainsi-undo";
const REDO = "ainsi-redo";
const DEPTH = 50;

function stack(key: string): Entry[] {
    try { return JSON.parse(sessionStorage.getItem(key) ?? "[]"); } catch { return []; }
}

function push(key: string, entry: Entry): void {
    sessionStorage.setItem(key, JSON.stringify([...stack(key), entry].slice(-DEPTH)));
}

function inverse(change: Splice, source: string): Entry {
    return { start: change.start, end: change.start + change.text.length, text: source.slice(change.start, change.end), was: change.text };
}

function step(direction: "undo" | "redo"): void {
    const from = direction === "undo" ? UNDO : REDO;
    const entries = stack(from);
    const change = entries.pop();
    if (!change) { hint(`nothing to ${direction}`); return; }
    sessionStorage.setItem(from, JSON.stringify(entries));
    if (doc.source.slice(change.start, change.end) !== change.was) { hint(`${direction} skipped: the file changed elsewhere`, true); return; }
    hint(`${direction}…`);
    splice(change, direction === "undo" ? REDO : UNDO);
}

/** the handle at an element, or the one handle inside the component root it sits in */
function handleAt(at: HTMLElement): HTMLElement | null {
    const own = at.closest<HTMLElement>("[data-ainsi-entity], [data-ainsi-span]");
    if (own) return own;
    const root = at.closest<HTMLElement>("[data-ainsi]");
    const inside = root ? root.querySelectorAll<HTMLElement>("[data-ainsi-entity], [data-ainsi-span]") : [];
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

type Family = "text" | "list" | "quote" | "alert" | "code";
const FAMILY: Record<Family, string> = { text: "Text", list: "Bullets", quote: "Quote", alert: "Alert", code: "Code" };
/** the convert buttons: a family each, lists twice because the marker is the whole difference */
const CONVERT: [TextKind, string, IconName][] = [["paragraph", "Text", "text"], ["list", "Bullets", "list"], ["ordered", "Numbered", "ordered"], ["quote", "Quote", "quote"], ["alert", "Alert", "alert"], ["code", "Code", "code"]];
const TEXT_LEVELS: [TextKind, string, string][] = [["paragraph", "Text", "¶"], ["heading1", "Heading 1", "#"], ["heading2", "Heading 2", "##"], ["heading3", "Heading 3", "###"], ["heading4", "Heading 4", "####"], ["heading5", "Heading 5", "#####"]];
/** components that are a family in disguise; the convert buttons already cover them. Plain
 * rendering is a look for a list, a table or an image, and only a family for text. */
const NOT_A_LOOK = ["alert"];
const notALook = (family: Family | undefined) => (family && family !== "list" ? [...NOT_A_LOOK, "prose"] : NOT_A_LOOK);
/** what the heuristic's plain rendering is called, by what it renders */
const PLAIN: Record<string, string> = { list: "bullets", ordered: "numbered", quote: "quote", code: "code", table: "table" };

function openMenu(handle: HTMLElement, at: DOMRect): void {
    const id = handle.dataset.ainsiEntity ?? handle.dataset.ainsiSpan?.split(" ")[0];
    const entity = doc.entities.find(e => e.id === id);
    const block = doc.blocks.find(b => entity && b.ids.includes(entity.id));
    if (!entity || !block) return;
    const target = targetFor(entity, block);

    menu = document.createElement("div");
    menu.className = "ainsi-studio__bar";
    menu.addEventListener("click", event => event.stopPropagation());

    // what it is: a level dropdown for text and lists, a label for everything else. A span
    // over one entity is that entity, whichever handle the component left on it.
    const own = handle.dataset.ainsiEntity !== undefined || block.ids.length === 1;
    const current = kindOf(entity);
    const family = current && familyOf(current);
    // an alert is what the engine picks for a marked quote; a directive on the entity would
    // only fight it, so converting into one takes the directive along
    const convert = (to: TextKind) => splice({
        start: to === "alert" && block.directive && block.ids.length === 1 ? block.directive.start : entity.start,
        end: entity.end,
        text: retag(entity.md, entity.kind, to, neighbours(entity)),
    });
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
    const looks = accepted.filter(name => !notALook(family).includes(name) && doc.components.some(c => c.name === name));
    const showLooks = looks.length > 0 || (!!block.directive && !notALook(family).includes(block.component));
    if (showLooks) {
        menu.append(divider());
        const showing = block.component === block.heuristic && !block.directive ? "auto" : block.component;
        const plain = (name: string) => (name === "prose" ? PLAIN[current ?? entity.kind] ?? "text" : name);
        const auto = `auto · ${plain(block.heuristic)}`;
        menu.append(dropdown(showing === "auto" ? auto : plain(block.component), [
            item(auto, "", showing === "auto", () => (block.directive ? splice(structural(target, null)) : closeMenu())),
            ...looks.filter(name => name !== block.heuristic).map(name => item(plain(name), doc.components.find(c => c.name === name)?.about ?? "", name === showing, () => splice(structural(target, name)))),
        ]));
    }
    // an alert's kind is its marker line; the chips rewrite that line
    if (own && family === "alert") {
        const kind = alertOf(entity.md);
        const row = h("span", { class: "ainsi-studio__field" });
        for (const k of ALERT_KINDS) {
            const chip = h("button", { class: "ainsi-studio__chip ainsi-studio__chip--icon", type: "button", title: k, "aria-label": k, "data-active": k === kind, click: () => splice({ start: entity.start, end: entity.end, text: withAlert(entity.md, entity.kind, k) }) });
            chip.innerHTML = ALERT_ICONS[k]!;
            row.append(chip);
        }
        menu.append(divider(), row);
    }
    const component = doc.components.find(c => c.name === block.component);
    if (component?.fields.length && !showLooks) menu.append(divider());
    for (const field of component?.fields ?? []) {
        menu.append(control(field, block.props[field.name], value => {
            const props = explicit(component!.fields, { ...block.props, [field.name]: value });
            splice(structural(target, block.component === block.heuristic && !Object.keys(props).length ? null : block.component, props));
        }, closeMenu));
    }

    // where it sits: a swap with the neighbour above or below, never across a page break.
    // Only the moves that exist are drawn, so the first block has no dead Move up.
    const [above, below] = beside(target, block);
    if (above || below) {
        menu.append(divider());
        if (above) menu.append(iconButton("up", "Move up", false, () => splice(move(doc.source, target, above))));
        if (below) menu.append(iconButton("down", "Move down", false, () => splice(move(doc.source, target, below))));
    }

    menu.append(divider(), iconButton("trash", "Delete", false, () => splice(remove(doc.source, target))));
    document.body.append(menu);
    place(menu, at);
    addEventListener("keydown", menuKey);
    const bar = menu;
    show({ kind: "menu", holds: false, close() { bar.remove(); if (menu === bar) menu = undefined; removeEventListener("keydown", menuKey); } });
}

function menuKey(event: KeyboardEvent): void {
    if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
}

function closeMenu(): void {
    if (chrome?.kind === "menu") shut();
}

/*
 * The page toolbar: the layout the page wears, then that layout's own options. A change is
 * one layout directive spliced before the page's first entity, or the removal of one when
 * the pick says what the deck already says and the directive is not what breaks the page.
 */
function openPageMenu(section: HTMLElement, at: DOMRect): void {
    const page = pageOf(section);
    if (!page) return;

    menu = document.createElement("div");
    menu.className = "ainsi-studio__bar";
    menu.addEventListener("click", event => event.stopPropagation());

    const change = (name: string, props: Record<string, unknown>) => {
        const written = explicit(doc.layouts.find(l => l.name === name)?.fields ?? [], props);
        const splicing = relayout(doc.source, page, doc.layout, name, written);
        if (splicing) splice(splicing);
        else closeMenu();
    };

    // the layout the deck names in frontmatter is the one a page falls back to; say so
    menu.append(label("Page"), divider(), dropdown(page.layout, doc.layouts.map(l =>
        item(l.name, l.name === doc.layout ? "deck" : "", l.name === page.layout, () => change(l.name, page.props)))));

    const fields = doc.layouts.find(l => l.name === page.layout)?.fields ?? [];
    if (fields.length) menu.append(divider());
    for (const field of fields) {
        menu.append(control(field, page.props[field.name], value => {
            // picking the value again clears an option that has no default of its own
            const cleared = value === page.props[field.name] && field.default === undefined;
            change(page.layout, { ...page.props, [field.name]: cleared ? undefined : value });
        }, closeMenu));
    }
    const index = doc.pages.indexOf(page);
    const before = doc.pages[index - 1];
    const after = doc.pages[index + 1];
    menu.append(divider(), iconButton("code", "Edit source", false, () => void openRaw(index)));
    if (before) menu.append(iconButton("up", "Move page up", false, () => splice(movePage(doc.source, page, before))));
    if (after) menu.append(iconButton("down", "Move page down", false, () => splice(movePage(doc.source, page, after))));

    menu.append(divider(), iconButton("trash", "Delete page", false, () => splice(removePage(doc.source, page))));

    document.body.append(menu);
    place(menu, at);
    addEventListener("keydown", menuKey);
    const bar = menu;
    show({ kind: "menu", holds: false, close() { bar.remove(); if (menu === bar) menu = undefined; removeEventListener("keydown", menuKey); } });
}

function kindOf(entity: DocEntity): TextKind | undefined {
    switch (entity.kind) {
        case "heading": {
            const depth = Math.min(5, /^#+/.exec(entity.md)?.[0].length ?? 1);
            return `heading${depth}` as TextKind;
        }
        case "paragraph": return "paragraph";
        case "list": return /^\s*\d/.test(entity.md) ? "ordered" : "list";
        case "quote": return alertOf(entity.md) ? "alert" : "quote";
        case "code": return "code";
        default: return undefined;
    }
}

function familyOf(kind: TextKind): Family {
    if (kind === "list" || kind === "ordered") return "list";
    if (kind === "quote" || kind === "alert" || kind === "code") return kind;
    return "text";
}

/** the list markers on either side, so a new list does not merge into a neighbour */
function neighbours(entity: DocEntity): (string | undefined)[] {
    const i = doc.entities.indexOf(entity);
    return [doc.entities[i - 1], doc.entities[i + 1]].map(e => (e?.kind === "list" ? markerOf(e.md) : undefined));
}

/** a governed block is addressed as a whole; a heuristic one at the entity clicked */
/*
 * Copy, cut and paste on the selection. A caret inside a field takes precedence and gets the
 * browser's own, because a native menu item with an accelerator has no other way to reach the
 * field it is over; with no caret and no selection there is nothing to act on and it says so.
 */
async function clipboard(verb: "copy" | "cut" | "paste"): Promise<void> {
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.closest?.("input, textarea, [contenteditable]")) {
        document.execCommand(verb);
        return;
    }
    if (!selected) return hint("Nothing selected", true, 2000);
    if (selected.kind === "page") return pageClipboard(verb, selected.handle);
    const range = rangeOf(selected.handle);
    if (!range) return;
    if (verb === "paste") return paste(range);
    return copy(range, verb === "cut" ? selected.handle : undefined);
}

/*
 * The same three verbs on a whole page. A page's markdown is its blocks and the directives
 * that govern them, which `pageSpan` already knows how to bound, so this is the block case
 * with a wider span and a break written in front of what it pastes.
 */
async function pageClipboard(verb: "copy" | "cut" | "paste", section: HTMLElement): Promise<void> {
    const page = pageOf(section);
    if (!page) return;

    if (verb === "paste") {
        let text: string;
        try {
            text = (await navigator.clipboard.readText()).trim();
        } catch {
            return hint("The browser would not give the clipboard", true, 4000);
        }
        if (!text) return hint("Nothing on the clipboard", true, 2500);
        return splice(addPage(page, text));
    }

    const span = pageSpan(doc.source, page);
    try {
        await navigator.clipboard.writeText(doc.source.slice(span.start, span.end).trim());
    } catch {
        return hint("The browser would not give the clipboard", true, 4000);
    }
    if (verb === "copy") return hint("Page copied", false, 1200);
    select(undefined);
    splice(removePage(doc.source, page));
    hint("Page cut", false, 1200);
}

/** what a selected block puts on the clipboard: its markdown, and nothing about the studio */
async function copy(range: Range, cutting?: HTMLElement): Promise<void> {
    try {
        await navigator.clipboard.writeText(range.md);
    } catch {
        return hint("The browser would not give the clipboard", true, 4000);
    }
    if (!cutting) return hint("Copied", false, 1200);
    const target = targetOf(cutting);
    if (!target) return;
    select(undefined);
    splice(remove(doc.source, target));
    hint("Cut", false, 1200);
}

/*
 * Paste lands after the selection and never over it. Replacing is a destructive default and
 * there is no way to ask, and undo is a commit rather than a keystroke, so the cheap mistake
 * has to be the recoverable one.
 */
async function paste(range: Range): Promise<void> {
    let text: string;
    try {
        text = (await navigator.clipboard.readText()).trim();
    } catch {
        return hint("The browser would not give the clipboard", true, 4000);
    }
    if (!text) return hint("Nothing on the clipboard", true, 2500);
    splice({ start: range.end, end: range.end, text: `\n\n${text}` });
}

/*
 * Insert goes after the selection, or at the end of the page in view when nothing is selected,
 * which is the only answer that does not need a question asked first.
 */
function insertHere(label?: string): void {
    if (label === "Page") {
        const section = selected?.handle.closest<HTMLElement>(".ainsi-page")
            ?? document.querySelector<HTMLElement>(`[data-ainsi-entity="${pageInView()}"]`)?.closest<HTMLElement>(".ainsi-page");
        if (section) insertPage(section);
        return;
    }
    const stub = INSERTS.find(i => i.label === label);
    if (selected?.kind === "page" && pageOf(selected.handle)) {
        if (!stub) { insertPage(selected.handle); return; }
        const page = pageOf(selected.handle)!;
        splice({ start: page.last, end: page.last, text: `\n\n${stub.md}` });
        return;
    }
    if (selected) {
        const range = rangeOf(selected.handle);
        if (!range) return;
        if (stub?.md) splice({ start: range.end, end: range.end, text: `\n\n${stub.md}` });
        else insertAfter(selected.handle, range.end);
        return;
    }
    const page = pageInView();
    const last = page && doc.pages.find(p => p.ids.includes(page));
    if (!last) return hint("Nothing selected", true, 2000);
    const anchor = document.querySelector<HTMLElement>(`[data-ainsi-entity="${last.ids.at(-1)}"]`);
    if (!anchor) return;
    if (stub?.md) splice({ start: last.last, end: last.last, text: `\n\n${stub.md}` });
    else insertAfter(anchor, last.last);
}

/*
 * Duplicate is a copy put straight after the original rather than through the clipboard, so it
 * neither asks for a permission nor takes what was on it.
 */
function duplicateSelection(): void {
    if (!selected) return hint("Nothing selected", true, 2000);
    if (selected.kind === "page") {
        const page = pageOf(selected.handle);
        if (!page) return;
        const span = pageSpan(doc.source, page);
        splice(addPage(page, doc.source.slice(span.start, span.end).trim()));
        return;
    }
    const range = rangeOf(selected.handle);
    if (range) splice({ start: range.end, end: range.end, text: `\n\n${range.md}` });
}

/** the id of the first entity on the page nearest the middle of the window */
function pageInView(): string | undefined {
    const middle = innerHeight / 2;
    let nearest: { id: string; away: number } | undefined;
    for (const section of document.querySelectorAll<HTMLElement>(".ainsi-page")) {
        const id = section.querySelector<HTMLElement>("[data-ainsi-entity]")?.dataset.ainsiEntity;
        if (!id) continue;
        const box = section.getBoundingClientRect();
        const away = Math.abs(box.top + box.height / 2 - middle);
        if (!nearest || away < nearest.away) nearest = { id, away };
    }
    return nearest?.id;
}

function deleteSelection(): void {
    if (!selected) return hint("Nothing selected", true, 2000);
    if (selected.kind === "page") {
        const page = pageOf(selected.handle);
        if (!page) return;
        select(undefined);
        splice(removePage(doc.source, page));
        return;
    }
    const target = targetOf(selected.handle);
    if (!target) return;
    select(undefined);
    splice(remove(doc.source, target));
}

/*
 * Dragging a block to another place in the deck.
 *
 * A press that never moves far is a click and opens the menu, so the grip carries both without
 * either getting in the way. While dragging, a line is drawn under whatever the pointer is
 * over, which is where the block will land, and the drop is one splice like every other edit.
 */
const DRAG = 4;

function startDrag(event: MouseEvent, handle: HTMLElement): void {
    if (event.button !== 0) return;
    const from = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let over: HTMLElement | undefined;

    const line = h("div", { class: "ainsi-studio__drop-line" });

    const under = (x: number, y: number): HTMLElement | undefined => {
        const at = document.elementFromPoint(x, y) as HTMLElement | null;
        const found = at && handleAt(at);
        return found && found !== handle ? found : undefined;
    };

    const moved = (move: MouseEvent): void => {
        if (!dragging && Math.hypot(move.clientX - from.x, move.clientY - from.y) < DRAG) return;
        if (!dragging) {
            dragging = true;
            document.body.append(line);
            document.body.setAttribute("data-ainsi-dragging", "");
        }
        over = under(move.clientX, move.clientY);
        if (!over) return void (line.hidden = true);
        const box = over.getBoundingClientRect();
        line.hidden = false;
        line.style.left = `${box.left}px`;
        line.style.width = `${box.width}px`;
        line.style.top = `${box.bottom + 2}px`;
    };

    const dropped = (): void => {
        removeEventListener("mousemove", moved);
        removeEventListener("mouseup", dropped);
        line.remove();
        document.body.removeAttribute("data-ainsi-dragging");
        if (!dragging || !over) return;
        const held = targetOf(handle);
        const onto = targetOf(over);
        const splicing = held && onto && moveTo(doc.source, held, onto);
        if (splicing) splice(splicing);
    };

    addEventListener("mousemove", moved);
    addEventListener("mouseup", dropped);
}

/** the page picked up, with the bar that says what can be done to it */
function selectPage(section: HTMLElement): void {
    select(section, "page");
    openPageMenu(section, section.getBoundingClientRect());
}

/** the target a splice needs, for the entity or span a handle stands for */
function targetOf(handle: HTMLElement): Target | undefined {
    const id = handle.dataset.ainsiEntity ?? handle.dataset.ainsiSpan?.split(" ")[0];
    const entity = doc.entities.find(e => e.id === id);
    const block = doc.blocks.find(b => entity && b.ids.includes(entity.id));
    return entity && block ? targetFor(entity, block) : undefined;
}

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

/**
 * What a move may swap this target with: the units on the same page, above and below. A unit
 * is what a menu addresses, a governed block whole and an ungoverned entity on its own, so
 * moving a paragraph inside a run of prose reorders the run rather than jumping the block.
 */
function beside(target: Target, block: DocBlock): [Target | undefined, Target | undefined] {
    const page = doc.pages.find(p => p.ids.includes(block.ids[0]!));
    if (!page) return [undefined, undefined];
    const units: Target[] = [];
    for (const one of doc.blocks.filter(b => page.ids.includes(b.ids[0]!))) {
        const ids = one.origin === "directive" ? [one.ids[0]!] : one.ids;
        for (const id of ids) {
            const entity = doc.entities.find(e => e.id === id);
            if (entity) units.push(targetFor(entity, one));
        }
    }
    const i = units.findIndex(u => u.start === target.start);
    return i < 0 ? [undefined, undefined] : [units[i - 1], units[i + 1]];
}

/** the props worth writing: those that differ from the schema's own defaults */
function explicit(fields: Field[], props: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
        const value = props[field.name];
        if (value !== undefined && value !== field.default) out[field.name] = value;
    }
    return out;
}

/*
 * The file browser: folders and markdown, nothing else, under the folder the studio was
 * started in. Opening a deck is the same as having launched the studio on it, so the server
 * repoints and pushes a reload rather than the client patching itself into the new deck.
 */
async function openDrill(panel: HTMLElement, at?: string): Promise<void> {
    const query = at === undefined ? "" : `?at=${encodeURIComponent(at)}`;
    const response = await fetch(`/__browse${query}`);
    if (!response.ok) return hint(await response.text(), true, 4000);
    const { here, up, entries, current } = await response.json() as {
        here: string; up?: string; entries: { name: string; dir: boolean }[]; current?: string;
    };
    const rows = entries.map(entry => {
        const row = menuItem(entry.dir ? `${entry.name}/` : entry.name, () => {
            if (entry.dir) return void openDrill(panel, join(at ?? "", entry.name));
            void repoint("/__open", { path: join(at ?? "", entry.name) });
        });
        if (!entry.dir && entry.name === current) row.setAttribute("data-active", "");
        return row;
    });
    if (up !== undefined) rows.unshift(menuItem("../", () => void openDrill(panel, up)));
    // whatever a deck can be opened from can make one: the new deck lands in the folder on screen
    rows.unshift(menuItem("New presentation", () => void repoint("/__new", { at: at ?? "" })));
    drill(panel, here, ...rows);
}

const join = (a: string, b: string): string => (a ? `${a}/${b}` : b);

/*
 * Point the server at another deck and reload onto it. The reload is this client's own, not
 * the one the server pushes: that push is held while an editor is open, and the studio has no
 * chrome registered for the viewer's menu, so a stale hold from an earlier edit swallowed it
 * and the click did nothing until the page was reloaded by hand.
 */
async function repoint(path: string, body: Record<string, string>): Promise<void> {
    const response = await fetch(path, { method: "POST", body: JSON.stringify(body) });
    if (!response.ok) return hint((await response.text()) || "could not open", true, 4000);
    location.reload();
}

async function themeDrill(panel: HTMLElement): Promise<void> {
    const { themes, current } = await (await fetch("/__themes")).json() as { themes: string[]; current: string };
    drill(panel, "Theme", ...themes.map(theme => {
        const row = menuItem(theme, () => { const change = themeChange(theme); if (change) splice(change); });
        if (theme === current) row.setAttribute("data-active", "");
        return row;
    }));
}

/*
 * Export writes beside the deck under its own name and replaces what is there; the server
 * fits, prints and opens the file, so the studio only reports how it went. Three image
 * levels: screen density, compact for attachments, full for print. Beneath the rule, the
 * same deck as an editable pptx.
 */
function exportDrill(panel: HTMLElement, close: () => void): void {
    const base = doc.file.replace(/\.[^.]+$/, "");
    const write = (path: string, target: string) => async () => { close(); await exportTo(path, target); };
    drill(panel, "Export",
        menuItem(`PDF, as ${base}.pdf`, write("/__pdf?images=screen", `${base}.pdf`)),
        menuItem("PDF, compact", write("/__pdf?images=compact", `${base}.pdf`)),
        menuItem("PDF, full-resolution images", write("/__pdf?images=full", `${base}.pdf`)),
        h("div", { class: "ainsi-menu__rule" }),
        menuItem(`PPTX, editable, as ${base}.pptx`, write("/__pptx", `${base}.pptx`)),
        h("div", { class: "ainsi-menu__rule" }),
        // the deck itself: what someone else needs in order to keep writing it
        menuItem(`Deck and its files, as ${base}.zip`, write("/__zip", `${base}.zip`)),
    );
}

/** The export itself, apart from the menu that asks for it: a desktop shell's File menu wants
 *  the same write and the same hints, and neither should be a second copy of this. */
async function exportTo(path: string, target: string): Promise<void> {
    hint(`Writing ${target}…`);
    try {
        const response = await fetch(path, { method: "POST" });
        if (response.ok) hint(`Wrote ${target}`, false, 2500);
        else hint((await response.text()) || `export failed: ${response.status}`, true, 6000);
    } catch {
        hint("Export failed: server unreachable", true, 6000);
    }
}

/*
 * The deck's settings are its frontmatter, and the frontmatter is a slice like any block:
 * the same editor, in flow above the first page, the same splice. Opened from the menu, or
 * by clicking the mark.
 * The theme keeps its own picker beside it; here it is one more line.
 */
const MATTER = /^---\n([\s\S]*?)\n---\n*/;   // the blank lines after it go with it; the commit writes its own
const KEYS = "logo: assets/mark.png\ncoverLogo: assets/cover-mark.png\nratio: 16:9\nlayout: default\nnumbers: on\ntheme: acme";

function openDeck(): void {
    const page = document.querySelector<HTMLElement>(".ainsi-page");
    if (!page) return;
    const matter = MATTER.exec(doc.source);
    const initial = matter?.[1] ?? "";
    openEditor(page, {
        initial,
        caret: "end",
        mode: "deck",
        placeholder: `frontmatter, one key per line\n${KEYS}`,
        commit: text => {
            const body = text.trim();
            if (body === initial.trim()) return undefined;
            const end = matter ? matter[0].length : 0;
            return { start: 0, end, text: body ? `---\n${body}\n---\n\n` : "" };
        },
    });
}

/** whether a click on a page landed on its mark, whose box is a pseudo-element's computed style */
function onMark(event: MouseEvent): boolean {
    const at = event.target as HTMLElement;
    const page = at.closest?.<HTMLElement>(".ainsi-page");
    if (!page || (at !== page && !at.matches("main, article"))) return false;
    const style = getComputedStyle(page, "::before");
    if (style.backgroundImage === "none" || style.content === "none") return false;
    const px = (v: string) => (v === "auto" ? NaN : parseFloat(v));
    const rect = page.getBoundingClientRect();
    const w = px(style.width), h = px(style.height);
    const left = Number.isNaN(px(style.right)) ? rect.left + px(style.left) : rect.right - px(style.right) - w;
    const top = Number.isNaN(px(style.bottom)) ? rect.top + px(style.top) : rect.bottom - px(style.bottom) - h;
    return event.clientX >= left && event.clientX <= left + w && event.clientY >= top && event.clientY <= top + h;
}

/** the theme is one frontmatter line, and the default theme is the absent line: picking it
 * removes the key, so a round trip through another theme leaves the file as it was */
function themeChange(theme: string): { start: number; end: number; text: string } | undefined {
    const matter = /^---\n([\s\S]*?)\n---/.exec(doc.source);
    const line = matter && /^theme:.*$/m.exec(matter[1]!);
    if (theme === "default") {
        if (!line) return undefined;
        if (line[0] === matter![1]) return { start: 0, end: matter![0].length, text: "" };
        const start = 4 + line.index;
        return { start, end: start + line[0].length + 1, text: "" };
    }
    if (matter) {
        if (line) {
            const start = 4 + line.index;
            return { start, end: start + line[0].length, text: `theme: ${theme}` };
        }
        return { start: 4, end: 4, text: `theme: ${theme}\n` };
    }
    return { start: 0, end: 0, text: `---\ntheme: ${theme}\n---\n\n` };
}

interface Range { start: number; end: number; md: string; kind: string }

/** a rendered page is the one owning its first entity */
function pageOf(section: HTMLElement): DocPage | undefined {
    const handle = section.querySelector<HTMLElement>("[data-ainsi-entity], [data-ainsi-span]");
    const id = handle?.dataset.ainsiEntity ?? handle?.dataset.ainsiSpan?.split(" ")[0];
    return doc.pages.find(p => id && p.ids.includes(id));
}

/** an entity handle is one slice; a block handle spans the entities its component inlined */
function rangeOf(target: HTMLElement): Range | undefined {
    const byId = (id: string | undefined) => doc.entities.find(e => e.id === id);
    if (target.dataset.ainsiEntity) {
        const entity = byId(target.dataset.ainsiEntity);
        return entity && { start: entity.start, end: entity.end, md: entity.md, kind: entity.kind };
    }
    const [firstId, lastId] = (target.dataset.ainsiSpan ?? "").split(" ");
    const first = byId(firstId);
    const last = byId(lastId);
    return first && last
        ? { start: first.start, end: last.end, md: doc.source.slice(first.start, last.end), kind: "block" }
        : undefined;
}

/** every edit target in document order: entity handles and the block handles between them */
const wrappers = () => [...document.querySelectorAll<HTMLElement>("[data-ainsi-entity], [data-ainsi-span]:not([data-ainsi-entity])")];

/** ids are content hashes and change on every commit, so flow lands by position */
function openAt(index: number, caret: Caret): void {
    const all = wrappers();
    const target = all[Math.max(0, Math.min(all.length - 1, index))];
    const range = target && rangeOf(target);
    if (target && range) edit(target, range, caret);
}

function edit(target: HTMLElement, range: Range, caret: Caret): void {
    if (range.kind === "image" && openImage(target, range)) return;
    const mode: Mode = range.kind === "heading" || range.kind === "paragraph" ? "inplace" : "overlay";
    openEditor(target, {
        initial: range.md,
        caret,
        mode,
        commit: text => (text === range.md ? undefined : { start: range.start, end: range.end, text }),
    });
}

/*
 * An image is two facts, name and url, plus an optional title kept as written. The form
 * replaces the source textarea; markup the pattern does not cover (a link around the image,
 * attributes) falls back to it.
 */
const IMAGE = /^!\[((?:[^[\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^\s)]*)(?:\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))?\s*\)\s*$/;

function openImage(target: HTMLElement, range: Range): boolean {
    const match = IMAGE.exec(range.md);
    if (!match) return false;
    const [, altText = "", rawUrl = "", title = ""] = match;
    const url = rawUrl.startsWith("<") ? rawUrl.slice(1, -1) : rawUrl;

    const panel = h("form", { class: "ainsi-studio__image" });
    const field = (name: string, value: string, placeholder: string): HTMLInputElement => {
        const input = h("input", { class: "ainsi-studio__input", value, placeholder, spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;
        panel.append(h("label", { class: "ainsi-studio__imagerow" }, h("span", { class: "ainsi-studio__fieldname" }, name), input));
        return input;
    };
    const alt = field("name", altText, "what the picture shows");
    const src = field("url", url, "https://… or a local path");
    panel.append(h("p", { class: "ainsi-studio__imagehint" },
        "A local file works by path, relative to the deck folder or absolute. It stays linked, not copied: change the file and the deck shows the new one."));
    panel.append(h("button", { class: "ainsi-studio__imageok", type: "submit" }, "OK"));

    // delete, top right like the block toolbar's; the whole block goes, directive and all
    const id = target.dataset.ainsiEntity ?? target.dataset.ainsiSpan?.split(" ")[0];
    const entity = doc.entities.find(e => e.id === id);
    const block = entity && doc.blocks.find(b => b.ids.includes(entity.id));
    if (entity && block) {
        const bin = iconButton("trash", "Delete", false, () => {
            done = true;
            editor.holds = false;
            splice(remove(doc.source, targetFor(entity, block)));
        });
        bin.classList.add("ainsi-studio__imagetrash");
        panel.append(bin);
    }

    const rect = target.getBoundingClientRect();
    panel.style.left = `${rect.left + scrollX}px`;
    panel.style.top = `${rect.top + scrollY}px`;
    panel.style.width = `${Math.min(Math.max(rect.width, 320), 560)}px`;
    document.body.append(panel);
    target.classList.add("ainsi-studio--dim");

    let done = false;
    const editor: Chrome = {
        kind: "block",
        holds: true,
        close() {
            done = true;
            panel.remove();
            target.classList.remove("ainsi-studio--dim");
        },
    };
    show(editor);
    src.focus();
    src.setSelectionRange(src.value.length, src.value.length);

    const commit = async () => {
        if (done) return;
        done = true;
        const href = src.value.trim();
        const text = `![${alt.value.trim()}](${/[\s)]/.test(href) ? `<${href}>` : href}${title ? ` ${title}` : ""})`;
        if (text === range.md) { if (chrome === editor) shut(); return; }
        for (const input of [alt, src]) input.readOnly = true;
        hint("saving…");
        editor.holds = false;
        await splice({ start: range.start, end: range.end, text });
    };

    panel.addEventListener("submit", event => { event.preventDefault(); commit(); });
    panel.addEventListener("keydown", event => {
        event.stopPropagation();                        // the viewer's own keys stay out of the inputs
        if (event.key === "Escape") { event.preventDefault(); if (chrome === editor) shut(); }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commit(); }
    });
    // a click on the panel's own chrome keeps focus in the field; focus leaving the panel commits
    panel.addEventListener("mousedown", event => { if (!(event.target as HTMLElement).matches("input")) event.preventDefault(); });
    panel.addEventListener("focusout", event => {
        if (panel.contains(event.relatedTarget as Node | null)) return;
        commit();
    });
    return true;
}

/*
 * The plus button's choice: markdown opens the insert textarea, image splices a placeholder
 * block, which is clicked into the image form like any image. Alt-click stays the markdown
 * shortcut past the menu.
 */
/*
 * What can go after something. The kinds are the engine's own vocabulary, so this list cannot
 * drift from what the parser understands; which components each kind can become is asked of
 * the registry through `/__doc`, so that half cannot drift either. Everything here is markdown
 * a person could have typed, which is the only kind of insert this tool has.
 */
const INSERTS: { label: string; icon: IconName; md: string; takes?: string }[] = [
    { label: "Text", icon: "text", md: "" },
    { label: "Bullets", icon: "list", md: "- One\n- Two\n- Three", takes: "list" },
    { label: "Numbered", icon: "ordered", md: "1. One\n2. Two\n3. Three", takes: "list" },
    { label: "Quote", icon: "quote", md: "> Quote." },
    { label: "Callout", icon: "alert", md: "> [!NOTE]\n> Worth knowing." },
    { label: "Code", icon: "code", md: "```\ncode\n```" },
    { label: "Table", icon: "table", md: "| A | B |\n| --- | --- |\n| 1 | 2 |", takes: "table" },
    { label: "Image", icon: "image", md: "![]()", takes: "image" },
];

/** the components that will take this kind on their own, minus the one grouping picks anyway */
const shownAs = (kind: string | undefined): string[] =>
    kind === undefined ? [] : doc.components.filter(c => c.takes.includes(kind) && c.name !== "prose").map(c => c.name);

function openInsertMenu(target: HTMLElement, at: number, from: DOMRect): void {
    menu = document.createElement("div");
    menu.className = "ainsi-studio__bar";
    menu.addEventListener("click", event => event.stopPropagation());

    /** the splice an insert is: a blank line, the markdown, and the directive when one is named */
    const put = (md: string, component?: string) => () => {
        closeMenu();
        if (!md) return insertAfter(target, at);
        const directive = component ? `${directiveLine(component, {})}\n\n` : "";
        splice({ start: at, end: at, text: `\n\n${directive}${md}` });
    };

    const option = (icon: IconName, text: string, onClick: () => void) => {
        const button = h("button", { class: "ainsi-studio__barbutton", type: "button", click: onClick });
        button.innerHTML = icons[icon];
        button.append(text);
        return button;
    };

    menu.append(option("page", "Page", () => { closeMenu(); insertPage(target.closest<HTMLElement>(".ainsi-page")!); }), divider());
    for (const { label, icon, md, takes } of INSERTS) {
        const forms = shownAs(takes);
        // a kind one component can shape is a button; a kind several can is that button and a list
        if (!forms.length) { menu.append(option(icon, label, put(md))); continue; }
        menu.append(dropdown(label, [
            item(label, "plain", false, put(md)),
            ...forms.map(name => item(name, "", false, put(md, name))),
        ]));
    }

    document.body.append(menu);
    place(menu, from);
    addEventListener("keydown", menuKey);
    const bar = menu;
    show({ kind: "menu", holds: false, close() { bar.remove(); if (menu === bar) menu = undefined; removeEventListener("keydown", menuKey); } });
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

/*
 * The layouts whose ground stands in for a missing image invite a click there: it writes the
 * image block the hint promises and reopens on it, so the form is already up after the
 * rebuild. Only a click on main itself counts; anything with a handle went to edit instead.
 */
function onEmptyGround(event: MouseEvent): boolean {
    const at = event.target as HTMLElement;
    if (!(at instanceof HTMLElement) || at.tagName !== "MAIN") return false;
    const section = at.closest<HTMLElement>("[data-layout=\"header\"], [data-layout=\"split\"]");
    if (!section || at.querySelector(".ainsi-full")) return false;
    const page = pageOf(section);
    if (!page) return false;
    const own = section.querySelectorAll<HTMLElement>("[data-ainsi-entity], [data-ainsi-span]:not([data-ainsi-entity])");
    const last = wrappers().indexOf(own[own.length - 1]!);
    sessionStorage.setItem(REOPEN, `${last + 1}|end`);
    splice({ start: page.last, end: page.last, text: "\n\n![]()" });
    return true;
}

/** a new page below this one, written at once with a placeholder title that reopens selected */
function insertPage(section: HTMLElement): void {
    const page = pageOf(section);
    if (!page) return;
    const own = section.querySelectorAll<HTMLElement>("[data-ainsi-entity], [data-ainsi-span]:not([data-ainsi-entity])");
    const last = wrappers().indexOf(own[own.length - 1]!);
    sessionStorage.setItem(REOPEN, `${last + 1}|select`);
    splice(addPage(page, "# New page"));
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
    area.className = `ainsi-studio__editor ainsi-studio__editor--${options.mode}`;
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
        target.classList.add("ainsi-studio--hidden");
    } else if (options.mode === "overlay") {
        const rect = target.getBoundingClientRect();
        area.style.left = `${rect.left + scrollX}px`;
        area.style.top = `${rect.top + scrollY}px`;
        area.style.width = `${Math.min(rect.width, 680)}px`;
        document.body.append(area);
        target.classList.add("ainsi-studio--dim");
    } else if (options.mode === "deck") {
        // above the first page and outside it: the deck's own settings, not page one's
        target.insertAdjacentElement("beforebegin", area);
        scrollTo({ top: 0 });
    } else {
        target.insertAdjacentElement("afterend", area);
    }

    // the marks bar: the same wraps as the chords, shown above the textarea while a selection
    // is live, so the syntax is a click away and still visible in the text it lands in
    const marks = h("div", { class: "ainsi-studio__marks" },
        ...([["**", "B", `Bold (${MOD}B)`], ["*", "I", `Italic (${MOD}I)`], ["`", "</>", "Inline code"], ["==", "==", "Highlight"]] as const).map(([marker, text, tip]) =>
            h("button", { class: "ainsi-studio__mark", type: "button", "data-tip": tip, "aria-label": tip, mousedown: (e: Event) => e.preventDefault(), click: () => mark(area, marker) }, text)));
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
            target.classList.remove("ainsi-studio--hidden", "ainsi-studio--dim");
        },
    };
    show(editor);

    size(area);
    area.focus();
    if (options.caret === "select") area.setSelectionRange(/^#*\s*/.exec(area.value)![0].length, area.value.length);
    else { const at = options.caret === "end" ? area.value.length : 0; area.setSelectionRange(at, at); }
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
 * is a replace through the hash guard, so the server learns nothing new.
 *
 * A page number opens it over that page's slice instead of the file, for the common case of
 * splicing the page you are looking at rather than finding it in a deck's worth of markdown.
 */
let discardArmed: ReturnType<typeof setTimeout> | undefined;

async function openRaw(index?: number): Promise<void> {
    if (chrome?.kind === "block" || chrome?.kind === "raw" || document.body.hasAttribute("data-present")) return;
    // refetched rather than trusted: a held reload means the module's copy can be stale
    doc = await (await fetch("/__doc")).json();

    // by number, because the refetch may have brought new ids: a page keeps its place in the
    // deck across an edit somewhere else, and a deck that lost the page has nothing to open
    const page = index === undefined ? undefined : doc.pages[index];
    if (index !== undefined && !page) return hint("that page is gone", true);
    const range = page ? pageSpan(doc.source, page) : { start: 0, end: doc.source.length };
    const initial = doc.source.slice(range.start, range.end);

    const view = new EditorView({
        doc: initial,
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
    const container = h("div", { class: "ainsi-studio__raw" },
        h("div", { class: "ainsi-studio__rawbar" },
            h("span", { class: "ainsi-studio__rawname" }, page ? `${doc.file} · page ${index! + 1}` : doc.file),
            h("span", { class: "ainsi-studio__rawgap" }),
            barButton("Cancel", "esc", () => cancelRaw()),
            save),
        view.dom);

    document.body.append(container);
    document.body.setAttribute("data-ainsi-raw", "");
    show({
        kind: "raw",
        holds: true,
        close() {
            view.destroy();
            container.remove();
            document.body.removeAttribute("data-ainsi-raw");
            document.querySelector(".ainsi-studio__hint")?.remove();
        },
    });
    view.focus();

    async function commitRaw(): Promise<void> {
        if (container.hasAttribute("data-committing")) return;
        const text = view.state.doc.toString();
        if (text === initial) return shut();
        // frozen, not closed, until the rebuilt page arrives; same reasoning as the block editor
        container.setAttribute("data-committing", "");
        view.contentDOM.setAttribute("contenteditable", "false");
        hint("saving…");
        if (chrome?.kind === "raw") chrome.holds = false;
        await splice({ ...range, text });
    }

    function cancelRaw(): void {
        if (container.hasAttribute("data-committing")) return;
        if (view.state.doc.toString() !== initial && !discardArmed) {
            hint("unsaved changes; esc again to discard");
            discardArmed = setTimeout(() => (discardArmed = undefined), 1600);
            return;
        }
        clearTimeout(discardArmed);
        discardArmed = undefined;
        shut();
    }
}

/** `onto` is where the inverse lands: the undo stack for an edit, the other stack for a step */
async function splice(change: Splice, onto: string = UNDO): Promise<void> {
    // a toolbar press is committed the moment it is pressed: the bar freezes until the
    // rebuilt page arrives, because a second press would splice against a stale hash
    if (chrome?.kind === "menu" && menu) {
        menu.setAttribute("data-busy", "");
        hint("saving…");
    }
    let failure: string | undefined;
    traceMark("sent");
    try {
        const response = await fetch("/__edit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hash: doc.hash, ...change }),
            signal: AbortSignal.timeout(8000),      // a hung write lands in the failure path, not a frozen editor
        });
        traceMark("answered");
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
    push(onto, inverse(change, doc.source));
    if (onto === UNDO) sessionStorage.removeItem(REDO);
    // on success the server rebuilds and the reload arrives over the SSE channel; if it
    // never does (the rebuild threw, the channel dropped), the page frees itself rather
    // than leave a frozen editor. Generous, so a slow fit pass is not cut short.
    setTimeout(() => location.reload(), 5000);
}
