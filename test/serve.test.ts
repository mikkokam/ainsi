import { expect, test } from "bun:test";
import { serve } from "../src/serve";

/**
 * The reload channel. The studio's editor stays on "saving…" until a push arrives, so a push
 * that is dropped or held up behind a page that has gone away is a fault a person feels.
 */

const start = () => serve({
    port: 0,
    initial: "<html><body></body></html>",
    roots: [],
    rebuild: async () => "<html><body>built</body></html>",
});

/** opens the channel and reads it: the first frame is the server's comment, the next a push */
async function listen(url: string) {
    const response = await fetch(`${url}/__reload`);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const next = async () => decoder.decode((await reader.read()).value);
    expect(await next()).toContain(": open");
    return { next, stop: () => reader.cancel() };
}

test("a change reaches a listening page", async () => {
    const server = start();
    const page = await listen(server.url);

    server.changed("", "deck.md");
    expect(await page.next()).toContain("data: reload");

    await page.stop();
    await server.stop();
});

test("a page that went away does not hold up the one still there", async () => {
    const server = start();
    const gone = await listen(server.url);
    await gone.stop();

    const page = await listen(server.url);
    server.changed("", "deck.md");
    expect(await page.next()).toContain("data: reload");

    await page.stop();
    await server.stop();
});
