import { z } from "zod";
import type { LayoutDefinition } from "../../registry";

/** props only; the template is inherited from default. No tone: the photo is the ground here. */
export default {
    props: z.object({ align: z.enum(["start", "center", "end"]).default("end") }).passthrough(),
} satisfies Pick<LayoutDefinition, "props">;
