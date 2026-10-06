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

function downloadTool(backend: ShellBackend): ToolDefinition {
  const tool = createMediaTools(backend, "/downloads/t1").tools.find(
    (entry) => entry.name === "youtube.download",
  );
  if (!tool) throw new Error("youtube.download not found");
  return tool;
}

const ctx = { workspaceDir: "/workspace", log: () => {} };

describe("youtube.download", () => {
  it("downloads a batch of urls in one call with unique filenames", async () => {
    const { backend, commands } = fakeBackend();
    const result = await downloadTool(backend).run(
      {
        urls: ["https://youtu.be/a", "https://youtu.be/b"],
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(commands).toHaveLength(1);
    const command = commands[0] ?? "";
    expect(command).toContain("https://youtu.be/a");
    expect(command).toContain("https://youtu.be/b");
    expect(command).toContain("%(title)s [%(id)s].%(ext)s");
    expect(command).not.toContain("rm -f");
  });

  it("accepts a single url", async () => {
    const { backend, commands } = fakeBackend();
    const result = await downloadTool(backend).run({ url: "https://youtu.be/a", audio_only: true }, ctx);
    expect(result.ok).toBe(true);
    expect(commands[0]).toContain("-x --audio-format mp3");
  });

  it("rejects when no valid url is given", async () => {
    const { backend, commands } = fakeBackend();
    const result = await downloadTool(backend).run({ url: "not-a-url" }, ctx);
    expect(result.ok).toBe(false);
    expect(commands).toHaveLength(0);
  });
});
