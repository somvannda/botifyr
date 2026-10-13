import type { BotRoleRecord } from "./store/types.js";
import { catalogRoleFor } from "./capability-tools.js";

/**
 * The scheduled prompt for a company employee (docs/virtual-workspace-
 * implementation-plan.md §0.4). A company pulls work down its hierarchy instead of
 * every bot self-polling: the **chair** runs the company, a **department head**
 * reviews its department and delegates the next priority, and an **IC** does its
 * next assigned task and reports the outcome.
 *
 * Level comes from the catalog role, with a title fallback for custom titles.
 */
export function scheduledPromptFor(
  role: Pick<BotRoleRecord, "title" | "department" | "isChair">,
): string {
  if (role.isChair) {
    return "Run the daily standup. If the company has no PLAN.md yet, write one now with company.plan (goal, approach, who, channels, metrics); if the team lacks the roles or capacity to execute it, hire them with company.hire. If no quest is active, propose the next one with company.propose (title + objective + acceptance). Otherwise summarise the board, flag blockers, and delegate the next steps. Record significant decisions with company.decide.";
  }
  const catalog = catalogRoleFor({ title: role.title, department: role.department });
  const isHead = catalog
    ? catalog.level === "head" || catalog.level === "exec"
    : /head|lead|chief|cto|ceo|coo|cfo|director|vp|manager/i.test(role.title);
  if (isHead) {
    return "Review your department with company.review_department: unblock stalled work and delegate the next priority to the right teammate with company.delegate. Then record progress with company.report. If a decision is above your remit, escalate to the CEO.";
  }
  return "Review your board tasks and do the next one. When you finish one, record the outcome with company.report (what it produced). If you're blocked, escalate; if the plan is unclear, ask the CEO.";
}
