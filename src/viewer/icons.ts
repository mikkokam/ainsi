/**
 * Lucide-style icons, inlined rather than pulled from the package: one icon is a few bytes
 * of path data and a dependency is the whole set. 24x24, 2px stroke, round caps and joins,
 * drawn to lucide's grid. Not copied from a pinned version, so they are lucide-shaped rather
 * than byte-identical to any release.
 */
const wrap = (body: string): string =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
    play: wrap(`<polygon points="6 3 20 12 6 21 6 3"/>`),
    x: wrap(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),
    menu: wrap(`<path d="M3 7h18"/><path d="M3 12h14"/><path d="M3 17h14"/>`),
    grid: wrap(`<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>`),
};

export type IconName = keyof typeof icons;
