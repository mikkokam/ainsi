import { icons, type IconName } from "./icons";

/* the chord modifier: the key everyone on the platform already holds for app shortcuts */
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? "⌘" : "Ctrl";
const ALT = mac ? "⌥" : "Alt";
const modKey = mac ? "Meta" : "Control";
const chord = (event: KeyboardEvent): boolean => (mac ? event.metaKey : event.ctrlKey);

const pages = [...document.querySelectorAll<HTMLElement>(".ainsi-page")];
if (pages.length) start();

function start(): void {
    let index = 0;
    let presenting = false;

    const toolbar = document.createElement("div");
    toolbar.className = "ainsi-toolbar";

    const menuButton = button("menu", "Menu", () => (panel ? closeMenu() : openMenu()));
    const gridButton = button("grid", `Grid (${MOD}G)`, () => (overview ? closeOverview() : openOverview()));
    const play = button("play", `Present (${MOD}⏎)`, () => (presenting ? stop() : begin()));
    const count = document.createElement("div");
    count.className = "ainsi-toolbar__count";

    toolbar.append(menuButton, gridButton, play, count);
    document.body.append(toolbar);

    /* the strip fades out of the way and comes back on movement, or on a tap where there is none */
    let idle: ReturnType<typeof setTimeout>;
    const awake = () => {
        toolbar.setAttribute("data-awake", "");
        clearTimeout(idle);
        idle = setTimeout(() => { if (!panel) toolbar.removeAttribute("data-awake"); }, 2600);
    };
    addEventListener("mousemove", awake, { passive: true });
    addEventListener("pointerdown", awake, { passive: true });
    awake();

    /*
     * A toggle says what pressing it does next, not what it did: an open grid offers reading.
     * The svg is replaced rather than the whole content, because the studio appends its own
     * word beside it in the desktop titlebar and that word follows the icon.
     */
    function retitle(element: HTMLButtonElement, name: IconName, label: string): void {
        element.title = label;
        element.setAttribute("aria-label", label);
        element.querySelector("svg")?.remove();
        element.insertAdjacentHTML("afterbegin", icons[name]);
        const word = element.querySelector(".ainsi-toolbar__label");
        if (word) word.textContent = label.split(" (")[0] ?? label;
    }

    function button(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
        const element = document.createElement("button");
        element.className = "ainsi-toolbar__button";
        element.type = "button";
        element.title = label;
        element.setAttribute("aria-label", label);
        element.innerHTML = icons[name];
        element.addEventListener("click", event => { event.stopPropagation(); onClick(); });
        return element;
    }

    /*
     * The menu is rebuilt on every open, so the slide list is always the current render.
     * After the built-in sections it announces itself on the document; the studio, when
     * present, prepends its own sections. The player ships no editor code.
     */
    let panel: HTMLDivElement | undefined;

    function openMenu(): void {
        panel = document.createElement("div");
        panel.className = "ainsi-menu";
        panel.addEventListener("click", event => event.stopPropagation());

        const brand = document.createElement("div");
        brand.className = "ainsi-menu__brand";
        brand.textContent = document.body.hasAttribute("data-ainsi-studio") ? "Ainsi Studio" : "Ainsi Player";
        panel.append(brand);

        // the studio, when present, fills this with its own actions
        const slot = document.createElement("div");
        panel.append(slot);

        head("Slides");
        const current = presenting ? index : nearest();
        pages.forEach((page, i) => {
            const row = item(`${i + 1}  ${titleOf(page, i)}`, () => { closeMenu(); go(i, true); });
            if (i === current) row.setAttribute("data-active", "");
        });

        toolbar.append(panel);
        document.dispatchEvent(new CustomEvent("ainsi:menu", { detail: { panel, slot, close: closeMenu } }));
        addEventListener("pointerdown", outside, true);
    }

    function closeMenu(): void {
        panel?.remove();
        panel = undefined;
        removeEventListener("pointerdown", outside, true);
    }

    function outside(event: Event): void {
        const target = event.target as Node;
        if (panel && !panel.contains(target) && !menuButton.contains(target)) closeMenu();
    }

    function head(text: string): void {
        const element = document.createElement("div");
        element.className = "ainsi-menu__head";
        element.textContent = text;
        panel!.append(element);
    }

    function item(text: string, onClick: () => void): HTMLButtonElement {
        const element = document.createElement("button");
        element.className = "ainsi-menu__item";
        element.type = "button";
        element.textContent = text;
        element.addEventListener("click", onClick);
        panel!.append(element);
        return element;
    }

    function titleOf(page: HTMLElement, i: number): string {
        return page.querySelector("h1, h2, h3")?.textContent?.trim() || `Page ${i + 1}`;
    }

    /*
     * The overview: every page cloned into a grid, click to go. Clones keep the 1280px
     * design width and are scaled to their cell, the same trick presentation mode uses,
     * so a thumbnail is the page itself rather than a stale capture.
     */
    let overview: HTMLDivElement | undefined;
    let cursor = 0;

    function openOverview(): void {
        closeMenu();
        // the button names what pressing it does, so it never wears the active state: "Reading"
        // lit up says you are reading, which is the one thing you are not
        retitle(gridButton, "reading", `Reading (${MOD}G)`);
        overview = document.createElement("div");
        overview.className = "ainsi-overview";
        cursor = presenting ? index : nearest();
        pages.forEach((page, i) => {
            const cell = document.createElement("button");
            cell.className = "ainsi-overview__cell";
            cell.type = "button";
            const frame = document.createElement("div");
            frame.className = "ainsi-overview__frame";
            const clone = page.cloneNode(true) as HTMLElement;
            clone.removeAttribute("id");    // the original keeps the address
            clone.removeAttribute("data-current");
            frame.append(clone);
            const label = document.createElement("div");
            label.className = "ainsi-overview__label";
            label.textContent = `${i + 1}  ${titleOf(page, i)}`;
            cell.append(frame, label);
            cell.addEventListener("click", event => { event.stopPropagation(); closeOverview(); go(i, true); });
            overview!.append(cell);
        });
        document.body.append(overview);
        fitThumbs();
        focusCell(cursor, "center");
    }

    const cells = () => [...overview!.querySelectorAll<HTMLElement>(".ainsi-overview__cell")];

    /** the cursor is the focused cell, so Enter and Space are the button's own activation */
    function focusCell(to: number, block: ScrollLogicalPosition = "nearest"): void {
        const all = cells();
        cursor = Math.max(0, Math.min(all.length - 1, to));
        all.forEach((cell, i) => cell.toggleAttribute("data-active", i === cursor));
        all[cursor]?.focus({ preventScroll: true });
        all[cursor]?.scrollIntoView({ block });
    }

    function overviewKey(event: KeyboardEvent): void {
        const all = cells();
        const top = all[0]?.offsetTop;
        const columns = Math.max(1, all.filter(cell => cell.offsetTop === top).length);
        let to = cursor;
        switch (event.key) {
            case "ArrowRight": to += 1; break;
            case "ArrowLeft": to -= 1; break;
            case "ArrowDown": to += columns; break;
            case "ArrowUp": to -= columns; break;
            case "Home": to = 0; break;
            case "End": to = all.length - 1; break;
            case "Enter": case " ": event.preventDefault(); closeOverview(); return go(cursor, true);
            default: return;
        }
        event.preventDefault();
        focusCell(to);
    }

    function fitThumbs(): void {
        if (!overview) return;
        for (const frame of overview.querySelectorAll<HTMLElement>(".ainsi-overview__frame")) {
            frame.style.setProperty("--ainsi-thumb-scale", String(frame.clientWidth / 1280));
        }
    }

    function closeOverview(): void {
        overview?.remove();
        overview = undefined;
        retitle(gridButton, "grid", `Grid (${MOD}G)`);
    }

    /*
     * A picture opens. Clicking one lifts it over the deck at the page's own radius and a
     * click anywhere puts it back, which is the first thing anyone tries on a deck of
     * photographs. The header's ground is excluded: there the picture is the page, and
     * opening it would leave a cover with nowhere left to click to move on.
     */
    let lightbox: HTMLDivElement | undefined;

    function openLightbox(source: HTMLImageElement): void {
        closeMenu();
        lightbox = document.createElement("div");
        lightbox.className = "ainsi-lightbox";
        const picture = document.createElement("img");
        picture.src = source.currentSrc || source.src;
        picture.alt = source.alt;
        lightbox.append(picture);
        document.body.append(lightbox);
    }

    function closeLightbox(): void {
        lightbox?.remove();
        lightbox = undefined;
    }

    /* capture, so the click never reaches the page turn behind it */
    addEventListener("click", event => {
        if (lightbox) { event.preventDefault(); event.stopPropagation(); return closeLightbox(); }
        // in the studio a click on a picture is an edit; presenting is the player again
        if (document.body.hasAttribute("data-ainsi-studio") && !presenting) return;
        const target = event.target as HTMLElement;
        if (target.closest?.(".ainsi-overview")) return;      // a thumbnail is a slide, not a picture
        const image = target.closest?.<HTMLImageElement>(".ainsi-page img");
        if (!image || image.closest('[data-layout="header"] .ainsi-full')) return;
        event.preventDefault();
        event.stopPropagation();
        openLightbox(image);
    }, true);

    function label(): void {
        count.textContent = presenting ? `${index + 1}/${pages.length}` : "";
    }

    function begin(): void {
        presenting = true;
        index = nearest();
        document.body.setAttribute("data-present", "");
        document.body.setAttribute("data-turn", "forward");
        play.innerHTML = icons.x;
        play.title = play.ariaLabel = "Leave presentation";
        document.documentElement.requestFullscreen?.().catch(() => {});
        scale();
        show();
    }

    function stop(): void {
        presenting = false;
        document.body.removeAttribute("data-present");
        document.body.removeAttribute("data-turn");
        play.innerHTML = icons.play;
        play.title = play.ariaLabel = `Present (${MOD}⏎)`;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        for (const page of pages) page.removeAttribute("data-current");
        pages[index]?.scrollIntoView({ block: "start" });
        label();
    }

    /** the page nearest the top of the viewport, so play resumes where you were reading */
    function nearest(): number {
        let best = 0;
        let distance = Infinity;
        pages.forEach((page, i) => {
            const offset = Math.abs(page.getBoundingClientRect().top);
            if (offset < distance) { distance = offset; best = i; }
        });
        return best;
    }

    function show(): void {
        for (const page of pages) page.removeAttribute("data-current");
        pages[index]?.setAttribute("data-current", "");
        label();
    }

    /* which way the deck is going, for a theme that turns the page rather than swapping it:
       CSS sees only which page is current, never where the last one was */
    function go(to: number, jump = false): void {
        const clamped = Math.max(0, Math.min(pages.length - 1, to));
        if (clamped === index && !jump) return;
        document.body.setAttribute("data-turn", clamped < index ? "back" : "forward");
        index = clamped;
        if (presenting) show();
        else pages[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    /*
     * The page keeps its design width and is scaled to the viewport rather than reflowed,
     * so what is presented is what was measured.
     */
    function scale(): void {
        if (!presenting || innerWidth <= 900) return;   // the reading form fills the screen instead
        document.body.style.setProperty("--ainsi-present-scale", String(Math.min(innerWidth / 1280, innerHeight / designHeight())));
    }

    /** what a page is tall at its design width, which is the only size anything is measured at */
    function designHeight(): number {
        const [w, h] = (getComputedStyle(document.body).getPropertyValue("--ainsi-ratio") || "16 / 9")
            .split("/").map(part => Number(part.trim()) || 1);
        return 1280 / (w! / h!);
    }

    /*
     * Reading. The page keeps its design width here too, and the window decides the zoom, so one
     * design is read at every screen size and what the fit solver measured is what is shown.
     * Reflowing instead, which is what a percentage width does, leaves the type at its authored
     * size inside a narrower page and quietly oversizes a deck that was measured to fit.
     *
     * Fitted to a fraction of the height rather than all of it, and the fraction is low enough
     * that a neighbour reads as a page rather than as an edge. That is the argument the reading
     * view is making: a deck is a continuous story, and a page that fills the window teaches the
     * opposite. Roughly a quarter of the window goes to the two neighbours and the gaps between.
     */
    const READ_FILL = 0.75;
    function fitReading(): void {
        if (innerWidth <= 900) return void document.body.removeAttribute("data-ainsi-read");
        // the page under the reader stays under the reader: a zoom change moves every offset
        const anchor = presenting ? undefined : pages[nearest()];
        const was = anchor?.getBoundingClientRect().top ?? 0;

        const style = getComputedStyle(document.body);
        const gutters = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const zoom = Math.min((innerWidth - gutters) / 1280, (innerHeight * READ_FILL) / designHeight());
        document.body.style.setProperty("--ainsi-read-zoom", String(zoom));
        document.body.setAttribute("data-ainsi-read", "");

        if (anchor) scrollBy(0, anchor.getBoundingClientRect().top - was);
    }

    addEventListener("resize", scale, { passive: true });
    addEventListener("resize", fitReading, { passive: true });
    addEventListener("resize", fitThumbs, { passive: true });
    addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && presenting) stop(); });

    /*
     * The same door the studio has, for what belongs to the player. A native menu cannot reach
     * presenting or the grid through the studio: a built deck presents with no server anywhere
     * near it, and it carries this script and not that one.
     */
    document.addEventListener("ainsi:command", event => {
        switch ((event as CustomEvent).detail as string) {
            case "present": if (!presenting) begin(); break;
            case "present-from-start": if (!presenting) begin(); go(0, true); break;
            case "grid": if (overview) closeOverview(); else openOverview(); break;
            case "reading": if (overview) closeOverview(); if (presenting) stop(); break;
        }
    });

    /*
     * The shortcut list: a translucent card bottom-left, shown while the chord modifier is
     * down (the iPad convention). Built per mode on each show;
     * the studio, when present, adds its own rows over the same event the menu uses.
     */
    let keys: HTMLDivElement | undefined;

    type Row = [key: string, label: string];

    function shortcuts(): { mode: string; rows: Row[] } {
        const studio = document.body.hasAttribute("data-ainsi-studio");
        if ((document.activeElement as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) return { mode: "Editing", rows: [] };
        if (lightbox) return { mode: "Picture", rows: [["esc", "close"]] };
        if (overview) return { mode: "Grid", rows: [["← → ↑ ↓", "move"], ["⏎", "open slide"], ["esc", "close"]] };
        if (presenting) return { mode: "Presenting", rows: [["← →", "previous / next"], [`${MOD} ← →`, "first / last"], [`${MOD} G`, "grid"], ["esc", "leave"]] };
        return { mode: studio ? "Studio" : "Player", rows: [[`${MOD} ⏎`, "present from this slide"], [`${MOD} G`, "grid"]] };
    }

    function openKeys(): void {
        for (const fading of document.querySelectorAll(".ainsi-keys")) fading.remove();
        const { mode, rows } = shortcuts();
        document.dispatchEvent(new CustomEvent("ainsi:keys", { detail: { mode, rows, mod: MOD, alt: ALT } }));
        keys = document.createElement("div");
        keys.className = "ainsi-keys";
        const head = document.createElement("div");
        head.className = "ainsi-keys__head";
        head.textContent = mode;
        keys.append(head);
        for (const [key, text] of rows) {
            const kbd = document.createElement("kbd");
            kbd.textContent = key;
            const label = document.createElement("span");
            label.textContent = text;
            keys.append(kbd, label);
        }
        document.body.append(keys);
    }

    /** in is instant, out is a fade; the fading card is nobody's, so a reopen just replaces it */
    function closeKeys(): void {
        const card = keys;
        keys = undefined;
        if (!card) return;
        card.setAttribute("data-out", "");
        setTimeout(() => card.remove(), 400);
    }

    const release = () => { if (keys) closeKeys(); };
    addEventListener("keyup", event => { if (event.key === modKey) release(); });
    addEventListener("blur", release);

    addEventListener("keydown", event => {
        if (event.key === modKey) { if (!keys) openKeys(); return; }
        release();     // any other key while the modifier is down is a chord, not a request for the list
        if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
        if (event.key === "Escape") {
            if (lightbox) return closeLightbox();
            if (panel) return closeMenu();
            if (overview) return closeOverview();
            if (presenting) return stop();
            return;
        }
        if (lightbox) return;       // the deck is behind a picture; nothing moves until it is put back
        if (chord(event) && event.key.toLowerCase() === "g") { event.preventDefault(); return overview ? closeOverview() : openOverview(); }
        if (chord(event) && event.key === "Enter") { event.preventDefault(); return presenting ? stop() : begin(); }
        if (overview) return overviewKey(event);
        if (!presenting) return;
        switch (event.key) {
            case "ArrowRight": case "ArrowDown": case " ": case "PageDown": event.preventDefault(); return go(chord(event) ? pages.length - 1 : index + 1);
            case "ArrowLeft": case "ArrowUp": case "PageUp": event.preventDefault(); return go(chord(event) ? 0 : index - 1);
            case "Home": return go(0);
            case "End": return go(pages.length - 1);
        }
    });

    /* while presenting a #link is a page turn; the reading form keeps the native anchor */
    addEventListener("click", event => {
        if (!presenting) return;
        const anchor = (event.target as HTMLElement).closest?.<HTMLAnchorElement>('a[href^="#"]');
        if (!anchor) return;
        const target = document.getElementById(decodeURIComponent(anchor.hash.slice(1)))?.closest<HTMLElement>(".ainsi-page");
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        go(pages.indexOf(target), true);
    }, true);

    /* a wide screen advances on click; a narrow one scrolls its page, so it swipes instead */
    addEventListener("click", event => {
        if ((event.target as HTMLElement).closest?.("a")) return;
        if (presenting && !panel && !overview && innerWidth > 900) go(index + 1);
    });

    fitReading();

    let touch: { x: number; y: number } | undefined;
    addEventListener("touchstart", event => {
        const point = event.changedTouches[0];
        touch = point ? { x: point.clientX, y: point.clientY } : undefined;
    }, { passive: true });
    addEventListener("touchend", event => {
        const point = event.changedTouches[0];
        if (!presenting || !touch || !point) return;
        const dx = point.clientX - touch.x;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(point.clientY - touch.y)) go(index + (dx < 0 ? 1 : -1));
        touch = undefined;
    }, { passive: true });
}
