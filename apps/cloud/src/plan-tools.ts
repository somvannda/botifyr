import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";

/**
 * Planning: record a concrete company plan — the goal, the approach, who owns
 * what, which channels we use and the metrics — into the company wiki
 * (PLAN.md), so the whole team works from one shared strategy.
 * docs/company-workspace.md §16 (plan).
 */
export function createPlanTools(store: Store, userId: string, botId: string): ToolDefinition[] {
  return [
    {
      name: "company.plan",
      description:
        "Write a concrete plan for a goal (e.g. \"grow sales\"): the approach, who owns each part, which channels we'll use, milestones and metrics. Saves it to the company wiki (PLAN.md). Use it before delegating a big push so the team shares one strategy.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "The goal, e.g. \"Grow sales\"." },
          plan: {
            type: "string",
            description:
              "The plan in markdown: approach, who does what, channels, milestones, metrics.",
          },
          company: { type: "string", description: "Company name (optional when you have one company)." },
        },
        required: ["goal", "plan"],
      },
      run: async (args) => {
        const author = await store.getBot(botId);
        const workspaces = await store.listWorkspaces(userId);
        const requested = String(args.company ?? "")
          .trim()
          .toLowerCase();
        const workspace =
          (author?.workspace
            ? workspaces.find((entry) => entry.name === author.workspace)
            : undefined) ??
          (requested
            ? workspaces.find((entry) => entry.name.toLowerCase() === requested)
            : workspaces.length === 1
              ? workspaces[0]
              : undefined);
        if (!workspace) {
          return { ok: false, output: "You don't have a company yet — create one first." };
        }
        const goal = String(args.goal ?? "")
          .trim()
          .slice(0, 200);
        const plan = String(args.plan ?? "")
          .trim()
          .slice(0, 20_000);
        if (!goal || !plan) return { ok: false, output: "A goal and a plan are required." };

        const now = new Date().toISOString();
        const existing = (await store.listWorkspaceFiles(workspace.id)).find(
          (file) => file.name === "PLAN.md",
        );
        await store.upsertFile({
          id: existing?.id ?? randomUUID(),
          botId: existing?.botId ?? botId,
          userId,
          workspaceId: workspace.id,
          name: "PLAN.md",
          content: `# Plan — ${goal}\n\n${plan}`.slice(0, 20_000),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        return {
          ok: true,
          output: `Saved the plan for "${goal}" to PLAN.md. Now delegate the first steps with company.delegate.`,
        };
      },
    },
  ];
}
