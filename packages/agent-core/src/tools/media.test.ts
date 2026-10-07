import { describe, expect, it } from "vitest";
import { createMediaTools } from "./media.js";
import type { ShellBackend } from "./shell.js";
import type { ToolDefinition } from "../types.js";

function fakeBackend(): { backend: ShellBackend; commands: string[] } {
  const commands: string[] = [];
  const ok = { ok: true, output: "ok" };
  const backend: ShellBackend = {
    async exec(command) {
      commands.push(command);
      return ok;
    },
    async readFile() {
      return ok;
    },
    async writeFile() {
      return ok;
    },
    async listFiles() {
      return ok;
    },
    async close() {},
  };
  return { backend, commands };
}

function downloadTool(
  backend: ShellBackend,
  options?: { quality?: number; audioOnly?: boolean },
): ToolDefinition {
  const tool = createMediaTools(backend, "/downloads/t1", undefined, options).tools.find(
    (entry) => entry.name === "youtube.download",
  );
  if (!tool) throw new Error("youtube.download not found");
  return tool;
}

const ctx = { workspaceDir: "/workspace", log: () => {} };

describe("youtube.download", () => {
  it("downloads each url in a batch with unique filenames (no overwrite)", async () => {
    const { backend, commands } = fakeBackend();
    const result = await downloadTool(backend).run(
      { urls: ["https://youtu.be/a", "https://youtu.be/b"] },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(commands.some((command) => command.includes("https://youtu.be/a"))).toBe(true);
    expect(commands.some((command) => command.includes("https://youtu.be/b"))).toBe(true);
    expect(commands.some((command) => command.includes("%(title)s [%(id)s].%(ext)s"))).toBe(true);
    expect(commands.some((command) => command.includes("rm -f"))).toBe(false);
  });

  it("uses the audio default", async () => {
    const { backend, commands } = fakeBackend();
    await downloadTool(backend, { audioOnly: true }).run({ url: "https://youtu.be/a" }, ctx);
    expect(commands.some((command) => command.includes("--audio-format mp3"))).toBe(true);
  });

  it("uses the quality default when none is given", async () => {
    const { backend, commands } = fakeBackend();
    await downloadTool(backend, { quality: 480 }).run({ url: "https://youtu.be/a" }, ctx);
    expect(commands.some((command) => command.includes("height<=480"))).toBe(true);
    // Falls back to the best single file (direct MP4s have no separate streams).
    expect(commands.some((command) => command.includes("b[height<=480]/b"))).toBe(true);
  });

  it("writes subtitles next to the video when enabled", async () => {
    const { backend, commands } = fakeBackend();
    const tool = createMediaTools(backend, "/d", undefined, {
      subtitles: true,
      subtitleLangs: "en,km",
    }).tools.find((entry) => entry.name === "youtube.download");
    if (!tool) throw new Error("youtube.download not found");
    const result = await tool.run({ url: "https://youtu.be/a" }, ctx);

    expect(result.ok).toBe(true);
    expect(commands.some((entry) => entry.includes("--write-auto-subs"))).toBe(true);
    expect(commands.some((entry) => entry.includes("--sub-langs 'en,km'"))).toBe(true);
  });

  it("does not write subtitles by default", async () => {
    const { backend, commands } = fakeBackend();
    await downloadTool(backend).run({ url: "https://youtu.be/a" }, ctx);
    expect(commands.some((entry) => entry.includes("--write-subs"))).toBe(false);
  });

  it("reports only the files it created", async () => {
    let listing = "old [zzz].mp4\n";
    const backend: ShellBackend = {
      async exec(command) {
        if (command.startsWith("ls -1")) return { ok: true, output: listing };
        if (command.startsWith("yt-dlp")) {
          listing = "old [zzz].mp4\nclip [abc].mp4\nclip [abc].en.srt\n";
          return { ok: true, output: "ok" };
        }
        return { ok: true, output: "" };
      },
      async readFile() {
        return { ok: true, output: "" };
      },
      async writeFile() {
        return { ok: true, output: "" };
      },
      async listFiles() {
        return { ok: true, output: "" };
      },
      async close() {},
    };
    const tool = createMediaTools(backend, "/d").tools.find((entry) => entry.name === "youtube.download");
    if (!tool) throw new Error("youtube.download not found");
    const result = await tool.run({ url: "https://youtu.be/a" }, ctx);

    expect(result.output).toContain("Saved 2 file(s)");
    expect(result.output).toContain("clip [abc].en.srt");
    expect(result.output).not.toContain("old [zzz].mp4");
  });

  it("searches YouTube via yt-dlp", async () => {
    const { backend, commands } = fakeBackend();
    const tool = createMediaTools(backend, "/d").tools.find((entry) => entry.name === "youtube.search");
    if (!tool) throw new Error("youtube.search not found");
    const result = await tool.run({ query: "heng pitu", count: 20 }, ctx);

    expect(result.ok).toBe(true);
    const command = commands[0] ?? "";
    expect(command).toContain("ytsearch20:heng pitu");
    expect(command).toContain("--flat-playlist");
  });

  it("searches and downloads in one step", async () => {
    const commands: string[] = [];
    const ok = { ok: true, output: "ok" };
    const backend: ShellBackend = {
      async exec(command) {
        commands.push(command);
        if (command.includes("ytsearch")) {
          return {
            ok: true,
            output: "https://www.youtube.com/watch?v=aaa\nhttps://www.youtube.com/watch?v=bbb\n",
          };
        }
        return ok;
      },
      async readFile() {
        return ok;
      },
      async writeFile() {
        return ok;
      },
      async listFiles() {
        return ok;
      },
      async close() {},
    };
    const tool = createMediaTools(backend, "/d").tools.find(
      (entry) => entry.name === "youtube.download_search",
    );
    if (!tool) throw new Error("youtube.download_search not found");
    const result = await tool.run({ query: "heng pitu", count: 2 }, ctx);

    expect(result.ok).toBe(true);
    expect(commands.some((command) => command.includes("ytsearch2:heng pitu"))).toBe(true);
    expect(commands.some((command) => command.includes("watch?v=aaa"))).toBe(true);
    expect(commands.some((command) => command.includes("watch?v=bbb"))).toBe(true);
  });

  it("expands a channel URL into individual videos", async () => {
    const commands: string[] = [];
    const ok = { ok: true, output: "ok" };
    const backend: ShellBackend = {
      async exec(command) {
        commands.push(command);
        if (command.includes("--flat-playlist")) {
          return {
            ok: true,
            output: "https://www.youtube.com/watch?v=aaa\nhttps://www.youtube.com/watch?v=bbb\n",
          };
        }
        return ok;
      },
      async readFile() {
        return ok;
      },
      async writeFile() {
        return ok;
      },
      async listFiles() {
        return ok;
      },
      async close() {},
    };
    const tool = createMediaTools(backend, "/d").tools.find((entry) => entry.name === "youtube.download");
    if (!tool) throw new Error("youtube.download not found");
    await tool.run({ url: "https://www.youtube.com/channel/UCabc" }, ctx);

    expect(commands.some((command) => command.includes("--flat-playlist"))).toBe(true);
    expect(commands.some((command) => command.includes("watch?v=aaa"))).toBe(true);
    expect(commands.some((command) => command.includes("watch?v=bbb"))).toBe(true);
  });

  it("rejects when no valid url is given", async () => {
    const { backend, commands } = fakeBackend();
    const result = await downloadTool(backend).run({ url: "not-a-url" }, ctx);
    expect(result.ok).toBe(false);
    expect(commands).toHaveLength(0);
  });

  it("falls back to a JSON-escaped stream URL when yt-dlp can't handle the page", async () => {
    const commands: string[] = [];
    const backend: ShellBackend = {
      async exec(command) {
        commands.push(command);
        if (command.includes("grep -oE")) {
          return { ok: true, output: "https:\\/\\/cdn.example.com\\/hls\\/master.m3u8\n" };
        }
        if (
          command.startsWith("yt-dlp") &&
          command.includes("example.com/page") &&
          !command.includes("--referer")
        ) {
          return { ok: false, output: "ERROR: Unsupported URL" };
        }
        return { ok: true, output: "ok" };
      },
      async readFile() {
        return { ok: true, output: "" };
      },
      async writeFile() {
        return { ok: true, output: "" };
      },
      async listFiles() {
        return { ok: true, output: "" };
      },
      async close() {},
    };
    const tool = createMediaTools(backend, "/d").tools.find((entry) => entry.name === "youtube.download");
    if (!tool) throw new Error("youtube.download not found");
    const result = await tool.run({ url: "https://example.com/page" }, ctx);

    expect(result.ok).toBe(true);
    expect(commands.some((command) => command.includes("cdn.example.com/hls/master.m3u8"))).toBe(true);
    expect(commands.some((command) => command.includes("--referer 'https://example.com/page'"))).toBe(true);
  });

  it("uses an approved recipe (with its headers) when yt-dlp can't handle the page", async () => {
    const commands: string[] = [];
    const backend: ShellBackend = {
      async exec(command) {
        commands.push(command);
        if (command.includes("grep -oE")) {
          return { ok: true, output: "https:\\/\\/cdn.example.com\\/recipe\\/master.m3u8\n" };
        }
        if (
          command.startsWith("yt-dlp") &&
          command.includes("example.com/page") &&
          !command.includes("--referer")
        ) {
          return { ok: false, output: "ERROR: Unsupported URL" };
        }
        return { ok: true, output: "ok" };
      },
      async readFile() {
        return { ok: true, output: "" };
      },
      async writeFile() {
        return { ok: true, output: "" };
      },
      async listFiles() {
        return { ok: true, output: "" };
      },
      async close() {},
    };
    const tool = createMediaTools(backend, "/d", undefined, {
      getRecipe: async () => ({
        pattern: 'https?:[^" ]+\\.m3u8',
        headers: { Referer: "https://example.com/" },
      }),
    }).tools.find((entry) => entry.name === "youtube.download");
    if (!tool) throw new Error("youtube.download not found");
    const result = await tool.run({ url: "https://example.com/page" }, ctx);

    expect(result.ok).toBe(true);
    // The recipe's headers were sent, and the matched stream URL was downloaded.
    expect(commands.some((command) => command.includes("Referer: https://example.com/"))).toBe(true);
    expect(commands.some((command) => command.includes("cdn.example.com/recipe/master.m3u8"))).toBe(true);
  });

  it("downloads the URL a browser sniff returns for an SPA page", async () => {
    const commands: string[] = [];
    const backend: ShellBackend = {
      async exec(command) {
        commands.push(command);
        if (
          command.startsWith("yt-dlp") &&
          command.includes("example.com/spa") &&
          !command.includes("--referer")
        ) {
          return { ok: false, output: "ERROR: Unsupported URL" };
        }
        return { ok: true, output: "ok" };
      },
      async readFile() {
        return { ok: true, output: "" };
      },
      async writeFile() {
        return { ok: true, output: "" };
      },
      async listFiles() {
        return { ok: true, output: "" };
      },
      async close() {},
    };
    const tool = createMediaTools(backend, "/d", undefined, {
      sniffMedia: async () => "https://v3.example.com/hls/video.m3u8?expiredTime=1&tul=abc",
    }).tools.find((entry) => entry.name === "youtube.download");
    if (!tool) throw new Error("youtube.download not found");
    const result = await tool.run({ url: "https://example.com/spa" }, ctx);

    expect(result.ok).toBe(true);
    expect(commands.some((command) => command.includes("v3.example.com/hls/video.m3u8"))).toBe(true);
    expect(commands.some((command) => command.includes("--referer 'https://example.com/spa'"))).toBe(true);
  });

  it("media.sniff returns the media URL a page loads", async () => {
    const backend: ShellBackend = {
      async exec() {
        return { ok: true, output: "" };
      },
      async readFile() {
        return { ok: true, output: "" };
      },
      async writeFile() {
        return { ok: true, output: "" };
      },
      async listFiles() {
        return { ok: true, output: "" };
      },
      async close() {},
    };
    const tool = createMediaTools(backend, "/d", undefined, {
      sniffMedia: async (url) => (url.includes("spa") ? "https://cdn.example.com/master.m3u8" : null),
    }).tools.find((entry) => entry.name === "media.sniff");
    if (!tool) throw new Error("media.sniff not found");

    const found = await tool.run({ url: "https://example.com/spa" }, ctx);
    expect(found.ok).toBe(true);
    expect(found.output).toContain("https://cdn.example.com/master.m3u8");

    const missing = await tool.run({ url: "https://example.com/other" }, ctx);
    expect(missing.ok).toBe(false);
  });

  it("media.sniff explains when sniffing is unavailable", async () => {
    const backend: ShellBackend = {
      async exec() {
        return { ok: true, output: "" };
      },
      async readFile() {
        return { ok: true, output: "" };
      },
      async writeFile() {
        return { ok: true, output: "" };
      },
      async listFiles() {
        return { ok: true, output: "" };
      },
      async close() {},
    };
    const tool = createMediaTools(backend, "/d").tools.find((entry) => entry.name === "media.sniff");
    if (!tool) throw new Error("media.sniff not found");
    const result = await tool.run({ url: "https://example.com/spa" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("isn't available");
  });
});

describe("youtube.info", () => {
  it("prints a friendly metadata summary instead of raw JSON", async () => {
    const { backend, commands } = fakeBackend();
    const tool = createMediaTools(backend, "/d").tools.find((entry) => entry.name === "youtube.info");
    if (!tool) throw new Error("youtube.info not found");
    const result = await tool.run({ url: "https://youtu.be/abc" }, ctx);

    expect(result.ok).toBe(true);
    expect(commands.some((entry) => entry.includes("--print"))).toBe(true);
    expect(commands.some((entry) => entry.includes("%(title)s"))).toBe(true);
    expect(commands.some((entry) => entry.includes("https://youtu.be/abc"))).toBe(true);
    expect(commands.some((entry) => entry.includes("--dump-single-json"))).toBe(false);
  });

  it("rejects a non-http url", async () => {
    const { backend } = fakeBackend();
    const tool = createMediaTools(backend, "/d").tools.find((entry) => entry.name === "youtube.info");
    if (!tool) throw new Error("youtube.info not found");
    const result = await tool.run({ url: "not-a-url" }, ctx);
    expect(result.ok).toBe(false);
  });
});
