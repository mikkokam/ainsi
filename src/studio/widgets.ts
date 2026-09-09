/*
 * The studio's widget primitives: DOM builders with no studio state. Anything that knows
 * the document, the chrome, or the server lives in script.ts and passes callbacks in.
 */

import { icons, type IconName } from "./icons";

/** hyperscript: element, attributes (true = bare attribute, function = listener), children */
export function h(tag: string, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElement {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (typeof value === "function") element.addEventListener(key, value as EventListener);
        else if (value === true) element.setAttribute(key, "");
        else if (value !== false && value !== undefined) element.setAttribute(key, String(value));
    }
    element.append(...children);
    return element;
}

export function label(text: string): HTMLElement {
    const element = document.createElement("span");
    element.className = "ainsi-studio__barlabel";
    element.textContent = text;
    return element;
}

export function divider(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ainsi-studio__bardivider";
    return element;
}

export function iconButton(icon: IconName, title: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.className = "ainsi-studio__barbutton";
    element.type = "button";
    element.title = title;
    element.setAttribute("aria-label", title);
    element.innerHTML = icons[icon];
    if (active) element.setAttribute("data-active", "");
    element.addEventListener("click", onClick);
    return element;
}

/** a button that opens its list beneath it; one open at a time across the page's one bar */
export function dropdown(text: string, items: HTMLElement[]): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "ainsi-studio__drop";
    const button = document.createElement("button");
    button.className = "ainsi-studio__barbutton ainsi-studio__barbutton--drop";
    button.type = "button";
    button.innerHTML = `<span>${text}</span>${icons.chevron}`;
    const list = document.createElement("div");
    list.className = "ainsi-studio__droplist";
    list.hidden = true;
    list.append(...items);
    button.addEventListener("click", () => {
        const opening = list.hidden;
        for (const other of document.querySelectorAll<HTMLElement>(".ainsi-studio__droplist")) other.hidden = true;
        list.hidden = !opening;
    });
    wrap.append(button, list);
    return wrap;
}

export function item(text: string, hint: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.className = "ainsi-studio__dropitem";
    element.type = "button";
    const about = hint.length > 8;   // a syntax cue like `##` sits beside the name; a sentence goes beneath it
    element.innerHTML = `<span>${text}</span><span class="ainsi-studio__drophint${about ? " ainsi-studio__drophint--about" : ""}">${hint}</span>`;
    if (active) element.setAttribute("data-active", "");
    element.addEventListener("click", onClick);
    return element;
}

/** an option as an icon where one exists, sizes as a letter on the scale, the word as its title */
const GLYPH: Record<string, Record<string, IconName>> = {
    align: { left: "alignLeft", center: "alignCenter", right: "alignRight", start: "alignTop", end: "alignBottom" },
    axis: { horizontal: "horizontal", vertical: "vertical" },
    stretch: { stretch: "stretch" },
    side: { left: "panelLeft", right: "panelRight" },
};
/* an option shown as a short text glyph: the letters themselves say it */
const LETTERS: Record<string, string> = { caps: "AB" };
const SIZES: Record<string, string> = { small: ".7em", normal: ".85em", large: "1.05em", huge: "1.3em" };
/* a colour chip is a swatch of the theme's own token, read from the page the studio sits in */
const SWATCH: Record<string, Record<string, string>> = {
    color: { ink: "--ainsi-ink", soft: "--ainsi-ink-soft", accent: "--ainsi-accent" },
    tone: { ground: "--ainsi-ground", accent: "--ainsi-accent", inverse: "--ainsi-ink", soft: "--ainsi-tint" },
};

function glyph(field: string, option: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const icon = GLYPH[field]?.[option];
    const swatch = SWATCH[field]?.[option];
    const letters = LETTERS[option];
    if (!icon && !SIZES[option] && !swatch && !letters) return chip(option, active, onClick);
    const element = h("button", { class: "ainsi-studio__chip ainsi-studio__chip--icon", type: "button", title: option, "aria-label": option, "data-active": active, click: onClick }) as HTMLButtonElement;
    if (icon) element.innerHTML = icons[icon];
    else if (swatch) element.append(h("span", { class: "ainsi-studio__swatch", style: `background:var(${swatch})` }));
    else if (letters) { element.classList.add("ainsi-studio__chip--text"); element.append(letters); }
    else element.append(h("span", { style: `font-size:${SIZES[option]};font-weight:600` }, "A"));
    return element;
}

function chip(text: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.className = "ainsi-studio__chip";
    element.type = "button";
    element.textContent = text;
    if (active) element.setAttribute("data-active", "");
    element.addEventListener("click", onClick);
    return element;
}

export interface Field { name: string; type: "enum" | "boolean" | "number" | "string"; options?: string[]; default?: unknown }

/** one option of the showing component: a chip per choice, a toggle, or a field */
export function control(field: Field, value: unknown, onChange: (value: unknown) => void, onDismiss: () => void): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "ainsi-studio__field";
    const name = document.createElement("span");
    name.className = "ainsi-studio__fieldname";
    name.textContent = field.name;
    wrap.append(name);
    if (field.type === "enum") {
        wrap.append(...(field.options ?? []).map(option => glyph(field.name, option, option === value, () => onChange(option))));
    } else if (field.type === "boolean") {
        wrap.append(glyph(field.name, field.name, value === true, () => onChange(!value)));
    } else {
        const input = document.createElement("input");
        input.className = "ainsi-studio__input";
        input.type = field.type === "number" ? "number" : "text";
        input.value = value === undefined ? "" : String(value);
        let last = value;
        const commit = (): void => {
            const typed = field.type === "number" ? Number(input.value) : input.value;
            if (input.value === "" || (field.type === "number" && Number.isNaN(typed))) return;
            if (typed === last) return;              // blur after Enter must not splice twice
            last = typed;
            onChange(typed);
        };
        // blur commits as well as Enter: a value typed and then clicked away from is a value
        // meant, and the bar is closed by the click that would otherwise throw it away
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") { commit(); input.blur(); }
            if (event.key === "Escape") { input.value = last === undefined ? "" : String(last); onDismiss(); }
            event.stopPropagation();
        });
        wrap.append(input);
    }
    return wrap;
}

export function menuItem(text: string, onClick: () => void): HTMLElement {
    return h("button", { class: "ainsi-menu__item", type: "button", click: onClick }, text);
}

/** a drill replaces the menu's panel with one section, in place */
export function drill(panel: HTMLElement, title: string, ...rows: HTMLElement[]): void {
    panel.replaceChildren(h("div", { class: "ainsi-menu__head" }, title), ...rows);
}

export const barButton = (text: string, key: string, onClick: () => void): HTMLElement =>
    h("button", { class: "ainsi-studio__rawbutton", type: "button", title: key, click: onClick }, text);

/** above the block's top-left corner, or below it when there is no room above */
export function place(bar: HTMLElement, at: DOMRect): void {
    const { width, height } = bar.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.left, innerWidth - width - 8));
    const above = at.top - height - 8;
    const below = Math.min(at.bottom + 8, innerHeight - height - 8);
    // above the target when there is room, below it when there is not, and below whatever is
    // fixed in the way when neither is clear: the room above a page is the window's corner,
    // which the viewer's toolbar is already sitting in
    let top = above >= 8 && !clash({ left, top: above, width, height }) ? above : below;
    const hit = clash({ left, top, width, height });
    if (hit) top = hit.bottom + GAP;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
}

/** the air left between something placed against the page and the chrome it had to clear */
export const GAP = 6;

/*
 * What is fixed to the window rather than laid out against the page: the viewer's toolbar, and
 * the filename field when it stands alone. A rect inside one of them is not free space, so
 * anything positioned against the page asks here and moves instead of stacking.
 */
export function clash(box: { left: number; top: number; width: number; height: number }): DOMRect | undefined {
    for (const fixed of document.querySelectorAll<HTMLElement>(".ainsi-toolbar, body > .ainsi-studio__file")) {
        const rect = fixed.getBoundingClientRect();
        if (!rect.width) continue;
        const clear = box.left >= rect.right || box.left + box.width <= rect.left
            || box.top >= rect.bottom || box.top + box.height <= rect.top;
        if (!clear) return rect;
    }
    return undefined;
}

export function mark(area: HTMLTextAreaElement, marker: string): void {
    const { selectionStart: a, selectionEnd: b, value } = area;
    area.setRangeText(`${marker}${value.slice(a, b)}${marker}`, a, b, "select");
    size(area);
}

export function size(area: HTMLTextAreaElement): void {
    area.style.height = "auto";
    // scrollHeight is content only; the offset/client difference restores the border
    area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
}

/** a hint stays until replaced; one given a lifetime fades out on its own after that many ms */
export function hint(text: string, alarm = false, lifetime?: number): void {
    document.querySelector(".ainsi-studio__hint")?.remove();
    const bar = h("div", { class: `ainsi-studio__hint${alarm ? " ainsi-studio__hint--alarm" : ""}` }, text);
    document.body.append(bar);
    if (lifetime === undefined) return;
    setTimeout(() => {
        if (!bar.isConnected) return;
        bar.setAttribute("data-fading", "");
        bar.addEventListener("transitionend", () => bar.remove(), { once: true });
    }, lifetime);
}
