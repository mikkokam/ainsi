import { z } from "zod";
import { imageOf, img, labelled, listOf, type ComponentDefinition } from "../../kit";

/**
 * A list laid out as a field: pictures, or text, or both. Two flows, because they answer
 * different questions. A grid keeps the columns aligned and lets the rows be as tall as
 * their tallest tile, which is what a page of even-ish pictures wants. Masonry packs each
 * column independently so nothing is left short, at the price of reading down rather than
 * across, which only matters when the items are prose.
 *
 * Pictures are never cropped by default: a portfolio shows the frame the photographer chose,
 * and the spare space is the price. `crop` gives up the aspect ratio for a flush grid.
 */

/** roughly a page of content at the deck's own type size, less the captions under each row */
const BUDGET = 15;

/** the columns a count wants when nobody said: pairs stay pairs, four is a square, then threes */
const columnsFor = (count: number): number =>
    count <= 1 ? 1 : count <= 3 ? count : count === 4 ? 2 : count <= 6 ? 3 : 4;

export default {
    about: "a list as a field of tiles: pictures or text, in a grid or packed into columns",
    accepts: entities => !!listOf(entities),
    props: z.object({
        flow: z.enum(["grid", "masonry"]).default("grid"),
        /** 0 asks for the count's own answer; anything else is that many columns */
        columns: z.number().int().min(0).max(6).default(0),
        /** true fills each cell and clips what does not fit; false keeps every picture whole */
        crop: z.boolean().default(false),
    }).passthrough(),
    splittable: false,
    density: ["regular", "tight"],
    render: ctx => {
        const list = listOf(ctx.entities)!;
        const before = ctx.entities.slice(0, ctx.entities.indexOf(list)).map(e => ctx.html(e)).join("\n");
        const items = (list.node.children ?? []) as any[];

        const tiles = items.map((li, index) => {
            // an item whose paragraph is one image is a picture tile; its caption, if any, is
            // whatever follows in the same item
            const para = li.children?.find((c: any) => c.type === "paragraph");
            const picture = para && imageOf({ node: para } as never);
            if (picture) {
                // `- ![](x.png) Nocturne, 2025` is one paragraph: the image, then the caption.
                // Anything the item holds after that paragraph is caption too. Alt is the fallback.
                const beside = ctx.inline({ ...para, children: (para.children ?? []).filter((c: any) => c.type !== "image") }).trim();
                const after = (li.children ?? []).filter((c: any) => c !== para).map((c: any) => ctx.inline(c)).join(" ").trim();
                const caption = [beside, after].filter(Boolean).join(" ") || picture.alt;
                return `<li class="ainsi-tiles__tile ainsi-tiles__tile--picture">
        ${img(picture, "ainsi-tiles__image")}
        ${caption ? `<span class="ainsi-tiles__caption">${caption}</span>` : ""}
    </li>`;
            }
            const [title, body] = labelled(list, ctx.inline)[index] ?? ["", ""];
            return `<li class="ainsi-tiles__tile">
        ${title ? `<span class="ainsi-tiles__title">${title}</span>` : ""}
        <span class="ainsi-tiles__body">${body}</span>
    </li>`;
        });

        const columns = ctx.props.columns ? Number(ctx.props.columns) : columnsFor(tiles.length);
        /*
         * The height a picture may take, worked out here rather than in the stylesheet: a
         * browser will not divide by a custom property inside calc(), and silently keeps the
         * numerator, which is a field twice as tall as it should be and a clipped page. The
         * budget is the page's own content height in em, shared between the rows.
         */
        const rows = Math.max(1, Math.ceil(tiles.length / columns));
        const cap = (BUDGET / rows).toFixed(2);
        const tag = list.ordered ? "ol" : "ul";
        return `${before}
<${tag} class="ainsi-tiles" data-ainsi="tiles" data-flow="${ctx.props.flow ?? "grid"}" data-crop="${ctx.props.crop === true}" style="--ainsi-tiles-columns: ${columns}; --ainsi-tiles-cap: ${cap}em">
    ${tiles.join("\n    ")}
</${tag}>`;
    },
} satisfies ComponentDefinition;
