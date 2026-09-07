import { z } from "zod";
import { flow, kinds, type ComponentDefinition } from "../../kit";

/** the markdown table with a band behind every other row, so a wide row is read across */
export default {
    about: "a table with striped rows; the header names the columns and the stripes carry the eye across a wide row",
    accepts: kinds("table"),
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => `<div class="ainsi-striped-table" data-ainsi="striped-table">\n${flow(ctx)}\n</div>`,
} satisfies ComponentDefinition;
