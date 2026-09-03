import { z } from "zod";
import { flow, type ComponentDefinition } from "../../../../src/kit";

export default {
    accepts: () => true,
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => `<div class="pac-leaky" data-pac="leaky">${flow(ctx)}</div>`,
} satisfies ComponentDefinition;
