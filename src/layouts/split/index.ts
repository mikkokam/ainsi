import { z } from "zod";
import type { LayoutDefinition } from "../../registry";
import { tone } from "../default";

/** props only; the template is inherited from default */
export default {
    props: z.object({ side: z.enum(["left", "right"]).optional(), tone }).passthrough(),
} satisfies Pick<LayoutDefinition, "props">;
