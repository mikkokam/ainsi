import { icons, type IconName } from "./icons";

const pages = [...document.querySelectorAll<HTMLElement>(".pac-page")];
if (pages.length) start();

function start(): void {
    let index = 0;
    let presenting = false;

    const toolbar = document.createElement("div");
    toolbar.className = "pac-toolbar";

    const play = button("play", "Present", () => (presenting ? stop() : begin()));
    const previous = button("chevronLeft", "Previous page", () => go(index - 1));
    const next = button("chevronRight", "Next page", () => go(index + 1));
    const count = document.createElement("div");
    count.className = "pac-toolbar__count";

    toolbar.append(play, previous, next, count);
    document.body.append(toolbar);

    /* the strip fades out of the way and comes back on movement, or on a tap where there is none */
    let idle: ReturnType<typeof setTimeout>;
    const awake = () => {
        toolbar.setAttribute("data-awake", "");
        clearTimeout(idle);
        idle = setTimeout(() => toolbar.removeAttribute("data-awake"), 2600);
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

    function go(to: number): void {
        const clamped = Math.max(0, Math.min(pages.length - 1, to));
        if (clamped === index) return;
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
    addEventListener("click", () => { if (presenting && innerWidth > 900) go(index + 1); });

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
