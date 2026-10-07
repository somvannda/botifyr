import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
});
