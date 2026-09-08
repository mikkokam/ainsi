import { z } from "zod";
import { labelled, listOf, textSize, type ComponentDefinition } from "../../kit";

/** an order of business, one row per item; a numbered list wears its numerals down the left */
export default {
    about: "a list as an agenda, one row per item; a numbered list wears its numerals; a leading **bold** run is the item title",
    accepts: entities => !!listOf(entities),
    props: z.object({ ...textSize }).passthrough(),
    splittable: true,
    density: ["regular", "tight"],
    render: ctx => {
        const list = listOf(ctx.entities)!;
        const before = ctx.entities.slice(0, ctx.entities.indexOf(list)).map(e => ctx.html(e)).join("\n");
        const rows = labelled(list, ctx.inline).map(([title, body], i) => {
            const head = title ? `<span class="ainsi-agenda__title">${title}</span>` : "";
            const number = list.ordered ? `<span class="ainsi-agenda__number">${String(i + 1).padStart(2, "0")}</span>` : "";
            return `<li class="ainsi-agenda__row">${number}<span class="ainsi-agenda__text">${head}<span class="ainsi-agenda__body">${body}</span></span></li>`;
        });
        const tag = list.ordered ? "ol" : "ul";
        return `${before}
<${tag} class="ainsi-agenda" data-ainsi="agenda">
    ${rows.join("\n    ")}
</${tag}>`;
    },
} satisfies ComponentDefinition;
