import { z } from "zod";
import { signature, type ComponentDefinition, type Entity } from "../../kit";
import { ALERT_ICONS } from "./icons";

/** GitHub's alert syntax: a blockquote whose first line is `[!NOTE]` or one of its four siblings */
export const KINDS = ["note", "tip", "important", "warning", "caution"] as const;
const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

export const alertKind = (entity: Entity): string | undefined =>
    entity.kind === "quote" ? MARKER.exec(entity.text)?.[1]?.toLowerCase() : undefined;

export default {
    about: "a blockquote opening with [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION]",
    accepts: entities => entities.length === 1 && !!alertKind(entities[0]!),
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular"],
    render: ctx => {
        const quote = ctx.entities[0]!;
        const kind = alertKind(quote)!;
        // the marker is the first text of the first paragraph; the line break after it goes too
        const [first, ...rest] = (signature(quote.node)?.[0] ?? quote.node).children as any[];
        const children = first?.children?.slice() ?? [];
        if (children[0]?.type === "text") children[0] = { ...children[0], value: children[0].value.replace(MARKER, "") };
        if (children[0]?.type === "text" && children[0].value === "") children.shift();
        if (children[0]?.type === "break") children.shift();
        const body = [...(children.length ? [{ ...first, children }] : []), ...rest];
        const name = `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
        return `<aside class="ainsi-alert ainsi-alert--${kind}" data-ainsi="alert" role="note" aria-label="${name}" title="${name}">
    <span class="ainsi-alert__tag">${ALERT_ICONS[kind]}</span>
    ${ctx.html({ ...quote, node: { type: "root", children: body } })}
</aside>`;
    },
} satisfies ComponentDefinition;
