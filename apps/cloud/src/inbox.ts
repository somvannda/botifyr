import type {
  CapabilityGrant,
  InboxItem,
  InboxKind,
  Quest,
  Task,
  WorkItem,
  WorkspaceInbox,
} from "@botifyr/shared";

/**
 * Build the ranked "what needs the CEO" inbox for a company (docs/product-plan.md
 * §3). This is a **pure** function: it takes the atom records and returns a
 * ranked, explainable list, so it is unit-testable without a store or HTTP.
 *
 * Ranking (loudest first): a high-risk approval, then medium approvals, trust
 * demotions and blocked work, then a proposed quest (agents propose, the CEO
 * disposes — a proposal can wait).
 */

const EMPTY_COUNTS: Record<InboxKind, number> = {
  approval: 0,
  trust_review: 0,
  blocked_work: 0,
  quest_proposed: 0,
};

export interface InboxInput {
  /** Tasks across the company's employees (already scoped to the workspace). */
  tasks: Task[];
  quests: Quest[];
  workItems: WorkItem[];
  grants: CapabilityGrant[];
  /** Optional botId → role title, so a blocked item can name who is blocked. */
  roleTitleByBot?: Map<string, string>;
  /** Max items to return (default 50). */
  limit?: number;
}

function approvalUrgency(risk: string | undefined): 1 | 2 | 3 {
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

export function buildInbox(input: InboxInput): WorkspaceInbox {
  const items: InboxItem[] = [];

  // 1. Pending approvals — the consequential actions the agent stopped on.
  for (const task of input.tasks) {
    const approval = task.approval;
    if (task.status !== "awaiting_approval" || approval?.status !== "pending") continue;
    items.push({
      id: `approval:${approval.id}`,
      kind: "approval",
      urgency: approvalUrgency(approval.risk),
      title: approval.title,
      detail: approval.description,
      at: approval.createdAt,
      ref: { taskId: task.id },
    });
  }

  // 2. Trust demotions — a capability fell back to approval-every-time.
  for (const grant of input.grants) {
    if (grant.state !== "probation") continue;
    const who = grant.subject.startsWith("role:") ? grant.subject.slice("role:".length) : grant.subject;
    items.push({
      id: `trust:${grant.subject}:${grant.capability}`,
      kind: "trust_review",
      urgency: 2,
      title: `Trust reduced: ${grant.capability}`,
      detail: `${who} had ${grant.failures ?? 0} failed use(s), so this capability is back to approval-every-time. Re-grant it if that was a one-off.`,
      at: grant.updatedAt,
      ref: { capability: grant.capability },
    });
  }

  // 3. Blocked work — a board item an employee can't move on its own.
  for (const work of input.workItems) {
    if (work.status !== "blocked") continue;
    const who = work.assigneeBotId ? input.roleTitleByBot?.get(work.assigneeBotId) : undefined;
    items.push({
      id: `work:${work.id}`,
      kind: "blocked_work",
      urgency: 2,
      title: `Blocked: ${work.title}`,
      detail: who ? `${who} is blocked on this.` : "A task on the board is blocked.",
      at: work.updatedAt,
      ref: { workItemId: work.id },
    });
  }

  // 4. Proposed quests — the chair suggests the next mission; the CEO starts it.
  for (const quest of input.quests) {
    if (quest.status !== "proposed") continue;
    items.push({
      id: `quest:${quest.id}`,
      kind: "quest_proposed",
      urgency: 1,
      title: `Proposed mission: ${quest.title}`,
      detail: quest.objective,
      at: quest.createdAt,
      ref: { questId: quest.id },
    });
  }

  // Loudest first; within a band, the most recent first.
  items.sort((a, b) => b.urgency - a.urgency || b.at.localeCompare(a.at));

  const counts: Record<InboxKind, number> = { ...EMPTY_COUNTS };
  for (const item of items) counts[item.kind] += 1;

  const limit = Math.max(1, input.limit ?? 50);
  return {
    urgent: items.filter((item) => item.urgency >= 2).length,
    items: items.slice(0, limit),
    counts,
  };
}
