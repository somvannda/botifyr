import { describe, expect, it } from "vitest";
import type { Task, TaskStatus } from "@botifyr/shared";
import { MemoryStore } from "./memory.js";
import type { BotRecord, FileRecord, LearnedSkillRecord, SessionRecord, UserRecord } from "./types.js";

const now = new Date().toISOString();

function user(id: string, email: string): UserRecord {
  return { id, email, passwordHash: "x", role: "user", createdAt: now };
}

function learned(
  id: string,
  name: string,
  status: LearnedSkillRecord["status"] = "pending",
): LearnedSkillRecord {
  return {
    id,
    name,
    description: "d",
    content: "c",
    source: "test",
    createdBy: "u1",
    status,
    createdAt: now,
    updatedAt: now,
  };
}

describe("MemoryStore", () => {
  it("creates users, resolves them case-insensitively, and promotes roles", async () => {
    const store = new MemoryStore();
    await store.createUser(user("u1", "Someone@Example.com"));

    expect((await store.getUserByEmail("someone@example.COM"))?.id).toBe("u1");
    await store.setUserRole("u1", "admin");
    expect((await store.getUserById("u1"))?.role).toBe("admin");
    await store.setUserPlan("u1", "pro");
    expect((await store.getUserById("u1"))?.plan).toBe("pro");
  });

  it("issues tokens and rejects expired ones", async () => {
    const store = new MemoryStore();
    await store.createToken("hash-live", "u1", new Date(Date.now() + 60_000).toISOString());
    await store.createToken("hash-dead", "u1", new Date(Date.now() - 60_000).toISOString());

    expect(await store.getUserIdByTokenHash("hash-live")).toBe("u1");
    expect(await store.getUserIdByTokenHash("hash-dead")).toBeNull();
    await store.deleteToken("hash-live");
    expect(await store.getUserIdByTokenHash("hash-live")).toBeNull();
  });

  it("returns session copies so callers can't mutate stored state by reference", async () => {
    const store = new MemoryStore();
    const session: SessionRecord = { id: "s1", userId: "u1", title: "t", messages: [], createdAt: now };
    await store.createSession(session);

    const first = await store.getSession("s1");
    first?.messages.push({ id: "m1", role: "user", content: "hi", createdAt: now });
    const second = await store.getSession("s1");
    expect(second?.messages).toHaveLength(0);
  });

  it("lists sessions and bots newest-first, scoped to the owner", async () => {
    const store = new MemoryStore();
    await store.createSession({
      id: "s1",
      userId: "u1",
      title: "a",
      messages: [],
      createdAt: "2026-01-01T00:00:00Z",
    });
    await store.createSession({
      id: "s2",
      userId: "u1",
      title: "b",
      messages: [],
      createdAt: "2026-02-01T00:00:00Z",
    });
    await store.createSession({
      id: "s3",
      userId: "u2",
      title: "c",
      messages: [],
      createdAt: "2026-03-01T00:00:00Z",
    });

    const sessions = await store.listSessions("u1");
    expect(sessions.map((s) => s.id)).toEqual(["s2", "s1"]);

    const bot: BotRecord = {
      id: "b1",
      userId: "u1",
      name: "Bot",
      emoji: "🤖",
      scheme: 0,
      instructions: "",
      sessionId: "s1",
      createdAt: now,
    };
    await store.createBot(bot);
    expect(await store.deleteBot("u2", "b1")).toBe(false);
    expect(await store.deleteBot("u1", "b1")).toBe(true);
    expect(await store.getBot("b1")).toBeNull();
  });

  it("dedupes learned skills by name (case-insensitive) and sorts by recency", async () => {
    const store = new MemoryStore();
    await store.upsertLearnedSkill({ ...learned("a", "Download video"), updatedAt: "2026-01-01T00:00:00Z" });
    await store.upsertLearnedSkill({ ...learned("b", "download VIDEO"), updatedAt: "2026-02-01T00:00:00Z" });

    const all = await store.listLearnedSkills();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe("b");
    expect((await store.getLearnedSkillByName("DOWNLOAD video"))?.id).toBe("b");
  });

  it("only lets the author delete their learned skill", async () => {
    const store = new MemoryStore();
    await store.upsertLearnedSkill(learned("a", "Skill"));

    expect(await store.deleteLearnedSkill("someone-else", "a")).toBe(false);
    expect(await store.deleteLearnedSkill("u1", "a")).toBe(true);
    expect(await store.getLearnedSkill("a")).toBeNull();
  });

  it("tracks class files per bot and enforces ownership on delete", async () => {
    const store = new MemoryStore();
    const file: FileRecord = {
      id: "f1",
      botId: "b1",
      userId: "u1",
      name: "notes.md",
      content: "hi",
      createdAt: now,
      updatedAt: now,
    };
    await store.upsertFile(file);
    await store.upsertFile({ ...file, id: "f2", content: "v2", updatedAt: "later" });

    expect(await store.listFiles("b1")).toHaveLength(1);
    expect(await store.getFile("u2", "f2")).toBeNull();
    expect(await store.deleteFile("u2", "f2")).toBe(false);
    expect(await store.deleteFile("u1", "f2")).toBe(true);
  });

  it("aggregates usage since a timestamp", async () => {
    const store = new MemoryStore();
    await store.addUsage({
      id: "1",
      userId: "u1",
      taskId: null,
      promptTokens: 10,
      completionTokens: 5,
      createdAt: "2026-01-01T00:00:00Z",
    });
    await store.addUsage({
      id: "2",
      userId: "u1",
      taskId: null,
      promptTokens: 20,
      completionTokens: 7,
      createdAt: "2026-02-01T00:00:00Z",
    });

    expect(await store.usageSince("u1", "2026-01-15T00:00:00Z")).toEqual({ tokens: 27, requests: 1 });
  });

  it("stores API keys hashed and resolves/touches/revokes them", async () => {
    const store = new MemoryStore();
    await store.createApiKey({
      id: "k1",
      userId: "u1",
      name: "CI",
      prefix: "bk_abc",
      keyHash: "hash1",
      createdAt: now,
    });

    expect((await store.getApiKeyByHash("hash1"))?.userId).toBe("u1");
    expect(await store.listApiKeys("u1")).toHaveLength(1);
    await store.touchApiKey("k1");
    expect((await store.getApiKeyByHash("hash1"))?.lastUsedAt).toBeTruthy();
    expect(await store.revokeApiKey("u2", "k1")).toBe(false);
    expect(await store.revokeApiKey("u1", "k1")).toBe(true);
    expect(await store.getApiKeyByHash("hash1")).toBeNull();
  });

  it("tracks media per task and clears a whole task's records", async () => {
    const store = new MemoryStore();
    const media = (id: string, taskId: string, name: string) => ({
      id,
      userId: "u1",
      taskId,
      name,
      size: 10,
      mime: "video/mp4",
      location: "server" as const,
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertMedia(media("t1:a.mp4", "t1", "a.mp4"));
    await store.upsertMedia(media("t1:b.mp4", "t1", "b.mp4"));
    await store.upsertMedia(media("t2:c.mp4", "t2", "c.mp4"));

    expect(await store.listMedia("u1")).toHaveLength(3);
    expect(await store.deleteMediaByTask("t1")).toBe(2);
    expect(await store.listMedia("u1")).toHaveLength(1);
    expect(await store.deleteMediaByTask("missing")).toBe(0);
  });

  it("lists only non-terminal tasks, for restart reconciliation", async () => {
    const store = new MemoryStore();
    const task = (id: string, status: TaskStatus): Task => ({
      id,
      sessionId: "s1",
      goal: "g",
      status,
      steps: [],
      createdAt: now,
      updatedAt: now,
    });
    await store.createTask(task("t-run", "running"));
    await store.createTask(task("t-queue", "queued"));
    await store.createTask(task("t-approve", "awaiting_approval"));
    await store.createTask(task("t-done", "completed"));
    await store.createTask(task("t-fail", "failed"));
    await store.createTask(task("t-cancel", "cancelled"));

    const active = await store.listActiveTasks();
    expect(active.map((entry) => entry.id).sort()).toEqual(["t-approve", "t-queue", "t-run"]);
  });
});
