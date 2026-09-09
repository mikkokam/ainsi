import { spawn } from "bun";

/**
 * Start `ainsi` as a child process and wait for the URL it prints.
 *
 * The port is left to the OS (`--port 0`) and read back off stdout rather than chosen here:
 * picking a free port and then handing it over loses the race against anything else on the
 * machine between the two steps.
 *
 * The studio stays a subprocess even though this main process is Bun and could import the
 * engine directly. The engine discovers components and themes by reading its own folder and
 * transpiling what it finds, which a bundled app has no equivalent of; a child process run
 * from the checkout is what keeps the shell honest about being a dev tool.
 */

export interface Studio {
    readonly url: string;
    stop(): void;
}

/** the studio prints one line naming where it is; nothing else on stdout looks like this */
const URL_LINE = /studio on (\S+)/;
const GIVE_UP = 20_000;

export interface StudioOptions {
    /** the ainsi checkout to run */
    repo: string;
    /** the bun to run it with, absolute: a window app inherits no useful PATH */
    bun: string;
    /** the deck to open, or undefined to land on the studio's chooser */
    deck?: string;
    /** what the studio's file browser may reach: its working directory */
    root: string;
}

export async function studio({ repo, bun, deck, root }: StudioOptions): Promise<Studio> {
    const child = spawn({
        cmd: [bun, `${repo}/src/cli.ts`, ...(deck ? [deck] : []), "--port", "0"],
        cwd: root,
        // the studio refuses to start without a terminal, so an agent piping it gets a file
        // rather than a server it cannot see. This says who is asking.
        env: { ...process.env, AINSI_HOST: "electrobun" },
        // the studio watches this pipe and stops when it closes, so a shell that dies without
        // running its exit handler does not leave a server nobody can reach
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
    });

    const stop = () => child.kill();
    const reader = child.stdout.getReader();
    const url = await Promise.race([firstUrl(reader), Bun.sleep(GIVE_UP).then(() => undefined)]);
    reader.releaseLock();
    if (!url) {
        stop();
        throw new Error(`no studio after ${GIVE_UP / 1000}s; run \`${bun} ${repo}/src/cli.ts\` to see why`);
    }
    // the rest of the studio's output is its own log, and it goes where every other log goes
    void child.stdout.pipeTo(new WritableStream({ write: chunk => void process.stdout.write(chunk) }));
    return { url, stop };
}

async function firstUrl(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string | undefined> {
    const decoder = new TextDecoder();
    let seen = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return undefined;
        seen += decoder.decode(value, { stream: true });
        process.stdout.write(value);
        const found = URL_LINE.exec(seen);
        if (found) return found[1];
    }
}
