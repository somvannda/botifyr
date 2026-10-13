import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";

/**
 * The company's decision log: an append-only record of what was decided, why, and
 * by whom (docs/virtual-workspace-implementation-plan.md §0.5), so a long-lived
 * company keeps its reasoning instead of re-litigating it. Written to
 * `DECISIONS.md` in the shared wiki. Informational and append-only → not
 * approval-gated.
 */
export function createDecisionTools(store: Store, userId: string, botId: string): ToolDefinition[] {
  /** The bot's company workspace, if it belongs to one. */
  const companyOf = async () => {
    const author = await store.getBot(botId).catch(() => null);
    if (!author?.workspace) return undefined;
    const workspaces = await store.listWorkspaces(userId).catch(() => []);
    return workspaces.find((entry) => entry.name === author.workspace);
  };

  return [
    {
      name: "company.decide",
      description:
        "Record a significant decision in the company log — a direction change, a key hire, starting or abandoning a mission, or a product call. Appends {what, why, who} to DECISIONS.md so the team remembers the reasoning. Use it whenever you make a choice others will need to understand later.",
      parameters: {
        type: "object",
        properties: {
          decision: { type: "string", description: "What was decided (one sentence)." },
          reasoning: { type: "string", description: "Why — the evidence or trade-off behind it." },
          owner: { type: "string", description: "Who decided: your role title or \"CEO\". Optional." },
        },
        required: ["decision", "reasoning"],
      },
      run: async (args) => {
        const decision = String(args.decision ?? "")
          .trim()
          .slice(0, 200);
        const reasoning = String(args.reasoning ?? "")
          .trim()
          .slice(0, 600);
        if (!decision || !reasoning) {
          return { ok: false, output: "A decision and its reasoning are required." };
        }
        const workspace = await companyOf();
        if (!workspace) {
          return { ok: false, output: "You don't have a company yet — create one first." };
        }
        const author = await store.getBot(botId).catch(() => null);
        const owner = String(args.owner ?? "")
          .trim()
          .slice(0, 60) || author?.name || "CEO";
        const now = new Date().toISOString();
        const date = now.slice(0, 10);
        const existing = (await store.listWorkspaceFiles(workspace.id)).find(
          (file) => file.name === "DECISIONS.md",
        );
        const entry = `## ${date} — ${decision}\n**Owner:** ${owner}  \n**Reasoning:** ${reasoning}\n\n`;
        const content = (existing ? `${existing.content}\n${entry}` : `# Company Decisions\n\n${entry}`).slice(
          0,
          60_000,
        );
        await store.upsertFile({
          id: existing?.id ?? randomUUID(),
          botId: existing?.botId ?? botId,
          userId,
          workspaceId: workspace.id,
          name: "DECISIONS.md",
          content,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        return { ok: true, output: `Recorded the decision in DECISIONS.md.` };
      },
    },
  ];
}
