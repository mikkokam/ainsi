import { z } from "zod";
import { labelled, listOf, plainText, type ComponentDefinition } from "../../kit";

/**
 * Big figures with captions. The bold run is the figure and is any text: 5, 500 000,
 * $2.4M, 200 Mtok/s. It is set at display size and steps down to fit its column, which the
 * stylesheet does from the figure's own length, so the fit pass measures what is shown.
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
        const figures = labelled(list, ctx.inline).map(([value, caption], i) => {
            const strong = items[i]?.children?.[0]?.children?.[0];
            const chars = Math.max(1, plainText(strong).trim().length);
            return `<li class="pac-figures__item" style="--pac-figures-chars: ${chars}">
        <span class="pac-figures__value">${value || caption}</span>
        ${value ? `<span class="pac-figures__caption">${caption}</span>` : ""}
    </li>`;
        });
        return `${before}
<ul class="pac-figures" data-pac="figures" style="--pac-figures-count: ${figures.length}">
    ${figures.join("\n    ")}
</ul>`;
    },
} satisfies ComponentDefinition;
