import { z } from "zod";
import type { LayoutDefinition } from "../../registry";

/**
 * Always present, and the only layout with a template. Every other layout is a stylesheet
 * that inherits this one, so its props arrive as data attributes for its CSS to select on.
 */
export default {
    props: z.object({}).passthrough(),
    render: ctx => `<main${attributes(ctx.props)}><article>${ctx.content}</article></main>`,
} satisfies LayoutDefinition;

function attributes(props: Record<string, unknown>): string {
    return Object.entries(props)
        .filter(([key]) => /^[a-z][a-z0-9-]*$/.test(key))
        .map(([key, value]) => ` data-${key}="${String(value).replace(/"/g, "&quot;")}"`)
        .join("");
}
