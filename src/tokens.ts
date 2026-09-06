/**
 * The theme contract. A component may reference these and its own `--pac-<name>-*`
 * variables, nothing else. Capped like the component vocabulary: a token per decision
 * a theme is allowed to make, not one per property a component happens to set.
 */
export const TOKENS = [
    // colour
    "--pac-ink", "--pac-ink-soft", "--pac-ground", "--pac-shell",
    "--pac-accent", "--pac-accent-ink", "--pac-rule", "--pac-surface",
    // status: what informative, good, notable, careful and stop look like; alerts are the first to ask
    "--pac-info", "--pac-ok", "--pac-notice", "--pac-warn", "--pac-danger",
    // type
    "--pac-font", "--pac-font-display", "--pac-font-mono", "--pac-strong", "--pac-size", "--pac-leading",
    // how far the fit solver may step the type down before it splits a page instead
    "--pac-step-min",
    // space and shape
    "--pac-gap", "--pac-pad", "--pac-radius", "--pac-border",
    // material: what a surface is made of, so depth is a theme's call and not a component's
    "--pac-shadow", "--pac-blur",
    // motion: how the deck moves when presented, down to not at all
    "--pac-motion", "--pac-ease",
] as const;

export type Token = (typeof TOKENS)[number];
