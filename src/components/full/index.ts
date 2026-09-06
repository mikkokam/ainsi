import { z } from "zod";
import { img, imageOf, type ComponentDefinition } from "../../kit";

export default {
    about: "an image filling its slot; the header layout makes it the ground",
    accepts: entities => entities.some(e => !!imageOf(e)),
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => {
        const image = ctx.entities.map(imageOf).find(Boolean)!;
        return `<figure class="pac-full" data-pac="full">${img(image)}</figure>`;
    },
} satisfies ComponentDefinition;
