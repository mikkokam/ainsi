/** lucide-shaped icons for the block toolbar, inlined for the same reason the viewer's are */
const wrap = (body: string): string =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
    text: wrap(`<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>`),
    list: wrap(`<path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>`),
    ordered: wrap(`<path d="M10 6h11"/><path d="M10 12h11"/><path d="M10 18h11"/><path d="M4 10h2V4H4"/><path d="M4 14h2a1 1 0 0 1 0 2H4v2h3"/>`),
    quote: wrap(`<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>`),
    code: wrap(`<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>`),
    plus: wrap(`<path d="M5 12h14"/><path d="M12 5v14"/>`),
    image: wrap(`<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`),
    grip: wrap(`<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>`),
    alert: wrap(`<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>`),
    alignLeft: wrap(`<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>`),
    alignCenter: wrap(`<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>`),
    alignRight: wrap(`<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>`),
    horizontal: wrap(`<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>`),
    vertical: wrap(`<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>`),
    stretch: wrap(`<path d="M12 3v18"/><path d="m16 8 4 4-4 4"/><path d="M4 12h16"/><path d="m8 8-4 4 4 4"/>`),
    chevron: wrap(`<path d="m6 9 6 6 6-6"/>`),
    layout: wrap(`<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="7" x="3" y="14" rx="1"/><rect width="5" height="7" x="16" y="14" rx="1"/>`),
    panelLeft: wrap(`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>`),
    panelRight: wrap(`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>`),
    alignTop: wrap(`<path d="M5 3h14"/><path d="m18 13-6-6-6 6"/><path d="M12 7v14"/>`),
    alignBottom: wrap(`<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>`),
    up: wrap(`<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>`),
    down: wrap(`<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>`),
    trash: wrap(`<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`),
};

export type IconName = keyof typeof icons;
