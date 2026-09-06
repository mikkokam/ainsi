import { z } from "zod";
import { type ComponentDefinition, type Entity } from "../../kit";

/** GitHub's alert syntax: a blockquote whose first line is `[!NOTE]` or one of its four siblings */
export const KINDS = ["note", "tip", "important", "warning", "caution"] as const;
const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

export const alertKind = (entity: Entity): string | undefined =>
    entity.kind === "quote" ? MARKER.exec(entity.text)?.[1]?.toLowerCase() : undefined;

export default {
    accepts: entities => entities.length === 1 && !!alertKind(entities[0]!),
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => {
        const quote = ctx.entities[0]!;
        const kind = alertKind(quote)!;
        // the marker is the first text of the first paragraph; the line break after it goes too
        const [first, ...rest] = quote.node.children as any[];
        const children = first?.children?.slice() ?? [];
        if (children[0]?.type === "text") children[0] = { ...children[0], value: children[0].value.replace(MARKER, "") };
        if (children[0]?.type === "text" && children[0].value === "") children.shift();
        if (children[0]?.type === "break") children.shift();
        const body = [...(children.length ? [{ ...first, children }] : []), ...rest];
        return `<aside class="pac-alert pac-alert--${kind}" data-pac="alert">
    <p class="pac-alert__title">${kind[0]!.toUpperCase()}${kind.slice(1)}</p>
    ${ctx.html({ ...quote, node: { type: "root", children: body } })}
</aside>`;
    },
} satisfies ComponentDefinition;
