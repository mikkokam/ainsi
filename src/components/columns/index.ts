import { z } from "zod";
import { labelled, listOf, type ComponentDefinition } from "../../kit";

/** boxes without the chrome: each item a column of plain text, a leading bold run its title */
export default {
    about: "a list, one column per item, no cards; a leading **bold** run is the column title",
    accepts: entities => !!listOf(entities),
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const list = listOf(ctx.entities)!;
        const before = ctx.entities.slice(0, ctx.entities.indexOf(list)).map(e => ctx.html(e)).join("\n");
        const columns = labelled(list, ctx.inline).map(([title, body]) => {
            const head = title ? `<span class="ainsi-columns__title">${title}</span>` : "";
            return `<li class="ainsi-columns__column">${head}<span class="ainsi-columns__body">${body}</span></li>`;
        });
        const tag = list.ordered ? "ol" : "ul";
        return `${before}
<${tag} class="ainsi-columns${list.ordered ? " ainsi-columns--ordered" : ""}" data-ainsi="columns">
    ${columns.join("\n    ")}
</${tag}>`;
    },
} satisfies ComponentDefinition;
