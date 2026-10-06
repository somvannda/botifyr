import type { Task } from "@botifyr/shared";

/**
 * Merge a task update into the task we already hold.
 *
 * A transient update that carries **no** approval keeps the pending one, so the
 * approval prompt can't flicker away before the user answers.
 *
 * Any update that **does** carry an approval — pending, allowed or denied —
 * wins, so a *resolved* approval clears the prompt. Getting this wrong made the
 * Allow/Deny buttons act on a task the server had already moved past, so they
 * looked dead.
 */
export function mergeTask(existing: Task | undefined, incoming: Task): Task {
  if (existing?.approval?.status === "pending" && !incoming.approval) {
    return { ...incoming, approval: existing.approval, status: "awaiting_approval" };
  }
  return incoming;
}
