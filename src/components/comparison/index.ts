import { z } from "zod";
import { kinds, textSize, type ComponentDefinition } from "../../kit";

export default {
    about: "a table: the header names the columns, the first column labels the rows, each further column is a panel",
    accepts: kinds("table"),
    props: z.object({ ...textSize }).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const rows: any[] = ctx.entities[0]!.node.children ?? [];
        const head = (rows[0]?.children ?? []).map((c: any) => ctx.inline(c));
        const body = rows.slice(1).map((r: any) => (r.children ?? []).map((c: any) => ctx.inline(c)));
        const columns = head.slice(1).map((title: string, i: number) => `
    <div class="ainsi-comparison__column">
        <h3 class="ainsi-comparison__head">${title}</h3>
        <dl class="ainsi-comparison__rows">
            ${body.map((r: string[]) => `<div class="ainsi-comparison__row"><dt>${r[0] ?? ""}</dt><dd>${r[i + 1] ?? ""}</dd></div>`).join("\n            ")}
        </dl>
    </div>`);
        return `<div class="ainsi-comparison" data-ainsi="comparison">${columns.join("")}
</div>`;
    },
} satisfies ComponentDefinition;
