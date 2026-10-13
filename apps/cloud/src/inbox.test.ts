import { describe, expect, it } from "vitest";
import type { Approval, CapabilityGrant, Quest, Task, WorkItem } from "@botifyr/shared";
import { buildInbox } from "./inbox.js";

function task(approval: Partial<Approval>, overrides: Partial<Task> = {}): Task {
  const full: Approval = {
    id: approval.id ?? "a1",
    taskId: approval.taskId ?? "t1",
    title: approval.title ?? "Approve: social.publish",
    description: approval.description ?? "Post to the company channel.",
    risk: approval.risk ?? "low",
    status: approval.status ?? "pending",
    createdAt: approval.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
  return {
    id: "t1",
    sessionId: "s1",
    goal: "Post an update",
    status: "awaiting_approval",
    steps: [],
    approval: full,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    workspaceId: "ws",
    subject: "role:Head of Marketing",
    capability: "social.publish",
    granted: true,
    state: "gated",
    failures: 0,
    successes: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function work(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "w1",
    workspaceId: "ws",
    title: "Write the launch post",
    phase: "mvp",
    status: "blocked",
    department: "marketing",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function quest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: "q1",
    workspaceId: "ws",
    title: "Launch the MVP",
    objective: "A working MVP in real users' hands",
    acceptance: [],
    status: "proposed",
    stage: "mvp",
    trust: "manual",
    workItemIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const empty = { tasks: [] as Task[], quests: [] as Quest[], workItems: [] as WorkItem[], grants: [] as CapabilityGrant[] };

describe("buildInbox", () => {
  it("returns an empty, well-shaped inbox when nothing needs the CEO", () => {
    const inbox = buildInbox(empty);
    expect(inbox.items).toEqual([]);
    expect(inbox.urgent).toBe(0);
    expect(inbox.counts).toEqual({ approval: 0, trust_review: 0, blocked_work: 0, quest_proposed: 0 });
  });

  it("ranks high-risk approvals above medium, low, and a proposed quest", () => {
    const inbox = buildInbox({
      ...empty,
      tasks: [
        task({ id: "a-low", risk: "low" }),
        task({ id: "a-high", risk: "high" }),
        task({ id: "a-med", risk: "medium" }),
      ],
      quests: [quest()],
    });
    expect(inbox.items.map((item) => item.kind)).toEqual([
      "approval",
      "approval",
      "approval",
      "quest_proposed",
    ]);
    expect(inbox.items[0]?.urgency).toBe(3);
    expect(inbox.items[2]?.urgency).toBe(1);
    expect(inbox.urgent).toBe(2);
    expect(inbox.counts.approval).toBe(3);
    expect(inbox.counts.quest_proposed).toBe(1);
  });

  it("ignores resolved approvals and non-proposed quests", () => {
    const inbox = buildInbox({
      ...empty,
      tasks: [task({ status: "allowed" })],
      quests: [quest({ status: "active" })],
    });
    expect(inbox.items).toHaveLength(0);
  });

  it("includes only trust grants in probation", () => {
    const inbox = buildInbox({
      ...empty,
      grants: [grant({ state: "probation", failures: 2 }), grant({ capability: "email.send", state: "trusted" })],
    });
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]?.kind).toBe("trust_review");
    expect(inbox.items[0]?.detail).toContain("Head of Marketing");
    expect(inbox.items[0]?.detail).toContain("2 failed");
  });

  it("names who is blocked on a board item", () => {
    const inbox = buildInbox({
      ...empty,
      workItems: [work({ assigneeBotId: "b9" })],
      roleTitleByBot: new Map([["b9", "QA Engineer"]]),
    });
    expect(inbox.items[0]?.kind).toBe("blocked_work");
    expect(inbox.items[0]?.title).toBe("Blocked: Write the launch post");
    expect(inbox.items[0]?.detail).toContain("QA Engineer");
  });

  it("orders the most recent first within an urgency band", () => {
    const inbox = buildInbox({
      ...empty,
      tasks: [
        task({ id: "old", risk: "medium", createdAt: "2026-01-01T00:00:00.000Z" }),
        task({ id: "new", risk: "medium", createdAt: "2026-06-01T00:00:00.000Z" }),
      ],
    });
    expect(inbox.items[0]?.id).toBe("approval:new");
  });

  it("caps the list but keeps the real counts", () => {
    const tasks = Array.from({ length: 5 }, (_, index) =>
      task({ id: `a${index}`, createdAt: `2026-01-0${index + 1}T00:00:00.000Z` }),
    );
    const inbox = buildInbox({ ...empty, tasks, limit: 2 });
    expect(inbox.items).toHaveLength(2);
    expect(inbox.counts.approval).toBe(5);
  });
});
