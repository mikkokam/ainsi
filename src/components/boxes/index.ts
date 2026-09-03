import { z } from "zod";
import { escape, items, listOf, split, type ComponentDefinition } from "../../kit";

export default {
    accepts: entities => !!listOf(entities),
    props: z.object({
        /** false: boxes take a shared width and wrap. true: they grow to fill the row. */
        stretch: z.boolean().default(false),
    }).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const list = listOf(ctx.entities)!;
        const before = ctx.entities.slice(0, ctx.entities.indexOf(list)).map(e => ctx.html(e)).join("\n");
        const boxes = items(list).map(text => {
            const [title, body] = split(text);
            const head = title ? `<span class="pac-boxes__title">${escape(title)}</span>` : "";
            return `<li class="pac-boxes__box">${head}<span class="pac-boxes__body">${escape(body)}</span></li>`;
        });
        return `${before}
<ul class="pac-boxes" data-pac="boxes" data-stretch="${ctx.props.stretch === true}">
    ${boxes.join("\n    ")}
</ul>`;
    },
} satisfies ComponentDefinition;
