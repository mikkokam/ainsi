import { z } from "zod";
import { labelled, listOf, type ComponentDefinition } from "../../kit";

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
        const boxes = labelled(list, ctx.inline).map(([title, body]) => {
            const head = title ? `<span class="pac-boxes__title">${title}</span>` : "";
            return `<li class="pac-boxes__box">${head}<span class="pac-boxes__body">${body}</span></li>`;
        });
        // a numbered list keeps its numbers: an ol, and the css puts each one on its box
        const tag = list.ordered ? "ol" : "ul";
        return `${before}
<${tag} class="pac-boxes${list.ordered ? " pac-boxes--ordered" : ""}" data-pac="boxes" data-stretch="${ctx.props.stretch === true}">
    ${boxes.join("\n    ")}
</${tag}>`;
    },
} satisfies ComponentDefinition;
