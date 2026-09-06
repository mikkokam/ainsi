import { z } from "zod";
import { labelled, listOf, type ComponentDefinition } from "../../kit";

/** a two-by-two: four items, quadrants in reading order, top-left first; optional axis labels */
export default {
    about: "a list of exactly four items as a two-by-two, top-left first; a leading **bold** run is the quadrant title; axes name the x and y",
    accepts: entities => (listOf(entities)?.node.children?.length ?? 0) === 4,
    props: z.object({
        x: z.string().default(""),
        y: z.string().default(""),
    }).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const list = listOf(ctx.entities)!;
        const before = ctx.entities.slice(0, ctx.entities.indexOf(list)).map(e => ctx.html(e)).join("\n");
        const cells = labelled(list, ctx.inline).map(([title, body]) => {
            const head = title ? `<span class="pac-matrix__title">${title}</span>` : "";
            return `<li class="pac-matrix__cell">${head}<span class="pac-matrix__body">${body}</span></li>`;
        });
        const x = ctx.props.x as string, y = ctx.props.y as string;
        const axes = x || y
            ? `<span class="pac-matrix__x">${escape(x)}</span><span class="pac-matrix__y">${escape(y)}</span>`
            : "";
        return `${before}
<div class="pac-matrix${axes ? " pac-matrix--axes" : ""}" data-pac="matrix">
    <ul class="pac-matrix__grid">
    ${cells.join("\n    ")}
    </ul>${axes}
</div>`;
    },
} satisfies ComponentDefinition;

const escape = (value: string): string => value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
