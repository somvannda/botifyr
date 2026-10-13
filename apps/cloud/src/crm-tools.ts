import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";

/**
 * CRM hand: log an interaction with a lead or customer to a per-lead note in the
 * company wiki (docs/virtual-workspace-implementation-plan.md §2.1). Append-only
 * and informational → not approval-gated. Outreach itself stays approval-gated;
 * this records what happened so the team shares one pipeline.
 */
export function createCrmTools(store: Store, userId: string, botId: string): ToolDefinition[] {
  /** The bot's company workspace, if it belongs to one. */
  const companyOf = async () => {
    const author = await store.getBot(botId).catch(() => null);
    if (!author?.workspace) return undefined;
    const workspaces = await store.listWorkspaces(userId).catch(() => []);
    return workspaces.find((entry) => entry.name === author.workspace);
  };

  const fileNameFor = (lead: string): string =>
    `CRM-${lead.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "lead"}.md`;

  return [
    {
      name: "crm.log_activity",
      description:
        "Log an interaction with a lead or customer (call, email, meeting) to the company CRM. Records {lead, activity, outcome, nextStep} in CRM-<lead>.md so the team sees the history before reaching out again. Use it after every outreach or reply.",
      parameters: {
        type: "object",
        properties: {
          lead: { type: "string", description: 'Lead/customer name, e.g. "Acme Corp".' },
          activity: { type: "string", description: 'What you did, e.g. "sent intro email".' },
          outcome: { type: "string", description: 'The result, e.g. "awaiting reply".' },
          nextStep: { type: "string", description: 'Optional next action, e.g. "follow up in 3 days".' },
        },
        required: ["lead", "activity", "outcome"],
      },
      run: async (args) => {
        const lead = String(args.lead ?? "")
          .trim()
          .slice(0, 100);
        const activity = String(args.activity ?? "")
          .trim()
          .slice(0, 300);
        const outcome = String(args.outcome ?? "")
          .trim()
          .slice(0, 300);
        const nextStep = String(args.nextStep ?? "")
          .trim()
          .slice(0, 200);
        if (!lead || !activity || !outcome) {
          return { ok: false, output: "lead, activity and outcome are required." };
        }
        const workspace = await companyOf();
        if (!workspace) {
          return { ok: false, output: "You don't have a company yet — create one first." };
        }
        const now = new Date().toISOString();
        const date = now.slice(0, 10);
        const name = fileNameFor(lead);
        const existing = (await store.listWorkspaceFiles(workspace.id)).find((file) => file.name === name);
        const entry = `## ${date}\n**Activity:** ${activity}  \n**Outcome:** ${outcome}  \n${nextStep ? `**Next step:** ${nextStep}\n` : ""}\n`;
        const content = (existing ? `${existing.content}\n${entry}` : `# ${lead}\n\n${entry}`).slice(0, 20_000);
        await store.upsertFile({
          id: existing?.id ?? randomUUID(),
          botId: existing?.botId ?? botId,
          userId,
          workspaceId: workspace.id,
          name,
          content,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        return { ok: true, output: `Logged "${activity}" for ${lead} in ${name}.` };
      },
    },
  ];
}
