import { z } from "zod";
import { flow, type ComponentDefinition } from "../../kit";

/**
 * The fallback, and the only component that adds no element of its own. A wrapper carrying
 * no meaning is noise in the output; the page's own flow already positions these. A size
 * other than normal is the one thing that earns a wrapper: text on the type scale that is
 * still text, so it stays out of the outline and the PDF's bookmarks.
 */
export default {
    accepts: () => true,
    props: z.object({
        size: z.enum(["small", "normal", "large", "huge"]).default("normal"),
    }).passthrough(),
    splittable: true,
    density: ["regular", "tight"],
    render: ctx => {
        const size = (ctx.props.size as string | undefined) ?? "normal";   // a heuristic block carries no defaults
        return size === "normal" ? flow(ctx) : `<div class="pac-prose pac-prose--${size}">
${flow(ctx)}
</div>`;
    },
} satisfies ComponentDefinition;
