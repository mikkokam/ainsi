import { icons, type IconName } from "./icons";

const pages = [...document.querySelectorAll<HTMLElement>(".pac-page")];
if (pages.length) start();

function start(): void {
    let index = 0;
    let presenting = false;

    const toolbar = document.createElement("div");
    toolbar.className = "pac-toolbar";

    const menuButton = button("menu", "Menu", () => (panel ? closeMenu() : openMenu()));
    const play = button("play", "Present", () => (presenting ? stop() : begin()));
    const count = document.createElement("div");
    count.className = "pac-toolbar__count";

    toolbar.append(menuButton, play, count);
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

    function button(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
        const element = document.createElement("button");
        element.className = "pac-toolbar__button";
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
        panel.className = "pac-menu";
        panel.addEventListener("click", event => event.stopPropagation());

        const brand = document.createElement("div");
        brand.className = "pac-menu__brand";
        brand.textContent = document.body.hasAttribute("data-pac-studio") ? "PAC Studio" : "PAC Player";
        panel.append(brand);

        item("Export…", undefined, "lands with --pdf");

        // the studio, when present, fills this with its own actions
        const slot = document.createElement("div");
        panel.append(slot);

        head("Slides");
        const current = presenting ? index : nearest();
        pages.forEach((page, i) => {
            const title = page.querySelector("h1, h2, h3")?.textContent?.trim() || `Page ${i + 1}`;
            const row = item(`${i + 1}  ${title}`, () => { closeMenu(); go(i, true); });
            if (i === current) row.setAttribute("data-active", "");
        });

        toolbar.append(panel);
        document.dispatchEvent(new CustomEvent("pac:menu", { detail: { panel, slot } }));
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
        element.className = "pac-menu__head";
        element.textContent = text;
        panel!.append(element);
    }

    function item(text: string, onClick?: () => void, why?: string): HTMLButtonElement {
        const element = document.createElement("button");
        element.className = "pac-menu__item";
        element.type = "button";
        element.textContent = text;
        if (onClick) element.addEventListener("click", onClick);
        else { element.disabled = true; if (why) element.title = why; }
        panel!.append(element);
        return element;
    }

    function label(): void {
        count.textContent = presenting ? `${index + 1}/${pages.length}` : "";
    }

    function begin(): void {
        presenting = true;
        index = nearest();
        document.body.setAttribute("data-present", "");
        play.innerHTML = icons.x;
        play.title = play.ariaLabel = "Leave presentation";
        document.documentElement.requestFullscreen?.().catch(() => {});
        scale();
        show();
    }

    function stop(): void {
        presenting = false;
        document.body.removeAttribute("data-present");
        play.innerHTML = icons.play;
        play.title = play.ariaLabel = "Present";
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

    function go(to: number, jump = false): void {
        const clamped = Math.max(0, Math.min(pages.length - 1, to));
        if (clamped === index && !jump) return;
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
        const [w, h] = (getComputedStyle(document.body).getPropertyValue("--pac-ratio") || "16 / 9")
            .split("/").map(part => Number(part.trim()) || 1);
        const height = 1280 / (w! / h!);
        document.body.style.setProperty("--pac-present-scale", String(Math.min(innerWidth / 1280, innerHeight / height)));
    }

    addEventListener("resize", scale, { passive: true });
    addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && presenting) stop(); });

    addEventListener("keydown", event => {
        if (event.key === "Escape" && panel) return closeMenu();
        if (event.key === "Escape" && presenting) return stop();
        if (!presenting && event.key !== "f") return;
        switch (event.key) {
            case "ArrowRight": case "ArrowDown": case " ": case "PageDown": event.preventDefault(); return go(index + 1);
            case "ArrowLeft": case "ArrowUp": case "PageUp": event.preventDefault(); return go(index - 1);
            case "Home": return go(0);
            case "End": return go(pages.length - 1);
            case "f": return presenting ? stop() : begin();
        }
    });

    /* a wide screen advances on click; a narrow one scrolls its page, so it swipes instead */
    addEventListener("click", () => { if (presenting && !panel && innerWidth > 900) go(index + 1); });

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
