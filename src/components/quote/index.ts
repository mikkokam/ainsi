import { z } from "zod";
import { kinds, type ComponentDefinition } from "../../kit";

export default {
    accepts: kinds("quote", "paragraph"),
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => {
        // `> — Name` as the blockquote's last paragraph is the attribution; anything after the
        // blockquote is the next block's, since a directive governs one entity
        const quote = ctx.entities.find(e => e.kind === "quote");
        const paragraphs: any[] = quote?.node.children ?? [];
        const last = paragraphs.at(-1);
        const signed = paragraphs.length > 1 && last?.type === "paragraph" && /^\s*(—|–|--)\s*/.test(ctx.text(last));
        const bodyNode = quote && signed ? { ...quote.node, children: paragraphs.slice(0, -1) } : quote?.node;
        const body = quote
            ? ctx.html({ ...quote, node: bodyNode })
            : ctx.entities.map(e => ctx.html(e)).join("\n");
        const author = signed
            ? `<figcaption class="pac-quote__author">${ctx.inline(last).replace(/^\s*(—|–|--)\s*/, "")}</figcaption>`
            : "";
        return `<figure class="pac-quote" data-pac="quote">
    ${body}
    ${author}
</figure>`;
    },
} satisfies ComponentDefinition;
