import { z } from "zod";
import { labelled, listOf, textSize, type ComponentDefinition } from "../../kit";

export default {
    about: "a list, one step per item; a leading **bold** run is the step label",
    accepts: entities => !!listOf(entities),
    props: z.object({
        ...textSize,
        axis: z.enum(["horizontal", "vertical"]).default("horizontal"),
    }).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const list = listOf(ctx.entities)!;
        const before = ctx.entities.slice(0, ctx.entities.indexOf(list)).map(e => ctx.html(e)).join("\n");
        const axis = ctx.props.axis as string;
        const steps = labelled(list, ctx.inline).map(([label, body]) => `<li class="ainsi-timeline__step">
        <span class="ainsi-timeline__marker" aria-hidden="true"></span>
        <span class="ainsi-timeline__label">${label}</span>
        <span class="ainsi-timeline__body">${body}</span>
    </li>`);
        return `${before}
<ol class="ainsi-timeline ainsi-timeline--${axis}${list.ordered ? " ainsi-timeline--numbered" : ""}" data-ainsi="timeline">
    ${steps.join("\n    ")}
</ol>`;
    },
} satisfies ComponentDefinition;
