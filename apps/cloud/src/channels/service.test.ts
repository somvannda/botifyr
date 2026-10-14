import { describe, expect, it } from "vitest";
import type { ChannelAdapter, ChannelMessage } from "@botifyr/channels";
import { MemoryStore } from "../store/memory.js";
import type { Task } from "@botifyr/shared";
import type { RunnerDeps } from "../runner.js";
import { registerWorkspaceBots } from "./index.js";
import { ChannelService } from "./service.js";
import { emit } from "../events.js";

/** A fake channel adapter that lets the test deliver a message and read sends. */
function fakeChannel() {
  let handler: ((message: ChannelMessage) => void) | null = null;
  const sent: Array<{ conversationId: string; text: string }> = [];
  const adapter: ChannelAdapter = {
    name: "telegram",
    onMessage(next) {
      handler = next;
    },
    async send(conversationId, text) {
      sent.push({ conversationId, text });
    },
    async start() {},
    async stop() {},
  };
  return {
    adapter,
    sent,
    deliver: (conversationId: string, text: string) => handler?.({ conversationId, text }),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

async function seededWorkspace(telegram?: { botId: string }, id = "ws1") {
  const store = new MemoryStore();
  const now = new Date().toISOString();
  await store.createWorkspace({
    id,
    ownerId: "u1",
    name: "Acme",
    source: { kind: "idea", value: "" },
    mission: "",
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...(telegram ? { telegram } : {}),
  });
  return store;
}

describe("ChannelService — company-bot routing", () => {
  it("runs an inbound company-bot message as the employee, billed to the owner", async () => {
    const store = await seededWorkspace({ botId: "emp-sales" });
    const calls: Array<{ deps: RunnerDeps; task: Task }> = [];
    const service = new ChannelService(store, async (deps, task) => {
      calls.push({ deps, task });
    });
    const { adapter, deliver, sent } = fakeChannel();
    service.register(adapter, {
      key: "telegram:ws1",
      scope: { workspaceId: "ws1", botId: "emp-sales" },
    });

    deliver("chat-9", "Do you deliver to Siem Reap?");
    await tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.deps.userId).toBe("u1");
    expect(calls[0]?.deps.author).toEqual({ id: "emp-sales" });
    // The thread belongs to the employee, so its role applies.
    const session = await store.getSession(calls[0]!.task.sessionId);
    expect(session?.botId).toBe("emp-sales");
    // A gated customer thread gets nothing outbound: the reply is drafted for
    // the chair instead (docs/external-communications.md §5).
    expect(sent).toHaveLength(0);

    // …and the external-comms spine exists: a contact + thread for this chat.
    const contacts = await store.listContacts("ws1");
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.externalId).toBe("chat-9");
    expect(contacts[0]?.ownerBotId).toBe("emp-sales");
    const thread = await store.getConversationByChat("telegram", "chat-9");
    expect(thread?.assignedBotId).toBe("emp-sales");
    expect(thread?.trust).toBe("gated");
    // The thread points at its session, so the UI can read the transcript back.
    expect(thread?.sessionId).toBe(calls[0]?.task.sessionId);
  });

  it("refreshes the thread on a repeat message instead of duplicating it", async () => {
    const store = await seededWorkspace({ botId: "emp-sales" });
    const service = new ChannelService(store, async () => {});
    const { adapter, deliver } = fakeChannel();
    service.register(adapter, { key: "telegram:ws1", scope: { workspaceId: "ws1", botId: "emp-sales" } });

    deliver("chat-9", "first");
    await tick();
    deliver("chat-9", "second");
    await tick();

    expect(await store.listContacts("ws1")).toHaveLength(1);
  });

  it("holds a gated reply for the chair, and sends it once approved", async () => {
    const store = await seededWorkspace({ botId: "emp-sales" });
    const calls: Array<{ deps: RunnerDeps; task: Task }> = [];
    const service = new ChannelService(store, async (deps, task) => {
      calls.push({ deps, task });
    });
    const { adapter, deliver, sent } = fakeChannel();
    service.register(adapter, { key: "telegram:ws1", scope: { workspaceId: "ws1", botId: "emp-sales" } });

    deliver("chat-9", "Do you deliver to Siem Reap?");
    await tick();
    emit({
      type: "task.completed",
      task: { ...calls[0]!.task, result: "Yes — next-day." },
    });
    await tick();

    // Nothing reached the customer: the reply is staged for the chair (§5).
    expect(sent).toHaveLength(0);
    const thread = await store.getConversationByChat("telegram", "chat-9");
    expect(thread?.pendingReply).toBe("Yes — next-day.");

    // The chair approves → the reply is delivered to the customer.
    const ok = await service.sendExternalReply("ws1", "telegram", "chat-9", thread!.pendingReply!);
    expect(ok).toBe(true);
    expect(sent.at(-1)?.text).toBe("Yes — next-day.");
  });

  it("sends a trusted customer's reply straight through", async () => {
    const store = await seededWorkspace({ botId: "emp-sales" });
    const calls: Array<{ task: Task }> = [];
    const service = new ChannelService(store, async (_deps, task) => {
      calls.push({ task });
    });
    const { adapter, deliver, sent } = fakeChannel();
    service.register(adapter, { key: "telegram:ws1", scope: { workspaceId: "ws1", botId: "emp-sales" } });

    deliver("chat-9", "first");
    await tick();
    const thread = await store.getConversationByChat("telegram", "chat-9");
    await store.saveConversation({ ...thread!, trust: "trusted" });

    deliver("chat-9", "second");
    await tick();
    emit({ type: "task.completed", task: { ...calls[1]!.task, result: "Sure!" } });
    await tick();

    // A trusted thread needs no approval, so the reply goes straight out (§5).
    expect(sent.some((entry) => entry.text === "Sure!")).toBe(true);
  });

  it("keeps the legacy per-chat user when the channel is unscoped", async () => {
    const store = new MemoryStore();
    const calls: Array<{ deps: RunnerDeps }> = [];
    const service = new ChannelService(store, async (deps) => {
      calls.push({ deps });
    });
    const { adapter, deliver } = fakeChannel();
    service.register(adapter);
    deliver("chat-1", "hello");
    await tick();

    expect(calls).toHaveLength(1);
    // No company scope → a synthetic per-chat account, and no employee author.
    expect(calls[0]?.deps.userId).not.toBe("u1");
    expect(calls[0]?.deps.author).toBeUndefined();
  });
});

describe("registerWorkspaceBots", () => {
  it("does nothing without a vault key", async () => {
    const store = await seededWorkspace({ botId: "emp-sales" });
    const service = new ChannelService(store, async () => {});
    expect(await registerWorkspaceBots(store, service, undefined)).toBe(0);
  });

  it("skips a company whose bot token isn't stored", async () => {
    const store = await seededWorkspace({ botId: "emp-sales" });
    const service = new ChannelService(store, async () => {});
    expect(await registerWorkspaceBots(store, service, Buffer.alloc(32))).toBe(0);
  });

  it("ignores companies with no telegram config", async () => {
    const store = await seededWorkspace(undefined);
    const service = new ChannelService(store, async () => {});
    expect(await registerWorkspaceBots(store, service, Buffer.alloc(32))).toBe(0);
  });
});
