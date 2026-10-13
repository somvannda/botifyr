import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";

/**
 * Finance hand: read the company's spend — token usage, the workspace budget, the
 * wallet balance, and recent charges (docs/virtual-workspace-implementation-plan.md
 * §2.2). Read-only → not approval-gated. It reports the numbers that exist; it
 * never invents one.
 */
export function createFinanceTools(store: Store, userId: string, botId: string): ToolDefinition[] {
  /** The bot's company workspace, if it belongs to one. */
  const companyOf = async () => {
    const author = await store.getBot(botId).catch(() => null);
    if (!author?.workspace) return undefined;
    const workspaces = await store.listWorkspaces(userId).catch(() => []);
    return workspaces.find((entry) => entry.name === author.workspace);
  };

  const PERIOD_DAYS: Record<string, number> = {
    last_7_days: 7,
    last_30_days: 30,
    this_month: 30,
    all_time: 3650,
  };

  return [
    {
      name: "finance.ledger",
      description:
        "Read the company's spend: token usage for the period, the workspace token budget, the wallet balance, and recent charges. Use it to report the numbers honestly; never estimate a figure you can't read.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["last_7_days", "last_30_days", "this_month", "all_time"],
            description: "The window to summarise (default last_30_days).",
          },
        },
      },
      run: async (args) => {
        const workspace = await companyOf();
        if (!workspace) {
          return { ok: false, output: "You don't have a company yet — create one first." };
        }
        const period = String(args.period ?? "last_30_days");
        const days = PERIOD_DAYS[period] ?? 30;
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const [usage, budget, wallet, ledger] = await Promise.all([
          store.usageSince(userId, since).catch(() => ({ tokens: 0, requests: 0 })),
          store.getWorkspaceBudget(workspace.id).catch(() => null),
          store.getWallet(userId).catch(() => null),
          store.listLedger(userId, 20).catch(() => []),
        ]);
        const lines = [
          `Ledger (${period}):`,
          `- Tokens used: ${usage.tokens.toLocaleString()} across ${usage.requests} request(s).`,
          budget
            ? `- Company budget: ${budget.usedTokens.toLocaleString()} / ${budget.limitTokens.toLocaleString()} tokens (0 = no cap).`
            : "- Company budget: not set.",
          wallet ? `- Wallet balance: $${(wallet.balanceCents / 100).toFixed(2)}.` : "- Wallet balance: unavailable.",
        ];
        const recent = ledger.slice(0, 10);
        if (recent.length > 0) {
          lines.push("Recent charges:");
          for (const entry of recent) {
            const amount = entry.amountCents / 100;
            const shown = amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
            const note = entry.note ? ` — ${entry.note}` : "";
            lines.push(`- ${entry.kind}: ${shown}${note}`);
          }
        }
        return { ok: true, output: lines.join("\n") };
      },
    },
  ];
}
