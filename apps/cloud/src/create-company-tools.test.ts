import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createCompanyMakerTools } from "./create-company-tools.js";

describe("company.create", () => {
  const ctx = { workspaceDir: ".", log: () => {} };
  const now = new Date().toISOString();
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

  it("creates a company with the founder as CEO, its team, wiki and board", async () => {
    const store = new MemoryStore();
    await store.createBot({
      id: "founder",
      userId: "u1",
      name: "Botifyr",
      emoji: "🤖",
      scheme: 0,
      instructions: "",
      sessionId: "fs",
      createdAt: now,
    });
    const [tool] = createCompanyMakerTools(store, "u1", "founder", complete, async () => "<h1>Acme POS</h1>");
    expect(tool!.requiresApproval).toBe(true);

    const result = await tool!.run({ kind: "url", value: "https://acme.com" }, ctx);
    expect(result.ok).toBe(true);

    const workspaces = await store.listWorkspaces("u1");
    const workspace = workspaces[0]!;
    expect(workspace.name).toBe("Acme");
    // The Founder bot becomes the company CEO (chair).
    expect(workspace.ceoBotId).toBe("founder");
    expect((await store.getBot("founder"))?.workspace).toBe("Acme");

    const roles = await store.listBotRoles(workspace.id);
    expect(roles.map((role) => role.title).sort()).toEqual(["CEO", "CTO"]);

    const files = await store.listFiles("founder");
    expect(files.map((file) => file.name)).toEqual(
      expect.arrayContaining(["BRIEF.md", "OKRS.md", "BACKLOG.md"]),
    );

    expect((await store.listWorkItems(workspace.id)).length).toBeGreaterThan(0);
  });

  it("rejects an empty source", async () => {
    const store = new MemoryStore();
    const [tool] = createCompanyMakerTools(store, "u1", undefined, complete);
    const result = await tool!.run({ value: "" }, ctx);
    expect(result.ok).toBe(false);
  });
});
