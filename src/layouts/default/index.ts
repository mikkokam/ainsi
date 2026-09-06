import { z } from "zod";
import type { LayoutDefinition } from "../../registry";

/**
 * Always present, and the only layout with a template. Every other layout is a stylesheet
 * that inherits this one, so its props arrive as data attributes for its CSS to select on.
 */
/** every layout's ground: absent is the theme's, the others remap the page's tokens in base css */
export const tone = z.enum(["accent", "inverse"]).optional();

export default {
    props: z.object({ tone }).passthrough(),
    render: ctx => `<main${attributes(ctx.props)}><article>${ctx.content}</article></main>`,
} satisfies LayoutDefinition;

function attributes(props: Record<string, unknown>): string {
    return Object.entries(props)
        .filter(([key]) => /^[a-z][a-z0-9-]*$/.test(key))
        .map(([key, value]) => ` data-${key}="${String(value).replace(/"/g, "&quot;")}"`)
        .join("");
}
