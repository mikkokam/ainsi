import { z } from "zod";
import { flow, type ComponentDefinition } from "../../kit";

/**
 * The fallback, and the only component that adds no element of its own. A wrapper carrying
 * no meaning is noise in the output; the page's own flow already positions these.
 */
export default {
    accepts: () => true,
    props: z.object({}).passthrough(),
    splittable: true,
    density: ["regular", "tight"],
    render: ctx => flow(ctx),
} satisfies ComponentDefinition;
