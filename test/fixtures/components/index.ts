/* a fixture registry in the shape the engine takes: a list, not a folder to scan */

import callout from "./callout/index";
import calloutCss from "./callout/style.css" with { type: "text" };

import type { Entry, ComponentDefinition } from "../../../src/registry";

export const FIXTURES: Entry<ComponentDefinition>[] = [
    { name: "callout", definition: callout, css: calloutCss },
];
