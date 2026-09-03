import { z } from "zod";
import { type ComponentDefinition } from "../../kit";

export default {
    accepts: entities => entities[0]?.kind === "heading",
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => {
        const [head, ...rest] = ctx.entities;
        return `<div class="pac-lead" data-pac="lead">
    <h1 class="pac-lead__title">${ctx.inline(head!.node)}</h1>
    <div class="pac-lead__body">${rest.map(e => ctx.html(e)).join("\n")}</div>
</div>`;
    },
} satisfies ComponentDefinition;
