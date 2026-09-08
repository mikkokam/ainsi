import { z } from "zod";
import { kinds, plainText, textSize, type ComponentDefinition } from "../../kit";

/**
 * The header names the periods, the first column names the rows, and a cell with anything in
 * it is filled. A cell holding only a mark carries no text; anything else is a label inside
 * the block. Adjacent filled cells stay separate blocks: a span across periods would need a
 * rule for what continues and what merely repeats, and no deck has asked for one.
 */
export default {
    about: "a table as a roadmap: the header names the periods, the first column names the rows, and any cell with text in it becomes a filled block",
    accepts: kinds("table"),
    props: z.object({ ...textSize }).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const rows: any[] = ctx.entities[0]!.node.children ?? [];
        const head: any[] = rows[0]?.children ?? [];
        const periods = head.slice(1).map(h => `<th class="ainsi-roadmap__period">${ctx.inline(h)}</th>`);
        const body = rows.slice(1).map((r: any) => {
            const cells = (r.children ?? []).slice(1).map((c: any) => {
                const text = plainText(c).trim();
                if (!text) return `<td class="ainsi-roadmap__slot"></td>`;
                const label = MARK.test(text) ? "" : ctx.inline(c);
                return `<td class="ainsi-roadmap__slot"><span class="ainsi-roadmap__mark">${label}</span></td>`;
            });
            return `<tr><th class="ainsi-roadmap__row" scope="row">${ctx.inline(r.children?.[0])}</th>${cells.join("")}</tr>`;
        });
        return `<div class="ainsi-roadmap" data-ainsi="roadmap">
<table>
    <thead><tr><th class="ainsi-roadmap__corner"></th>${periods.join("")}</tr></thead>
    <tbody>
    ${body.join("\n    ")}
    </tbody>
</table>
</div>`;
    },
} satisfies ComponentDefinition;

/** a cell that is only a mark says "this period, no more"; the block is the whole message */
const MARK = /^[-x*•·—–+✓]+$/i;
