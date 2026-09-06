import { z } from "zod";
import { flow, type ComponentDefinition } from "../../../../src/kit";

export default {
    about: "a fixture: anything, in a box",
    accepts: () => true,
    props: z.object({ tone: z.enum(["note", "alert"]).default("note") }).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => `<div class="pac-callout pac-callout--${ctx.props.tone ?? "note"}" data-pac="callout">${flow(ctx)}</div>`,
} satisfies ComponentDefinition;
