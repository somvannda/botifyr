import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createCompanyMakerTools } from "./create-company-tools.js";

describe("company.create", () => {
  const ctx = { workspaceDir: ".", log: () => {} };
  const complete = async ({ system }: { system: string }) =>
    system.includes("analyse a business")
      ? JSON.stringify({ industry: "Cloud POS", stage: "launched" })
      : JSON.stringify({
          name: "Acme",
          members: [
            { name: "Ada", title: "CEO", department: "exec", isChair: true },
            { name: "Dev", title: "CTO", department: "engineering" },
          ],
        });

  it("creates a company with its team, wiki and board", async () => {
    const store = new MemoryStore();
    const [tool] = createCompanyMakerTools(store, "u1", complete, async () => "<h1>Acme POS</h1>");
    expect(tool!.requiresApproval).toBe(true);

    const result = await tool!.run({ kind: "url", value: "https://acme.com" }, ctx);
    expect(result.ok).toBe(true);

    const workspaces = await store.listWorkspaces("u1");
    expect(workspaces[0]?.name).toBe("Acme");
    const workspace = workspaces[0]!;
    expect(workspace.ceoBotId).toBeDefined();

    const roles = await store.listBotRoles(workspace.id);
    expect(roles.map((role) => role.title).sort()).toEqual(["CEO", "CTO"]);

    const files = await store.listFiles(workspace.ceoBotId!);
    expect(files.map((file) => file.name)).toEqual(
      expect.arrayContaining(["BRIEF.md", "OKRS.md", "BACKLOG.md"]),
    );

    const work = await store.listWorkItems(workspace.id);
    expect(work.length).toBeGreaterThan(0);
  });

  it("rejects an empty source", async () => {
    const store = new MemoryStore();
    const [tool] = createCompanyMakerTools(store, "u1", complete);
    const result = await tool!.run({ value: "" }, ctx);
    expect(result.ok).toBe(false);
  });
});
