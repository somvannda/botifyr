import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";
import { seedQuest } from "./company-seed.js";

/**
 * The chair proposes the company's next quest (mission); the human CEO reviews
 * and starts it (docs/company-quests.md §6). Proposing changes no capability and
 * spends nothing until the CEO activates it, so it is not approval-gated — but
 * at most one quest may be active at a time.
 */
export function createQuestTools(store: Store, userId: string, botId: string): ToolDefinition[] {
  return [
    {
      name: "company.propose",
      description:
        "Propose the company's next quest (a mission with a clear objective). The human CEO reviews and starts it in the Company HQ. Propose at most one quest, and only when there is no active quest.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: 'A short mission title, e.g. "Launch the cloud POS MVP".' },
          objective: { type: "string", description: "What the quest delivers, and how you'll know it's done." },
          acceptance: {
            type: "array",
            items: { type: "string" },
            description: "Optional checklist the CEO can verify before marking the quest done.",
          },
          company: { type: "string", description: "Company name (optional when you have one company)." },
        },
        required: ["title", "objective"],
      },
      requiresApproval: false,
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
          return {
            ok: false,
            output:
              workspaces.length === 0
                ? "You don't have a company yet — create one first."
                : `Which company? ${workspaces.map((entry) => entry.name).join(", ")}.`,
          };
        }

        const title = String(args.title ?? "")
          .trim()
          .slice(0, 120);
        if (!title) return { ok: false, output: "A quest title is required." };
        const objective = String(args.objective ?? "")
          .trim()
          .slice(0, 500);
        if (!objective) return { ok: false, output: "A quest objective is required." };

        const existing = await store.listQuests(workspace.id);
        if (existing.some((quest) => quest.status === "active")) {
          return {
            ok: false,
            output: "There's already an active quest — finish it before proposing the next one.",
          };
        }

        const acceptance = Array.isArray(args.acceptance)
          ? args.acceptance
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.slice(0, 160))
              .slice(0, 8)
          : undefined;

        await seedQuest(store, {
          userId,
          workspaceId: workspace.id,
          dna: workspace.dna,
          quest: {
            title,
            objective,
            acceptance,
            directionId: workspace.directionId,
            status: "proposed",
          },
        });
        return {
          ok: true,
          output: `Proposed quest "${title}". Open the Company HQ → Needs you to review and start it.`,
        };
      },
    },
  ];
}
