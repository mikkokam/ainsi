/*
 * Every component this engine ships, named once. This list is the manifest: it cannot drift from
 * what exists, because it is what runs. Nothing here reads a directory or imports what it found
 * in one, so a bundle, a compiled binary or a sandbox loads the registry a checkout does.
 */

import agenda from "./agenda/index";
import agendaCss from "./agenda/style.css" with { type: "text" };
import alert from "./alert/index";
import alertCss from "./alert/style.css" with { type: "text" };
import barTable from "./bar-table/index";
import barTableCss from "./bar-table/style.css" with { type: "text" };
import boxes from "./boxes/index";
import boxesCss from "./boxes/style.css" with { type: "text" };
import columns from "./columns/index";
import columnsCss from "./columns/style.css" with { type: "text" };
import comparison from "./comparison/index";
import comparisonCss from "./comparison/style.css" with { type: "text" };
import figures from "./figures/index";
import figuresCss from "./figures/style.css" with { type: "text" };
import full from "./full/index";
import fullCss from "./full/style.css" with { type: "text" };
import matrix from "./matrix/index";
import matrixCss from "./matrix/style.css" with { type: "text" };
import prose from "./prose/index";
import proseCss from "./prose/style.css" with { type: "text" };
import roadmap from "./roadmap/index";
import roadmapCss from "./roadmap/style.css" with { type: "text" };
import stripedTable from "./striped-table/index";
import stripedTableCss from "./striped-table/style.css" with { type: "text" };
import tiles from "./tiles/index";
import tilesCss from "./tiles/style.css" with { type: "text" };
import timeline from "./timeline/index";
import timelineCss from "./timeline/style.css" with { type: "text" };

import type { Entry, ComponentDefinition } from "../registry";

export const COMPONENTS: Entry<ComponentDefinition>[] = [
    { name: "agenda", definition: agenda, css: agendaCss },
    { name: "alert", definition: alert, css: alertCss },
    { name: "bar-table", definition: barTable, css: barTableCss },
    { name: "boxes", definition: boxes, css: boxesCss },
    { name: "columns", definition: columns, css: columnsCss },
    { name: "comparison", definition: comparison, css: comparisonCss },
    { name: "figures", definition: figures, css: figuresCss },
    { name: "full", definition: full, css: fullCss },
    { name: "matrix", definition: matrix, css: matrixCss },
    { name: "prose", definition: prose, css: proseCss },
    { name: "roadmap", definition: roadmap, css: roadmapCss },
    { name: "striped-table", definition: stripedTable, css: stripedTableCss },
    { name: "tiles", definition: tiles, css: tilesCss },
    { name: "timeline", definition: timeline, css: timelineCss },
];
