import { z } from "zod";
import { labelled, listOf, type ComponentDefinition } from "../../kit";

/** an order of business: large numerals down the left, one row per item, a bold run as the row's title */
export default {
    about: "a list as an agenda: a large numeral per item down the left; a leading **bold** run is the item title",
    accepts: entities => !!listOf(entities),
    props: z.object({}).passthrough(),
    splittable: true,
    density: ["regular", "tight"],
    render: ctx => {
        const list = listOf(ctx.entities)!;
        const before = ctx.entities.slice(0, ctx.entities.indexOf(list)).map(e => ctx.html(e)).join("\n");
        const rows = labelled(list, ctx.inline).map(([title, body], i) => {
            const head = title ? `<span class="pac-agenda__title">${title}</span>` : "";
            return `<li class="pac-agenda__row">
        <span class="pac-agenda__number">${String(i + 1).padStart(2, "0")}</span>
        <span class="pac-agenda__text">${head}<span class="pac-agenda__body">${body}</span></span>
    </li>`;
        });
        return `${before}
<ol class="pac-agenda" data-pac="agenda">
    ${rows.join("\n    ")}
</ol>`;
    },
} satisfies ComponentDefinition;
