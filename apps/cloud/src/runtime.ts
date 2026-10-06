import type { Approval } from "@botifyr/shared";
import type { ComputerBackend } from "@botifyr/agent-core";

/**
 * Runtime-only state that must not be persisted: pending approval promises, the
 * live desktop backends, and ownership maps for event routing.
 */

const pendingApprovals = new Map<string, (approval: Approval) => void>();

export function waitForApproval(approvalId: string): Promise<Approval> {
  return new Promise<Approval>((resolve) => {
    pendingApprovals.set(approvalId, resolve);
  });
}

export function resolvePendingApproval(approval: Approval): void {
  const resolve = pendingApprovals.get(approval.id);
  if (resolve) {
    pendingApprovals.delete(approval.id);
    resolve(approval);
  }
}

const computerSandboxes = new Map<string, ComputerBackend>();

export function setComputerSandbox(taskId: string, backend: ComputerBackend): void {
  computerSandboxes.set(taskId, backend);
}

export function getComputerSandbox(taskId: string): ComputerBackend | undefined {
  return computerSandboxes.get(taskId);
}

export function clearComputerSandbox(taskId: string): void {
  computerSandboxes.delete(taskId);
}

/* Latest screenshot per task (runtime only; not durable). */
const screenshots = new Map<string, Buffer>();

export function setScreenshot(taskId: string, png: Uint8Array): void {
  screenshots.set(taskId, Buffer.from(png));
}

export function getScreenshot(taskId: string): Buffer | undefined {
  return screenshots.get(taskId);
}

/* Ownership maps so we only stream events to their owner. */
const sessionOwners = new Map<string, string>();
const taskOwners = new Map<string, string>();
const taskSessions = new Map<string, string>();

export function rememberSession(sessionId: string, userId: string): void {
  sessionOwners.set(sessionId, userId);
}

export function rememberTask(taskId: string, sessionId: string, userId: string): void {
  taskSessions.set(taskId, sessionId);
  taskOwners.set(taskId, userId);
}

export function ownerOfEventTask(taskId: string): string | undefined {
  return taskOwners.get(taskId);
}

export function ownerOfSession(sessionId: string): string | undefined {
  return sessionOwners.get(sessionId);
}

/* Per-session lock so concurrent group members don't lose each other's writes. */
const sessionLocks = new Map<string, Promise<unknown>>();

export function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  sessionLocks.set(
    sessionId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
