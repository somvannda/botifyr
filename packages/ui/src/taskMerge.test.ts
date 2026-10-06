import { describe, expect, it } from "vitest";
import type { Approval, Task } from "@botifyr/shared";
import { mergeTask } from "./taskMerge.js";

function task(partial: Partial<Task> = {}): Task {
  return {
    id: "t1",
    sessionId: "s1",
    goal: "g",
    status: "running",
    steps: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function approval(status: Approval["status"]): Approval {
  return {
    id: "a1",
    taskId: "t1",
    title: "Approve",
    description: "d",
    risk: "low",
    status,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("mergeTask", () => {
  it("keeps a pending approval when a transient update carries none", () => {
    const existing = task({ status: "awaiting_approval", approval: approval("pending") });
    const incoming = task({ status: "running" });
    const merged = mergeTask(existing, incoming);
    expect(merged.approval?.status).toBe("pending");
    expect(merged.status).toBe("awaiting_approval");
  });

  it("clears the prompt when the server resolves the approval", () => {
    const existing = task({ status: "awaiting_approval", approval: approval("pending") });
    const incoming = task({ status: "running", approval: approval("allowed") });
    const merged = mergeTask(existing, incoming);
    expect(merged.approval?.status).toBe("allowed");
    expect(merged.status).toBe("running");
  });

  it("adopts a brand new approval", () => {
    const existing = task({ status: "running" });
    const incoming = task({ status: "awaiting_approval", approval: approval("pending") });
    expect(mergeTask(existing, incoming).approval?.id).toBe("a1");
  });
});
