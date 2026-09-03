import { z } from "zod";
import { flow, kinds, type ComponentDefinition } from "../../kit";

export default {
    accepts: kinds("table"),
    props: z.object({}).passthrough(),
    splittable: true,
    density: ["regular", "tight"],
    render: ctx => `<div class="pac-table" data-pac="table">${flow(ctx)}</div>`,
} satisfies ComponentDefinition;
