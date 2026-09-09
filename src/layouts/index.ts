/*
 * Every layout this engine ships, named once. This list is the manifest: it cannot drift from
 * what exists, because it is what runs. Nothing here reads a directory or imports what it found
 * in one, so a bundle, a compiled binary or a sandbox loads the registry a checkout does.
 */

import layoutDefault from "./default/index";
import layoutDefaultCss from "./default/style.css" with { type: "text" };
import layoutHeader from "./header/index";
import layoutHeaderCss from "./header/style.css" with { type: "text" };
import layoutSection from "./section/index";
import layoutSectionCss from "./section/style.css" with { type: "text" };
import layoutSplit from "./split/index";
import layoutSplitCss from "./split/style.css" with { type: "text" };

import type { Entry, LayoutDefinition } from "../registry";

export const LAYOUTS: Entry<LayoutDefinition>[] = [
    { name: "default", definition: layoutDefault, css: layoutDefaultCss },
    { name: "header", definition: layoutHeader, css: layoutHeaderCss },
    { name: "section", definition: layoutSection, css: layoutSectionCss },
    { name: "split", definition: layoutSplit, css: layoutSplitCss },
];
