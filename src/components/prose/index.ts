import { z } from "zod";
import { flow, type ComponentDefinition } from "../../kit";

/**
 * The fallback, and the only component that adds no element of its own. A wrapper carrying
 * no meaning is noise in the output; the page's own flow already positions these. A size
 * other than normal is the one thing that earns a wrapper: text on the type scale that is
 * still text, so it stays out of the outline and the PDF's bookmarks.
 */
export default {
    about: "markdown as written, with a size and an alignment",
    accepts: () => true,
    props: z.object({
        size: z.enum(["small", "normal", "large", "huge"]).default("normal"),
        align: z.enum(["left", "center", "right"]).default("left"),
    }).passthrough(),
    splittable: true,
    density: ["regular", "tight"],
    render: ctx => {
        const size = ctx.props.size as string;
        const align = ctx.props.align as string;
        const classes = [size !== "normal" && `pac-prose--${size}`, align !== "left" && `pac-prose--${align}`].filter(Boolean);
        return classes.length ? `<div class="pac-prose ${classes.join(" ")}">\n${flow(ctx)}\n</div>` : flow(ctx);
    },
} satisfies ComponentDefinition;
