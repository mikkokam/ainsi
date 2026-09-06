import { z } from "zod";
import { flow, type ComponentDefinition } from "../../../../src/kit";

export default {
    about: "a fixture whose css leaks",
    accepts: () => true,
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => `<div class="ainsi-leaky" data-ainsi="leaky">${flow(ctx)}</div>`,
} satisfies ComponentDefinition;
