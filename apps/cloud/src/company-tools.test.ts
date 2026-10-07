import { describe, expect, it } from "vitest";
import { createCompanyTools } from "./company-tools.js";

describe("company builder tools", () => {
  const tools = createCompanyTools(
    async ({ system }) =>
      system.includes("analyse a business")
        ? JSON.stringify({ industry: "Cloud POS", stage: "launched", product: { features: ["POS"] } })
        : JSON.stringify({ name: "Acme", members: [{ name: "Ada", title: "CEO", isChair: true }] }),
    async () => "<title>Acme POS</title><h1>Cloud POS</h1>",
  );
  const ctx = { workspaceDir: ".", log: () => {} };
  const run = (name: string, args: Record<string, unknown>) =>
    tools.find((tool) => tool.name === name)!.run(args, ctx);

  it("exposes the analyze and design tools", () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual(["company.analyze", "company.design"]);
  });

  it("company.analyze returns the DNA", async () => {
    const result = await run("company.analyze", { kind: "url", value: "https://acme.com" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Cloud POS");
  });

  it("company.design proposes a team and creates nothing", async () => {
    const result = await run("company.design", { kind: "url", value: "https://acme.com" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Acme");
    expect(result.output.toLowerCase()).toContain("nothing has been created");
  });

  it("rejects an empty source", async () => {
    const result = await run("company.analyze", { value: "" });
    expect(result.ok).toBe(false);
  });
});
