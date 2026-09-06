import { z } from "zod";
import { img, imageOf, type ComponentDefinition } from "../../kit";

export default {
    about: "an image filling its slot; the header layout makes it the ground",
    accepts: entities => entities.some(e => !!imageOf(e)),
    props: z.object({
        size: z.enum(["s", "m", "l", "full"]).optional(),
        align: z.enum(["left", "center", "right"]).default("left"),
    }).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => {
        const image = ctx.entities.map(imageOf).find(Boolean)!;
        const size = ctx.props.size as string | undefined;
        const align = ctx.props.align as string;
        return `<figure class="ainsi-full"${size ? ` data-size="${size}"` : ""}${align !== "left" ? ` data-align="${align}"` : ""} data-ainsi="full">${img(image)}</figure>`;
    },
} satisfies ComponentDefinition;
