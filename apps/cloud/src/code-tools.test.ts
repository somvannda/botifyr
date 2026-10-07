import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CodeRepo } from "@botifyr/shared";
import { createCodeTools } from "./code-tools.js";

const ctx = { workspaceDir: ".", log: () => {} };

async function repoFixture(): Promise<CodeRepo> {
  const dir = await mkdtemp(path.join(tmpdir(), "botifyr-repo-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "src", "index.ts"), "export const answer = 42;\n// secret\n");
  await writeFile(path.join(dir, "README.md"), "# Demo\nhello world\n");
  return { id: "r1", name: "demo", path: dir, createdAt: new Date().toISOString() };
}

describe("code tools (read-only)", () => {
  it("lists, searches and reads within the repo", async () => {
    const repo = await repoFixture();
    const tools = createCodeTools([repo]);
    const find = (name: string) => tools.find((tool) => tool.name === name)!;

    const tree = await find("code.tree").run({}, ctx);
    expect(tree.ok).toBe(true);
    expect(tree.output).toContain("src/");
    expect(tree.output).toContain("README.md");

    const search = await find("code.search").run({ query: "answer" }, ctx);
    expect(search.ok).toBe(true);
    expect(search.output).toContain("src/index.ts:1");

    const read = await find("code.read").run({ path: "src/index.ts" }, ctx);
    expect(read.ok).toBe(true);
    expect(read.output).toContain("answer = 42");
  });

  it("refuses paths that escape the repo", async () => {
    const repo = await repoFixture();
    const tools = createCodeTools([repo]);
    const read = tools.find((tool) => tool.name === "code.read")!;
    const result = await read.run({ path: "../../etc/passwd" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("asks which repo when several are connected", async () => {
    const a = await repoFixture();
    const b = await repoFixture();
    const tools = createCodeTools([
      { ...a, name: "a" },
      { ...b, name: "b" },
    ]);
    const tree = tools.find((tool) => tool.name === "code.tree")!;
    const result = await tree.run({}, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Which repo");
  });

  it("stages proposed changes in the work dir and jails the path", async () => {
    const repo = await repoFixture();
    const workDir = await mkdtemp(path.join(tmpdir(), "botifyr-work-"));
    const tools = createCodeTools([repo], { workDir, workspaceId: "ws1" });
    const apply = tools.find((tool) => tool.name === "code.apply")!;
    expect(apply.requiresApproval).toBe(true);

    const ok = await apply.run({ path: "src/new.ts", content: "export const x = 1;" }, ctx);
    expect(ok.ok).toBe(true);
    const written = await readFile(path.join(workDir, "ws1", "demo", "src", "new.ts"), "utf8");
    expect(written).toContain("export const x = 1");

    const escape = await apply.run({ path: "../../evil.ts", content: "x" }, ctx);
    expect(escape.ok).toBe(false);
  });

  it("writes a codebase map to the wiki", async () => {
    const repo = await repoFixture();
    const saved: Array<{ name: string; content: string }> = [];
    const tools = createCodeTools([repo], {
      saveWikiFile: async (name, content) => {
        saved.push({ name, content });
      },
    });
    const map = tools.find((tool) => tool.name === "code.map")!;
    const result = await map.run({}, ctx);
    expect(result.ok).toBe(true);
    expect(saved[0]?.name).toBe("CODEBASE.md");
    expect(saved[0]?.content).toContain("- src");
    expect(saved[0]?.content).toContain(".ts");
  });
});
