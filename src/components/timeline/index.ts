import { z } from "zod";
import { escape, items, listOf, split, type ComponentDefinition } from "../../kit";

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
        const steps = items(list).map(text => {
            const [label, body] = split(text);
            return `<li class="pac-timeline__step">
        <span class="pac-timeline__marker" aria-hidden="true"></span>
        <span class="pac-timeline__label">${escape(label)}</span>
        <span class="pac-timeline__body">${escape(body)}</span>
    </li>`;
        });
        return `${before}
<ol class="pac-timeline pac-timeline--${axis}" data-pac="timeline">
    ${steps.join("\n    ")}
</ol>`;
    },
} satisfies ComponentDefinition;
