import { z } from "zod";
import { escape, kinds, plainText, type ComponentDefinition } from "../../kit";

export default {
    accepts: kinds("table"),
    props: z.object({}).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const rows: any[] = ctx.entities[0]!.node.children ?? [];
        const head = (rows[0]?.children ?? []).map((c: any) => plainText(c));
        const body = rows.slice(1).map((r: any) => (r.children ?? []).map((c: any) => plainText(c)));
        const columns = head.slice(1).map((title: string, i: number) => `
    <div class="pac-comparison__column">
        <h3 class="pac-comparison__head">${escape(title)}</h3>
        <dl class="pac-comparison__rows">
            ${body.map((r: string[]) => `<div class="pac-comparison__row"><dt>${escape(r[0] ?? "")}</dt><dd>${escape(r[i + 1] ?? "")}</dd></div>`).join("\n            ")}
        </dl>
    </div>`);
        return `<div class="pac-comparison" data-pac="comparison">${columns.join("")}
</div>`;
    },
} satisfies ComponentDefinition;
