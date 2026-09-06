import { z } from "zod";
import type { LayoutDefinition } from "../../registry";
import defaultLayout, { tone } from "../default";

const FIGURE = /<figure[^>]*class="ainsi-full"[\s\S]*?<\/figure>/;

/**
 * size=image hoists the figure out of the article, to just before it: the text column is
 * anchored to the figure's edge, and an anchor inside the positioned element itself is
 * invalid, while a preceding sibling is the nearest anchor in tree order. Every other size
 * keeps the inherited template.
 */
export default {
    props: z.object({
        side: z.enum(["left", "right"]).optional(),
        /** the image pane's share of the page; `image` lets the picture's own ratio decide */
        size: z.enum(["third", "half", "two-thirds", "image"]).optional(),
        tone,
    }).passthrough(),
    render: ctx => {
        const figure = ctx.props.size === "image" ? FIGURE.exec(ctx.content)?.[0] : undefined;
        if (!figure) return defaultLayout.render(ctx);
        const rest = ctx.content.replace(FIGURE, "");
        return defaultLayout.render({ ...ctx, content: rest }).replace("<article>", `${figure}<article>`);
    },
} satisfies LayoutDefinition;
