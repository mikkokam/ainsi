/* a fixture registry in the shape the engine takes: a list, not a folder to scan */

import leaky from "./leaky/index";
import leakyCss from "./leaky/style.css" with { type: "text" };

import type { Entry, ComponentDefinition } from "../../../src/registry";

export const BAD: Entry<ComponentDefinition>[] = [
    { name: "leaky", definition: leaky, css: leakyCss },
];
