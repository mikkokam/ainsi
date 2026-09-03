import { z } from "zod";
import { type ComponentDefinition } from "../../kit";

/**
 * The escape hatch. Emits the source untouched, which is the point: whatever the vocabulary
 * cannot express goes through here rather than becoming an eleventh component.
 */
export default {
    accepts: () => true,
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => ctx.entities.map(e => e.md).join("\n\n"),
} satisfies ComponentDefinition;
