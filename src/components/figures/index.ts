import { z } from "zod";
import { labelled, listOf, plainText, type ComponentDefinition } from "../../kit";

/**
 * Big figures with captions. The bold run is the figure and is any text: 5, 500 000,
 * $2.4M, 200 Mtok/s. The row is set at one display size, stepped down together until the
 * longest figure fits its column; the stylesheet does that from a length the render writes,
 * so the fit pass measures what is shown.
 */
export default {
    about: "a list, one figure per item: the leading **bold** run is the figure, the rest its caption",
    accepts: entities => !!listOf(entities),
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const list = listOf(ctx.entities)!;
        const before = ctx.entities.slice(0, ctx.entities.indexOf(list)).map(e => ctx.html(e)).join("\n");
        const items = (list.node.children ?? []) as any[];
        const longest = Math.max(1, ...items.map(li => plainText(li?.children?.[0]?.children?.[0]).trim().length));
        const figures = labelled(list, ctx.inline).map(([value, caption]) => `<li class="ainsi-figures__item">
        <span class="ainsi-figures__value">${value || caption}</span>
        ${value ? `<span class="ainsi-figures__caption">${caption}</span>` : ""}
    </li>`);
        return `${before}
<ul class="ainsi-figures" data-ainsi="figures" style="--ainsi-figures-count: ${figures.length}; --ainsi-figures-chars: ${longest}">
    ${figures.join("\n    ")}
</ul>`;
    },
} satisfies ComponentDefinition;
