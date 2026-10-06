import type { Approval, Task } from "@botifyr/shared";
import { emit } from "./events.js";
import { resolvePendingApproval } from "./runtime.js";
import type { Store } from "./store/index.js";

/**
 * Resolve a pending approval and wake the waiting runner. Shared by the HTTP
 * API and the messaging channels so both behave identically.
 */
export async function resolveTaskApproval(
  store: Store,
  task: Task,
  approvalId: string,
  decision: "allow" | "deny",
): Promise<Approval | null> {
  const approval = task.approval;
  if (!approval || approval.id !== approvalId || approval.status !== "pending") {
    return null;
  }

  approval.status = decision === "allow" ? "allowed" : "denied";
  approval.resolvedAt = new Date().toISOString();
  await store.updateTask(task);
  emit({ type: "task.updated", task });
  emit({ type: "approval.resolved", taskId: task.id, approval });
  resolvePendingApproval(approval);
  return approval;
}
