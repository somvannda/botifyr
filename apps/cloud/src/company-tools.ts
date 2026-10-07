import type { ToolDefinition } from "@botifyr/agent-core";
import { analyzeSource, planCompany, type CompleteFn } from "./company.js";

/**
 * Agent tools that let a bot build a company from a conversation
 * (docs/company-workspace.md §16). Read-only: they understand and *propose*;
 * creating/hiring stays with the human CEO in the app. Exposed to the author bot.
 */
export function createCompanyTools(
  complete: CompleteFn,
  fetchText?: (url: string) => Promise<string>,
): ToolDefinition[] {
  const sourceOf = (args: Record<string, unknown>): { kind: "url" | "idea"; value: string } | null => {
    const value = String(args.value ?? "")
      .trim()
      .slice(0, 1000);
    if (!value) return null;
    return { kind: args.kind === "url" ? "url" : "idea", value };
  };

  return [
    {
      name: "company.analyze",
      description:
        "Understand a website or a business idea and return the company's DNA (industry, product, customers, stage, goal). Use this before designing an org chart.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["url", "idea"], description: "'url' for a website, 'idea' for a description." },
          value: { type: "string", description: "The website URL or the idea text." },
        },
        required: ["value"],
      },
      run: async (args) => {
        const source = sourceOf(args);
        if (!source) return { ok: false, output: "A website URL or an idea is required." };
        const { dna, notes } = await analyzeSource(source, { complete, fetchText });
        const noteLine = notes.length > 0 ? `\n\nNotes: ${notes.join(" ")}` : "";
        return { ok: true, output: `Company DNA:\n${JSON.stringify(dna, null, 2)}${noteLine}` };
      },
    },
    {
      name: "company.design",
      description:
        "Design a recommended company org chart (team, roles and rationale) from a website or an idea. Creates nothing — the human CEO reviews and hires in the app.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["url", "idea"], description: "'url' for a website, 'idea' for a description." },
          value: { type: "string", description: "The website URL or the idea text." },
          name: { type: "string", description: "Optional company name." },
        },
        required: ["value"],
      },
      run: async (args) => {
        const source = sourceOf(args);
        if (!source) return { ok: false, output: "A website URL or an idea is required." };
        const name = typeof args.name === "string" ? args.name.trim().slice(0, 60) : undefined;
        const { dna } = await analyzeSource(source, { complete, fetchText });
        const plan = await planCompany({ ...source, name, stage: dna.stage }, complete, dna);
        const team = plan.members
          .map((member) => `- ${member.emoji ?? "🤖"} ${member.name} — ${member.title} (${member.department})`)
          .join("\n");
        return {
          ok: true,
          output:
            `Proposed company: ${plan.name}\n${plan.mission}\n\n` +
            `Industry: ${dna.industry} · Stage: ${dna.stage}\n\n` +
            `Team (${plan.members.length}):\n${team}\n\n` +
            `Rationale: ${(plan.rationale ?? []).join(" ")}\n\n` +
            "Nothing has been created — open the app and hire the team when you're ready.",
        };
      },
    },
  ];
}
