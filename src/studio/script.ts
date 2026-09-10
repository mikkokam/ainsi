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
import { ALERT_KINDS, MATTER, RATIOS, SETTINGS, addPage, alertOf, directiveLine, isOther, markerOf, matterValue, move, movePage, moveTo, pageSpan, strands, toGrid, toItems, toList, toMarkdown, relayout, remove, removePage, render as structural, retag, withAlert, writeMatter, type Target, type TextKind } from "./edits";
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
type Mode = "inplace" | "overlay" | "insert";

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
interface Selection { kind: "block" | "page" | "deck"; handle?: HTMLElement }
let selected: Selection | undefined;

function select(handle: HTMLElement | undefined, kind: Selection["kind"] = "block"): void {
    if (selected?.handle === handle && selected?.kind === kind) return;
    for (const el of document.querySelectorAll("[data-ainsi-selected]")) {
        el.removeAttribute("data-ainsi-selected");
    }
    selected = handle ? { kind, handle } : undefined;
    handle?.setAttribute("data-ainsi-selected", "");
}

/** select every page in the deck, or the text inside an open field */
function selectAll(): void {
    const focused = document.activeElement as HTMLElement | null;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
        focused.select();
        return;
    }
    if (focused?.closest?.("[contenteditable]")) {
        document.execCommand("selectAll");
        return;
    }
    if (chrome?.kind === "block" || chrome?.kind === "raw") return;
    if (chrome?.kind === "menu") shut();
    window.getSelection()?.removeAllRanges();
    for (const el of document.querySelectorAll("[data-ainsi-selected]")) {
        el.removeAttribute("data-ainsi-selected");
    }
    const pages = document.querySelectorAll<HTMLElement>(".ainsi-page");
    if (!pages.length) return;
    for (const page of pages) {
        page.setAttribute("data-ainsi-selected", "");
    }
    selected = { kind: "deck" };
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
        // only a commit starts a record. The server pushes a reload for any change it sees,
        // including one an external editor made, and a later leg starting its own record left
        // a round trip with no beginning to measure from.
        if (leg !== "sent" && !kept) return;
        const record = leg === "sent" ? { sent: at } : { ...JSON.parse(kept!), [leg]: at };
        sessionStorage.setItem(TRACE, JSON.stringify(record));
    } catch { /* private mode, or a full quota: a trace is never worth breaking an edit for */ }
}

/** the round trip just finished, so the status pill has something to show on the page it lands on */
let lastCommitMs: number | undefined;

function traceReport(): void {
    try {
        const kept = sessionStorage.getItem(TRACE);
        if (!kept) return;
        sessionStorage.removeItem(TRACE);
        const { sent, answered, told } = JSON.parse(kept) as { sent?: number; answered?: number; told?: number };
        if (typeof sent !== "number") return;       // a record written before the guard above
        const total = Date.now() - sent;
        lastCommitMs = total;
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
    (document.querySelector(".ainsi-toolbar") ?? document.body).append(divider(), field);
}

/*
 * The nav pill's icons take their word in the app, where the strip runs the width of the window
 * and a row of bare glyphs in a titlebar is a guessing game. The word is the button's own name
 * without the shortcut it already carries in its tooltip.
 */
function labelToolbar(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>(".ainsi-toolbar__button")) {
        const name = button.getAttribute("aria-label")?.split(" (")[0];
        if (name) button.append(h("span", { class: "ainsi-toolbar__label" }, name));
    }
}

/**
 * The page nearest the top of the viewport: what ⌥⌘E or "Edit page source" means with nothing more
 * specific selected. The same measure the viewer's own nearest() takes for presenting, kept
 * separate because that one is a private closure the studio has no way to call into.
 */
function nearestPage(): number {
    const pages = [...document.querySelectorAll<HTMLElement>(".ainsi-page")];
    let best = 0;
    let distance = Infinity;
    pages.forEach((page, i) => {
        const offset = Math.abs(page.getBoundingClientRect().top);
        if (offset < distance) { distance = offset; best = i; }
    });
    return best;
}

/**
 * The right cluster: Edit page source, and Export where there is no menu bar to hold it. Both
 * are reachable from the nav pill's own dropdown too, so this is a shortcut to the same code
 * rather than a second way to do either. Export has no dialog of its own here: the pill opens
 * the viewer's menu and drills straight to the Export section it already builds, which is why
 * the app does without it. There the File menu holds Export with its variants and its shortcut,
 * and a button in the titlebar that answers by opening a menu at the far end of the window
 * reads as two surfaces disagreeing about where the action lives.
 */
function mountRightCluster(): void {
    const source = h("button", { class: "ainsi-studio__pill", type: "button", title: "Edit page source  ⌥⌘E", "aria-label": "Edit page source" });
    source.innerHTML = icons.code;
    source.append("Edit page source", h("span", { class: "ainsi-studio__pillkey" }, "⌥⌘E"));
    source.addEventListener("click", () => void openRaw(nearestPage()));

    const cluster = h("div", { class: "ainsi-studio__cluster" }, source);
    if (!desktop) {
        const exportButton = h("button", { class: "ainsi-studio__pill", type: "button", title: "Export…", "aria-label": "Export…", click: () => drillTo("Export…") });
        exportButton.innerHTML = icons.export;
        exportButton.append("Export…");
        cluster.append(exportButton);
    }
    // in the app the strip is the window's titlebar and these are its right end; in a browser
    // there is no strip to join, so they stay a corner of their own
    ((desktop && document.querySelector(".ainsi-toolbar")) || document.body).append(cluster);
}

/*
 * Opens the nav pill's own menu and presses one of its rows, rather than growing a second
 * surface for what the menu already builds. A row may carry a hint after its name, which is
 * why the match is on the start of it.
 */
function drillTo(label: string): void {
    document.querySelector<HTMLButtonElement>('.ainsi-toolbar__button[title="Menu"]')?.click();
    [...document.querySelectorAll<HTMLButtonElement>(".ainsi-menu__item")].find(el => el.textContent?.startsWith(label))?.click();
}

/*
 * The app has a file dialog of its own, and it is the one to use: this drill is what a browser
 * tab has instead. The shell is parked on the studio waiting to be asked.
 */
const askShell = (what: string) => fetch("/__shell-ask", { method: "POST", body: JSON.stringify({ what }) });

/*
 * Leaving for another document: the chooser, or another deck. The landing covers itself the
 * same way on the way in, so the two meet on one colour instead of the window blanking between
 * them. Only a hand-off gets this; the reload after a commit is the same document and must not
 * flash.
 */
const LEAVING = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220;

function veil(): Promise<void> {
    if (!LEAVING) return Promise.resolve();
    const sheet = h("div", { class: "ainsi-studio__veil" });
    document.body.append(sheet);
    // the start value has to be on screen for a frame before the end value lands, or there is
    // nothing to transition from
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.setAttribute("data-leaving", "")));
    return new Promise(done => setTimeout(done, LEAVING));
}

/*
 * The app's own update, offered in the strip: the shell checks at launch and announces what it
 * found, again after every reload, because the studio reloads this page on every commit. Only
 * the shell sends it, so a browser tab never grows a badge for a tool it does not install.
 */
document.addEventListener("ainsi:update", event => {
    const { version, error } = (event as CustomEvent).detail as { version: string | null; error?: string };
    document.querySelector(".ainsi-studio__update")?.remove();
    if (error) return hint(`Could not check for updates: ${error}`, true, 4000);
    if (!version) return hint("Ainsi is up to date", false, 2500);
    const button = h("button", {
        class: "ainsi-studio__pill ainsi-studio__update", type: "button",
        title: `Install Ainsi ${version} and restart`, click: () => void askShell("update"),
    }, `Update to ${version}`);
    (document.querySelector(".ainsi-studio__cluster") ?? document.body).prepend(button);
});

/** back to the chooser: the server forgets the deck, and the reload lands on the landing page */
async function closeDeck(): Promise<void> {
    const response = await fetch("/__close", { method: "POST" });
    if (!response.ok) return hint((await response.text()) || "could not close the deck", true, 3000);
    await veil();
    location.reload();
}

/**
 * The status pills, bottom corners: where you are in the deck, and how the last write went.
 * The page number tracks scroll the same way the viewer's own reading position does; the
 * commit time is whatever traceReport() read back from the load that just happened, so it is
 * one page behind the write it describes rather than nothing at all.
 */
function mountStatusPills(): void {
    const page = h("span", { class: "ainsi-studio__statuspage" });
    const left = h("div", { class: "ainsi-studio__status ainsi-studio__status--left" },
        page, h("span", {}, "⌘⏎ present"), h("span", {}, "⌘G grid"), h("span", {}, "⌥⌘E page source"));
    const saved = h("span", {}, "ready");
    const right = h("div", { class: "ainsi-studio__status ainsi-studio__status--right" },
        h("span", { class: "ainsi-studio__statusdot" }), saved);
    document.body.append(left, right);

    const update = () => {
        const total = document.querySelectorAll(".ainsi-page").length;
        page.textContent = total ? `page ${nearestPage() + 1} / ${total}` : "";
    };
    update();
    addEventListener("scroll", update, { passive: true });
    if (lastCommitMs !== undefined) saved.textContent = `saved · ${lastCommitMs} ms`;
}

const SCROLL = "ainsi-scroll";
const REOPEN = "ainsi-reopen";
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/* who is showing this page, stamped on the body by the server; the app is the one that has a
 * titlebar of its own for the chrome to become */
const desktop = document.body.dataset.ainsiHost === "electrobun";

init();

async function init(): Promise<void> {
    doc = await (await fetch("/__doc")).json();
    document.body.setAttribute("data-ainsi-edit", "");
    if (desktop) labelToolbar();
    mountFileField();
    mountRightCluster();
    mountStatusPills();

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
        if (key === "a") {
            if (chrome?.kind === "block" || chrome?.kind === "raw") return;
            if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
            if (document.body.hasAttribute("data-present")) return;
            event.preventDefault();
            selectAll();
            return;
        }
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
            if (selected.kind === "deck") {
                select(undefined);
                return;
            }
            const section = selected.kind === "block" && selected.handle ? selected.handle.closest<HTMLElement>(".ainsi-page") : undefined;
            if (chrome?.kind === "menu") shut();
            if (section) selectPage(section);
            else select(undefined);
            return;
        }
        if (selected.kind === "page" || selected.kind === "deck") return;
        if (!selected.handle) return;
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

    /*
     * The viewer's menu announces itself on open and offers a slot; theme and export are
     * studio business, because both need the server and the player ships without one. The
     * app name already lives in the titlebar and does not belong twice, so the viewer's own
     * brand row is dropped here in favour of a "Deck" header carrying the theme and page
     * count; the "Slides" header and its rows, already built by the time this fires, are
     * relabelled "Pages" and folded into their own scrolling group.
     */
    document.addEventListener("ainsi:menu", event => {
        const { panel, slot, close } = (event as CustomEvent).detail as { panel: HTMLElement; slot: HTMLElement; close(): void };
        panel.querySelector(".ainsi-menu__brand")?.remove();

        slot.classList.add("ainsi-menu__group");
        const meta = h("span", { class: "ainsi-menu__groupmeta" }, `${doc.pages.length} pages`);
        const themeRow = menuItem("Theme…", () => themeDrill(panel));
        slot.append(
            h("div", { class: "ainsi-menu__grouphead" }, h("span", {}, "Deck"), meta),
            menuItem("Edit deck source", () => void openRaw(), "⇧⌘E"),
            menuItem("Open deck…", () => (desktop ? void askShell("open") : openDrill(panel)), "⌘O"),
            // ⌘W is the app's, from its File menu; a browser keeps that chord for its own tab,
            // so the row only claims a shortcut where there is one
            menuItem("Close deck", () => void closeDeck(), desktop ? "⌘W" : undefined),
            menuItem("Deck settings…", () => { close(); openDeck(); }),
            themeRow,
            menuItem("Export…", () => exportDrill(panel, close)),
        );
        slot.after(h("div", { class: "ainsi-menu__rule" }));
        void (async () => {
            const { current } = await (await fetch("/__themes")).json() as { themes: string[]; current: string };
            meta.textContent = `${current} · ${doc.pages.length} pages`;
            themeRow.querySelector(".ainsi-menu__itemhint")?.remove();
            themeRow.append(h("span", { class: "ainsi-menu__itemhint" }, current));
        })();

        const pagesHead = panel.querySelector<HTMLElement>(".ainsi-menu__head");
        if (!pagesHead) return;
        pagesHead.textContent = "Pages";
        const rows = [...panel.querySelectorAll<HTMLElement>(".ainsi-menu__item")].filter(row => !slot.contains(row));
        for (const row of rows) {
            const numbered = /^(\d+)\s+(.*)$/.exec(row.textContent ?? "");
            if (!numbered) continue;
            row.replaceChildren(
                h("span", { class: "ainsi-menu__pagenum" }, numbered[1]!),
                h("span", { class: "ainsi-menu__pagetitle" }, numbered[2]!),
            );
        }
        panel.append(h("div", { class: "ainsi-menu__pages" }, pagesHead, ...rows));
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
        else if (name === "source-page") void openRaw(nearestPage());
        else if (name === "export") drillTo("Export…");
        else if (name === "theme") drillTo("Theme…");
        else if (name === "close-deck") void closeDeck();
        else if (name === "settings") openDeck();
        else if (name === "pptx") void exportTo("/__pptx", `${base}.pptx`);
        else if (name === "zip") void exportTo("/__zip", `${base}.zip`);
        else if (name === "copy" || name === "cut" || name === "paste") void clipboard(name);
        else if (name === "select-all") selectAll();
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
        if (mode === "Studio") rows.unshift(["click", "edit"], [`${alt} click`, "add a block below"], ["E", "edit the whole file"], [`${alt} ${mod} E`, "edit this page's source"], [`${mod} A`, "select all"], [`${mod} O`, "open another deck"], [`${mod} Z`, "undo the last commit"], [`${mod} ⇧ Z`, "redo"]);
        // ⌘W is the app's alone; in a browser that chord belongs to the tab
        if (mode === "Studio" && desktop) rows.push([`${mod} W`, "close the deck"]);
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

    // ⌥⌘E: the page you are looking at, as a sheet. ⇧⌘E: the whole file, full window.
    // Read `code`, not `key`: Option is a compose modifier on macOS, so ⌥E arrives as the dead
    // acute rather than as "e" and a chord matched on `key` never fires.
    document.addEventListener("keydown", event => {
        if (event.code !== "KeyE" || !(event.metaKey || event.ctrlKey)) return;
        if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
        if (chrome || document.body.hasAttribute("data-present")) return;
        if (event.altKey === event.shiftKey) return;   // neither or both is neither shortcut
        event.preventDefault();
        if (event.altKey) void openRaw(nearestPage());
        else openRaw();
    });

    // ⌘O: the row in the menu says this works, so it works. It presses that row rather than
    // repeating it, which is what keeps the app's native dialog and the browser's drill one door.
    document.addEventListener("keydown", event => {
        if (event.code !== "KeyO" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
        if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
        if (chrome || document.body.hasAttribute("data-present")) return;
        event.preventDefault();
        drillTo("Open deck…");
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
    // Both are always drawn — a pair with one hidden shifts the row's width as you reach an
    // end — and the impossible direction is disabled rather than dropped.
    const [above, below] = beside(target, block);
    if (above || below) {
        menu.append(divider());
        menu.append(iconButton("up", "Move up", false, () => stepBlock(target, above!), !above));
        menu.append(iconButton("down", "Move down", false, () => stepBlock(target, below!), !below));
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
    menu.append(divider(), iconButton("code", "Edit page source", false, () => void openRaw(index)));
    if (before || after) {
        menu.append(iconButton("up", "Move page up", false, () => splice(movePage(doc.source, page, before!)), !before));
        menu.append(iconButton("down", "Move page down", false, () => splice(movePage(doc.source, page, after!)), !after));
    }

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
    if (selected.kind === "deck") return deckClipboard(verb);
    if (selected.kind === "page" && selected.handle) return pageClipboard(verb, selected.handle);
    if (!selected.handle) return;
    const range = rangeOf(selected.handle);
    if (!range) return;
    if (verb === "paste") return paste(range);
    return copy(range, verb === "cut" ? selected.handle : undefined);
}

/*
 * The clipboard on the whole presentation. Copy puts the entire markdown source onto the
 * clipboard; paste replaces the entire deck; cut empties the file.
 */
async function deckClipboard(verb: "copy" | "cut" | "paste"): Promise<void> {
    if (verb === "paste") {
        let text: string;
        try {
            text = (await navigator.clipboard.readText()).trim();
        } catch {
            return hint("The browser would not give the clipboard", true, 4000);
        }
        if (!text) return hint("Nothing on the clipboard", true, 2500);
        return splice({ start: 0, end: doc.source.length, text });
    }

    try {
        await navigator.clipboard.writeText(doc.source);
    } catch {
        return hint("The browser would not give the clipboard", true, 4000);
    }
    if (verb === "copy") return hint("Deck copied", false, 1200);
    select(undefined);
    splice({ start: 0, end: doc.source.length, text: "" });
    hint("Deck cut", false, 1200);
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
        const section = selected?.handle?.closest<HTMLElement>(".ainsi-page")
            ?? document.querySelector<HTMLElement>(`[data-ainsi-entity="${pageInView()}"]`)?.closest<HTMLElement>(".ainsi-page");
        if (section) insertPage(section);
        return;
    }
    const stub = INSERTS.find(i => i.label === label);
    if (selected?.kind === "page" && selected.handle && pageOf(selected.handle)) {
        if (!stub) { insertPage(selected.handle); return; }
        const page = pageOf(selected.handle)!;
        splice({ start: page.last, end: page.last, text: `\n\n${stub.md}` });
        return;
    }
    if (selected?.handle) {
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
    if (selected.kind === "deck") return;
    if (selected.kind === "page" && selected.handle) {
        const page = pageOf(selected.handle);
        if (!page) return;
        const span = pageSpan(doc.source, page);
        splice(addPage(page, doc.source.slice(span.start, span.end).trim()));
        return;
    }
    if (!selected.handle) return;
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
    if (selected.kind === "deck") {
        select(undefined);
        splice({ start: 0, end: doc.source.length, text: "" });
        return;
    }
    if (selected.kind === "page" && selected.handle) {
        const page = pageOf(selected.handle);
        if (!page) return;
        select(undefined);
        splice(removePage(doc.source, page));
        return;
    }
    if (!selected.handle) return;
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
    /** which side of what it is over, so a block can reach the top of a page and not only the end */
    let side: "before" | "after" = "after";

    const line = h("div", { class: "ainsi-studio__drop-line" });

    /*
     * Anywhere on a page answers, not only the blocks themselves. A pointer between two of them
     * or out in a margin still means somewhere, and a line that vanished there made the drag
     * look like it had stopped.
     */
    const under = (x: number, y: number): HTMLElement | undefined => {
        const at = document.elementFromPoint(x, y) as HTMLElement | null;
        const direct = at && handleAt(at);
        if (direct && direct !== handle) return direct;
        const section = at?.closest?.<HTMLElement>(".ainsi-page");
        if (!section) return undefined;
        let best: HTMLElement | undefined;
        let nearest = Infinity;
        for (const candidate of section.querySelectorAll<HTMLElement>("[data-ainsi-entity], [data-ainsi-span]:not([data-ainsi-entity])")) {
            if (candidate === handle || candidate.contains(handle) || handle.contains(candidate)) continue;
            const box = candidate.getBoundingClientRect();
            const away = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
            if (away < nearest) { nearest = away; best = candidate; }
        }
        return best;
    };

    const moved = (move: MouseEvent): void => {
        if (!dragging && Math.hypot(move.clientX - from.x, move.clientY - from.y) < DRAG) return;
        if (!dragging) {
            dragging = true;
            document.body.append(line);
            document.body.setAttribute("data-ainsi-dragging", "");
            // what is being carried, dimmed where it still is, so the drag is visible before it
            // is over anywhere it could land
            handle.setAttribute("data-ainsi-carried", "");
        }
        over = under(move.clientX, move.clientY);
        if (!over) return void (line.hidden = true);
        const box = over.getBoundingClientRect();
        side = move.clientY < box.top + box.height / 2 ? "before" : "after";
        line.hidden = false;
        line.style.left = `${box.left}px`;
        line.style.width = `${box.width}px`;
        line.style.top = `${side === "before" ? box.top - 3 : box.bottom + 1}px`;
    };

    const dropped = (): void => {
        removeEventListener("mousemove", moved);
        removeEventListener("mouseup", dropped);
        line.remove();
        document.body.removeAttribute("data-ainsi-dragging");
        handle.removeAttribute("data-ainsi-carried");
        if (!dragging || !over) return;
        const held = targetOf(handle);
        const onto = targetOf(over);
        if (held && onto && strands(doc.source, held, onto, side)) {
            return void hint("that would move the page's layout; drop it lower, or move the page", true);
        }
        const splicing = held && onto && moveTo(doc.source, held, onto, side);
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

/*
 * What is drawing this block, and what it says it wants of its content. A component's `about`
 * already carries the convention its render depends on, so an editor showing it is one home
 * for the fact rather than a second copy of it: `boxes` says a leading bold run is the card
 * title, and a person who does not know that gets a card with no title and no reason why.
 */
function expects(target: HTMLElement): HTMLElement | undefined {
    const id = target.dataset.ainsiEntity ?? target.dataset.ainsiSpan?.split(" ")[0];
    const entity = doc.entities.find(e => e.id === id);
    const block = doc.blocks.find(b => entity && b.ids.includes(entity.id));
    const component = block && doc.components.find(c => c.name === block.component);
    if (!component) return undefined;
    return h("div", { class: "ainsi-studio__expects" },
        h("b", {}, component.name),
        h("span", {}, component.about));
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
    await veil();
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
 * The deck's settings are its frontmatter, and the frontmatter is YAML nobody should have to
 * remember: a panel of fields, the same dark panel a table and a list open in, one row per key
 * the parser knows about. The file is edited a line at a time rather than rewritten, so a
 * comment, a key this build has never heard of and the order they were written in all survive
 * an edit here. The whole file, as text, is still one ⇧⌘E away.
 */
function openDeck(): void {
    const matter = MATTER.exec(doc.source);
    const lines = (matter?.[1] ?? "").split("\n").filter(one => one.trim() !== "");
    const values = new Map(SETTINGS.map(setting => [setting.key, matterValue(lines, setting.key, setting.fallback)]));

    const panel = h("form", { class: "ainsi-studio__table ainsi-studio__deck" });
    const rows = h("div", { class: "ainsi-studio__deckrows" });
    let themes: string[] = [values.get("theme")!];

    const draw = (): void => {
        rows.replaceChildren(...SETTINGS.map(setting => {
            const value = values.get(setting.key)!;
            const set = (next: string) => { values.set(setting.key, next); draw(); };
            const row = h("div", { class: "ainsi-studio__deckrow" },
                h("span", { class: "ainsi-studio__deckname" }, setting.name));

            if (setting.kind === "switch") {
                row.append(...setting.options.map(option =>
                    h("button", { class: "ainsi-studio__chip", type: "button", "data-active": option === value, click: () => set(option) }, option)));
            } else if (setting.kind === "choice") {
                const options = setting.key === "theme" ? themes
                    : setting.key === "layout" ? doc.layouts.map(one => one.name)
                    : RATIOS.includes(value) ? RATIOS : [...RATIOS, value];
                row.append(dropdown(value, options.map(option => item(option, "", option === value, () => set(option)))));
            } else {
                const input = h("input", { class: "ainsi-studio__input", value, spellcheck: "false", autocomplete: "off",
                    placeholder: "https://…  or  assets/mark.svg, beside the deck" }) as HTMLInputElement;
                input.addEventListener("input", () => values.set(setting.key, input.value.trim()));
                row.append(input);
            }
            return row;
        }));
    };

    draw();
    panel.append(
        h("div", { class: "ainsi-studio__barlabel" }, "deck"),
        rows,
        h("div", { class: "ainsi-studio__itemfoot" },
            h("span", { class: "ainsi-studio__decknote" }, lines.some(isOther) ? "other frontmatter lines are kept as they are" : ""),
            h("button", { class: "ainsi-studio__imageok", type: "submit" }, "OK")));

    document.body.append(panel);

    // the themes, once the panel is up: the dropdown is not worth waiting on to show the rest
    void (async () => {
        const known = await (await fetch("/__themes")).json() as { themes: string[]; current: string };
        themes = known.themes.includes(values.get("theme")!) ? known.themes : [...known.themes, values.get("theme")!];
        draw();
    })().catch(() => undefined);

    let done = false;
    let stop: (() => void) | undefined;
    const editor: Chrome = { kind: "block", holds: true, close() { done = true; stop?.(); panel.remove(); } };
    show(editor);

    const commit = async (): Promise<void> => {
        if (done) return;
        done = true;
        const written = writeMatter(lines, values);
        const end = matter ? matter[0].length : 0;
        const text = written ? `---\n${written}\n---\n\n` : "";
        if (text === (matter?.[0] ?? "")) { if (chrome === editor) shut(); return; }
        hint("saving…");
        editor.holds = false;
        await splice({ start: 0, end, text });
    };

    stop = dismissOnOutside(panel, () => void commit());
    panel.addEventListener("submit", event => { event.preventDefault(); void commit(); });
    panel.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); if (chrome === editor) shut(); }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void commit(); }
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
    // the markdown decides, not the kind: a component that builds its own markup is addressed
    // as a block rather than as a table, and comparison, bar-table and roadmap all do
    if (openTable(target, range)) return;
    if (openList(target, range)) return;
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

/*
 * A table as a grid rather than as pipes.
 *
 * What is drawn on the page varies: bar-table draws bars, comparison draws columns. The source
 * is a plain markdown table every time, so this edits that and serves all of them, and nothing
 * here knows which component is rendering it.
 */
function openTable(target: HTMLElement, range: Range): boolean {
    const grid = toGrid(range.md);
    if (!grid) return false;

    const panel = h("form", { class: "ainsi-studio__table" });
    const table = h("table", { class: "ainsi-studio__grid" });
    let focus: HTMLInputElement | undefined;
    let drawn = false;

    const draw = (): void => {
        table.replaceChildren();
        const columns = grid.align.length;

        // the alignment row: what each column does, above the column it does it to
        const heading = h("tr");
        heading.append(h("th", { class: "ainsi-studio__gridcorner" }));
        grid.align.forEach((current, i) => {
            const cell = h("th", { class: "ainsi-studio__gridhead" });
            for (const [name, icon] of [["left", "alignLeft"], ["center", "alignCenter"], ["right", "alignRight"]] as const) {
                cell.append(iconButton(icon, name, current === name, () => { grid.align[i] = name; draw(); }));
            }
            cell.append(iconButton("trash", "Remove column", false, () => {
                if (columns < 2) return;
                grid.align.splice(i, 1);
                grid.head.splice(i, 1);
                for (const row of grid.rows) row.splice(i, 1);
                draw();
            }));
            heading.append(cell);
        });
        heading.append(h("th", { class: "ainsi-studio__gridadd" }, iconButton("plus", "Add column", false, () => {
            grid.align.push("left");
            grid.head.push("");
            for (const row of grid.rows) row.push("");
            draw();
        })));
        table.append(heading);

        const line = (row: string[], head: boolean, index: number): void => {
            const tr = h("tr", head ? { class: "ainsi-studio__gridtitle" } : {});
            tr.append(h("td", { class: "ainsi-studio__gridcorner" }, head ? "" : String(index + 1)));
            row.forEach((value, i) => {
                const input = h("input", { class: "ainsi-studio__input", value, spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;
                fitToText(input, 10);
                input.addEventListener("input", () => { row[i] = input.value; });
                tr.append(h("td", {}, input));
                if (!focus) focus = input;
            });
            tr.append(h("td", { class: "ainsi-studio__gridadd" }, head ? "" : iconButton("trash", "Remove row", false, () => {
                grid.rows.splice(index, 1);
                draw();
            })));
            table.append(tr);
        };
        line(grid.head, true, -1);
        grid.rows.forEach((row, i) => line(row, false, i));

        /*
         * Adding or removing a column replaces every cell, so whatever had the caret is gone and
         * focus falls to the body, where the commit chord cannot reach this panel. It comes back
         * to the grid. Typing never redraws, so this never interrupts anyone mid-word.
         */
        if (drawn && !panel.contains(document.activeElement)) {
            queueMicrotask(() => (table.querySelector("input") as HTMLInputElement | null)?.focus());
        }
        drawn = true;

        const foot = h("tr");
        foot.append(h("td", { class: "ainsi-studio__gridcorner" }), h("td", { colspan: String(columns + 1) },
            iconButton("plus", "Add row", false, () => { grid.rows.push(grid.align.map(() => "")); draw(); })));
        table.append(foot);
    };

    draw();
    const says = expects(target);
    if (says) panel.append(says);
    panel.append(table, h("button", { class: "ainsi-studio__imageok", type: "submit" }, "OK"));

    const rect = target.getBoundingClientRect();
    panel.style.left = `${Math.max(8, rect.left)}px`;
    panel.style.top = `${Math.max(8, rect.top)}px`;
    document.body.append(panel);
    placePanel(panel, rect);
    target.classList.add("ainsi-studio--dim");

    let done = false;
    let stop: (() => void) | undefined;
    const editor: Chrome = {
        kind: "block",
        holds: true,
        close() { done = true; stop?.(); panel.remove(); target.classList.remove("ainsi-studio--dim"); },
    };
    show(editor);
    focus?.focus();
    focus?.select();

    const commit = async (): Promise<void> => {
        if (done) return;
        done = true;
        const text = toMarkdown(grid);
        if (text === range.md) { if (chrome === editor) shut(); return; }
        hint("saving…");
        editor.holds = false;
        await splice({ start: range.start, end: range.end, text });
    };

    stop = dismissOnOutside(panel, () => void commit());
    panel.addEventListener("submit", event => { event.preventDefault(); void commit(); });
    panel.addEventListener("keydown", event => {
        event.stopPropagation();                        // the viewer's own keys stay out of the cells
        if (event.key === "Escape") { event.preventDefault(); if (chrome === editor) shut(); }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void commit(); }
    });
    return true;
}

/*
 * A list as its items. Same bargain as the table above: timeline draws a spine and boxes draws
 * panels, and both are a list of items in the source, so this edits that and serves all of
 * them. What it cannot round-trip it refuses, and the raw editor takes over.
 */
function openList(target: HTMLElement, range: Range): boolean {
    const list = toItems(range.md);
    if (!list) return false;

    const panel = h("form", { class: "ainsi-studio__table ainsi-studio__list" });
    const rows = h("div", { class: "ainsi-studio__items" });
    let focus: HTMLInputElement | undefined;
    let drawn = false;

    const draw = (): void => {
        rows.replaceChildren();
        list.items.forEach((item, i) => {
            const row = h("div", { class: "ainsi-studio__item" });
            row.style.paddingLeft = `${item.depth * 1.4}rem`;

            const input = h("input", { class: "ainsi-studio__input", value: item.text, spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;
            fitToText(input);
            input.addEventListener("input", () => { item.text = input.value; });
            // the deepest an item may go is one past the item above it, so a list cannot skip a level
            const ceiling = i === 0 ? 0 : (list.items[i - 1]!.depth ?? 0) + 1;
            const shift = (by: number) => () => {
                item.depth = Math.max(0, Math.min(ceiling, item.depth + by));
                draw();
            };
            row.append(
                iconButton("panelLeft", "Outdent", false, shift(-1)),
                iconButton("panelRight", "Indent", false, shift(1)),
                input,
                iconButton("up", "Move up", false, () => { if (i > 0) { swapItems(list, i, i - 1); draw(); } }),
                iconButton("down", "Move down", false, () => { if (i < list.items.length - 1) { swapItems(list, i, i + 1); draw(); } }),
                iconButton("trash", "Remove item", false, () => { list.items.splice(i, 1); draw(); }),
            );
            rows.append(row);
            if (!focus) focus = input;
        });

        if (drawn && !panel.contains(document.activeElement)) {
            queueMicrotask(() => (rows.querySelector("input") as HTMLInputElement | null)?.focus());
        }
        drawn = true;
    };

    const marker = h("div", { class: "ainsi-studio__itemhead" });
    const toggle = (): void => {
        marker.replaceChildren(
            iconButton("list", "Bullets", !list.ordered, () => { list.ordered = false; toggle(); }),
            iconButton("ordered", "Numbered", list.ordered, () => { list.ordered = true; toggle(); }),
        );
    };
    toggle();

    draw();
    const says = expects(target);
    if (says) panel.append(says);
    panel.append(marker, rows,
        h("div", { class: "ainsi-studio__itemfoot" },
            iconButton("plus", "Add item", false, () => {
                list.items.push({ depth: list.items.at(-1)?.depth ?? 0, text: "" });
                draw();
            }),
            h("button", { class: "ainsi-studio__imageok", type: "submit" }, "OK")));

    const rect = target.getBoundingClientRect();
    panel.style.left = `${Math.max(8, rect.left)}px`;
    panel.style.top = `${Math.max(8, rect.top)}px`;
    document.body.append(panel);
    placePanel(panel, rect);
    target.classList.add("ainsi-studio--dim");

    let done = false;
    let stop: (() => void) | undefined;
    const editor: Chrome = {
        kind: "block",
        holds: true,
        close() { done = true; stop?.(); panel.remove(); target.classList.remove("ainsi-studio--dim"); },
    };
    show(editor);
    focus?.focus();
    focus?.select();

    const commit = async (): Promise<void> => {
        if (done) return;
        done = true;
        const text = toList(list);
        if (text === range.md) { if (chrome === editor) shut(); return; }
        hint("saving…");
        editor.holds = false;
        await splice({ start: range.start, end: range.end, text });
    };

    stop = dismissOnOutside(panel, () => void commit());
    panel.addEventListener("submit", event => { event.preventDefault(); void commit(); });
    panel.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); if (chrome === editor) shut(); }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void commit(); }
    });
    return true;
}

/** two items and the run beneath the one that moves, so a parent takes its children with it */
function swapItems(list: { items: { depth: number; text: string }[] }, a: number, b: number): void {
    const [item] = list.items.splice(a, 1);
    list.items.splice(b, 0, item!);
}

/*
 * A panel put where its block is, then pulled back inside the window. Measured after it is in
 * the document rather than guessed from a constant: these panels size to what they hold, so
 * the number a guess would use is the one thing not known before the append.
 */
function placePanel(panel: HTMLElement, at: DOMRect): void {
    const box = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(at.left, innerWidth - box.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(at.top, innerHeight - box.height - 8))}px`;
}

/*
 * An input carries no intrinsic width from what is in it: it sizes to the `size` attribute,
 * twenty characters by default, so a panel that sizes to its content truncates every value
 * longer than that however much room the window has. A min-width in ch does contribute to
 * intrinsic sizing, so the panel ends up as wide as the longest thing it holds, up to the cap
 * the stylesheet puts on it. Set once, when the row is drawn: refitting on every keystroke
 * would resize the panel under the caret.
 */
function fitToText(input: HTMLInputElement, floor = 12): void {
    // the four spare characters are the field's own padding and a caret's worth of room
    input.style.minWidth = `${Math.max(floor, Math.min(120, input.value.length + 4))}ch`;
}

/*
 * A pointer landing outside a structured editor commits it, which is what blur already does for
 * the textarea editor. Without it the panel registers as chrome of kind "block", the document's
 * own click handler returns on that kind before it can dismiss anything, and the panel stays
 * open and holding every later click. Capture phase, so it runs before the panel's own controls.
 */
function dismissOnOutside(panel: HTMLElement, commit: () => void): () => void {
    const outside = (event: PointerEvent): void => {
        if (panel.contains(event.target as Node)) return;
        commit();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
}

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
    panel.style.left = `${Math.max(8, rect.left)}px`;
    panel.style.top = `${Math.max(8, rect.top)}px`;
    panel.style.width = `${Math.min(Math.max(rect.width, 320), 560)}px`;
    document.body.append(panel);
    placePanel(panel, rect);
    target.classList.add("ainsi-studio--dim");

    let done = false;
    let stop: (() => void) | undefined;
    const editor: Chrome = {
        kind: "block",
        holds: true,
        close() {
            done = true;
            stop?.();
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

    stop = dismissOnOutside(panel, () => commit());
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

/*
 * A block and its neighbour swapped, refused when either opens with a layout directive: that
 * directive owns the page it sits on, and a swap would carry the page's boundary into the
 * middle of it. Same guard the drag takes, because both write through the same spans.
 */
function stepBlock(target: Target, neighbour: Target): void {
    if (strands(doc.source, target, neighbour, "before") || strands(doc.source, neighbour, target, "before")) {
        return hint("that block opens the page's layout; move the page instead", true);
    }
    splice(move(doc.source, target, neighbour));
}

function openInsertMenu(target: HTMLElement, at: number, from: DOMRect): void {
    menu = document.createElement("div");
    // its own modifier because every button here wears a word: the block toolbar's square box
    // is for glyphs, and a label clamped to it overlaps its neighbour
    menu.className = "ainsi-studio__bar ainsi-studio__bar--insert";
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
                { key: "Shift-Mod-e", run: () => (widenRaw(), true) },
            ]),
        ],
    });

    // a page's own source is a sheet over the deck; the whole file still takes the window
    const sheet = page !== undefined;
    const save = barButton("Save", sheet ? `${MOD}S` : `${MOD}⏎`, () => commitRaw(), true);
    save.setAttribute("data-primary", "");
    const bar = h("div", { class: "ainsi-studio__rawbar" },
        h("span", { class: "ainsi-studio__rawname" }, page ? `${doc.file} · page ${index! + 1}` : doc.file),
        h("span", { class: "ainsi-studio__rawgap" }),
        barButton("Cancel", "esc", () => cancelRaw()),
        save);
    const panel = h("div", { class: sheet ? "ainsi-studio__sheet" : "ainsi-studio__sheetfull" }, bar, view.dom);
    if (sheet) {
        panel.append(h("div", { class: "ainsi-studio__rawfoot" },
            h("span", {}, "editing one page · the file keeps the rest"),
            h("div", { class: "ainsi-studio__rawfootkeys" },
                h("span", {}, `${MOD}S save`), h("span", {}, "esc cancel"), h("span", {}, `⇧${MOD}E whole file`))));
    }
    const container = h("div", { class: `ainsi-studio__raw${sheet ? " ainsi-studio__raw--sheet" : ""}` }, panel);

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

    /* the sheet's foot offers the whole file, and the global chord cannot serve it: that one
       bails while any chrome is open. Refused rather than discarded while there is typing to
       lose, since the wider editor would open on the same text read back from disk. */
    function widenRaw(): void {
        if (container.hasAttribute("data-committing")) return;
        if (view.state.doc.toString() !== initial) return hint("unsaved changes; save or cancel first");
        shut();
        void openRaw();
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
