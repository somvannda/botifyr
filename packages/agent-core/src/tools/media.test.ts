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
        if (command.startsWith("yt-dlp") && command.includes("example.com/page")) {
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
  });
});
