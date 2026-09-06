import { z } from "zod";
import type { LayoutDefinition } from "../../registry";

/**
 * Props only; the template is inherited from default. A divider sits on the accent ground
 * unless told otherwise, so "ground" is in the enum where the other layouts leave it absent.
 */
export default {
    props: z.object({ tone: z.enum(["ground", "accent", "inverse", "soft"]).default("accent") }).passthrough(),
} satisfies Pick<LayoutDefinition, "props">;
