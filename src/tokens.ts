/**
 * The theme contract. A component may reference these and its own `--ainsi-<name>-*`
 * variables, nothing else. Capped like the component vocabulary: a token per decision
 * a theme is allowed to make, not one per property a component happens to set.
 */
export const TOKENS = [
    // colour
    "--ainsi-ink", "--ainsi-ink-soft", "--ainsi-ground", "--ainsi-shell",
    "--ainsi-accent", "--ainsi-accent-ink", "--ainsi-rule", "--ainsi-surface",
    // a light wash of the accent: the soft tone's ground, where the ink and the accent stay as they are
    "--ainsi-tint",
    // status: what informative, good, notable, careful and stop look like; alerts are the first to ask
    "--ainsi-info", "--ainsi-ok", "--ainsi-notice", "--ainsi-warn", "--ainsi-danger",
    // identity: the deck's mark and the cover's, from its frontmatter; a theme decides where they sit and how large
    "--ainsi-logo", "--ainsi-logo-cover",
    // type
    "--ainsi-font", "--ainsi-font-display", "--ainsi-font-mono", "--ainsi-strong", "--ainsi-size", "--ainsi-leading",
    // how far the fit solver may step the type down before it splits a page instead
    "--ainsi-step-min",
    // space and shape
    "--ainsi-gap", "--ainsi-pad", "--ainsi-radius", "--ainsi-border",
    // material: what a surface is made of, so depth is a theme's call and not a component's
    "--ainsi-shadow", "--ainsi-blur",
    // motion: how the deck moves when presented, down to not at all
    "--ainsi-motion", "--ainsi-ease",
] as const;

export type Token = (typeof TOKENS)[number];
