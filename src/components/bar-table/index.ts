import { z } from "zod";
import { kinds, plainText, textSize, type ComponentDefinition } from "../../kit";

/**
 * A column reads as numeric when most of its cells parse; one number among words is a stray,
 * not a scale. Every cell that parses gets a bar against that column's largest value, and a
 * cell that does not keeps its text, so a mixed column costs nothing.
 */
export default {
    about: "a table where every numeric column draws a bar behind its values; those columns take the width and the rest stay as narrow as their text",
    accepts: kinds("table"),
    props: z.object({ ...textSize }).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const rows: any[] = ctx.entities[0]!.node.children ?? [];
        const head: any[] = rows[0]?.children ?? [];
        const body = rows.slice(1);
        const parsed = head.map((_, c) => body.map(r => number(plainText(r.children?.[c]))));
        const scale = parsed.map(column => {
            const numbers = column.filter((v): v is number => v !== undefined);
            if (numbers.length * 2 <= column.length) return undefined;
            const max = Math.max(...numbers);
            return max > 0 ? max : undefined;
        });

        const kind = (c: number) => scale[c] === undefined ? "text" : "num";
        const cell = (r: number, c: number, node: any) => {
            const value = `<span class="ainsi-bar-table__value">${ctx.inline(node)}</span>`;
            // a fraction rather than a percentage: the css multiplies it by the width left once the gutter is taken
            const width = scale[c] !== undefined && parsed[c]![r] !== undefined
                ? ` style="--ainsi-bar-table-fill: ${(parsed[c]![r]! / scale[c]!).toFixed(3)}"`
                : "";
            const bar = width ? `<span class="ainsi-bar-table__bar"${width}></span>` : "";
            return `<td class="ainsi-bar-table__${kind(c)}">${bar}${value}</td>`;
        };

        return `<div class="ainsi-bar-table" data-ainsi="bar-table">
<table>
    <thead><tr>${head.map((h, c) => `<th class="ainsi-bar-table__${kind(c)}">${ctx.inline(h)}</th>`).join("")}</tr></thead>
    <tbody>
    ${body.map((r, i) => `<tr>${(r.children ?? []).map((c: any, j: number) => cell(i, j, c)).join("")}</tr>`).join("\n    ")}
    </tbody>
</table>
</div>`;
    },
} satisfies ComponentDefinition;

/**
 * The first number in the cell, so a unit, a currency mark or a thousands space rides along:
 * `5`, `5 tok/s`, `18%` and `€2 400` all measure. A space or a comma inside the digits is a
 * separator, a trailing comma or point with digits after it is the decimal.
 */
function number(text: string): number | undefined {
    const hit = text.replace(/[  ]/g, " ").match(/-?\d[\d ]*(?:[.,]\d+)?/);
    if (!hit) return undefined;
    const value = Number(hit[0].replace(/ /g, "").replace(",", "."));
    return Number.isFinite(value) ? value : undefined;
}
