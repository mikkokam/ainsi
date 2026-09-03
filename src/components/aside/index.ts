import { z } from "zod";
import { img, imageOf, type ComponentDefinition } from "../../kit";

export default {
    accepts: entities => entities.some(e => !!imageOf(e)),
    props: z.object({
        side: z.enum(["left", "right"]).default("right"),
    }).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => {
        const carrier = ctx.entities.find(e => !!imageOf(e))!;
        const rest = ctx.entities.filter(e => e !== carrier);
        const side = (ctx.props.side as string) ?? "right";
        return `<div class="pac-aside pac-aside--${side}" data-pac="aside">
    <figure class="pac-aside__figure">${img(imageOf(carrier)!)}</figure>
    <div class="pac-aside__body">${rest.map(e => ctx.html(e)).join("\n")}</div>
</div>`;
    },
} satisfies ComponentDefinition;
