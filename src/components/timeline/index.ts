import { z } from "zod";
import { labelled, listOf, type ComponentDefinition } from "../../kit";

export default {
    accepts: entities => !!listOf(entities),
    props: z.object({
        axis: z.enum(["horizontal", "vertical"]).default("horizontal"),
    }).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const list = listOf(ctx.entities)!;
        const before = ctx.entities.slice(0, ctx.entities.indexOf(list)).map(e => ctx.html(e)).join("\n");
        const axis = (ctx.props.axis as string) ?? "horizontal";
        const steps = labelled(list, ctx.inline).map(([label, body]) => `<li class="pac-timeline__step">
        <span class="pac-timeline__marker" aria-hidden="true"></span>
        <span class="pac-timeline__label">${label}</span>
        <span class="pac-timeline__body">${body}</span>
    </li>`);
        return `${before}
<ol class="pac-timeline pac-timeline--${axis}${list.ordered ? " pac-timeline--numbered" : ""}" data-pac="timeline">
    ${steps.join("\n    ")}
</ol>`;
    },
} satisfies ComponentDefinition;
