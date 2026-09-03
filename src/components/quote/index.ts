import { z } from "zod";
import { kinds, type ComponentDefinition } from "../../kit";

export default {
    accepts: kinds("quote", "paragraph"),
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => {
        const quotes = ctx.entities.filter(e => e.kind === "quote");
        const rest = ctx.entities.filter(e => e.kind !== "quote");
        const body = quotes.length ? quotes.map(e => ctx.html(e)).join("\n") : rest.map(e => ctx.html(e)).join("\n");
        const author = quotes.length && rest.length
            ? `<figcaption class="pac-quote__author">${rest.map(e => ctx.html(e)).join("\n")}</figcaption>`
            : "";
        return `<figure class="pac-quote" data-pac="quote">
    ${body}
    ${author}
</figure>`;
    },
} satisfies ComponentDefinition;
