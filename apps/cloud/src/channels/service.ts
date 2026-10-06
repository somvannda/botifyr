import { randomUUID } from "node:crypto";
import type { ChatMessage, ServerEvent, Task } from "@botifyr/shared";
import type { ChannelAdapter, ChannelMessage } from "@botifyr/channels";
import { emit, subscribe } from "../events.js";
import { rememberSession, rememberTask } from "../runtime.js";
import { hashPassword, newId } from "../auth.js";
import { resolveTaskApproval } from "../approvals.js";
import { runTask } from "../runner.js";
import type { Store } from "../store/index.js";

interface Conversation {
  userId: string;
  sessionId: string;
  pending?: { taskId: string; approvalId: string };
}

const DECISIONS: Record<string, "allow" | "deny"> = {
  allow: "allow",
  yes: "allow",
  y: "allow",
  approve: "allow",
  ok: "allow",
  deny: "deny",
  no: "deny",
  n: "deny",
  cancel: "deny",
  stop: "deny",
};

/** Routes inbound channel messages to agent tasks and delivers progress back. */
export class ChannelService {
  private readonly adapters = new Map<string, ChannelAdapter>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly taskConversation = new Map<string, string>();

  constructor(private readonly store: Store) {
    subscribe((event) => this.onEvent(event));
  }

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.name, adapter);
    adapter.onMessage((message) => {
      void this.handle(adapter.name, message);
    });
  }

  async start(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.start();
    }
  }

  private key(channel: string, conversationId: string): string {
    return `${channel}:${conversationId}`;
  }

  private async ensureChannelUser(channel: string, conversationId: string): Promise<string> {
    const email = `${channel}+${conversationId.replace(/[^a-zA-Z0-9]/g, "")}@channel.local`;
    const existing = await this.store.getUserByEmail(email);
    if (existing) return existing.id;
    const id = newId();
    await this.store.createUser({
      id,
      email,
      passwordHash: hashPassword(randomUUID()),
      role: "user",
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  private async handle(channel: string, message: ChannelMessage): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) return;

    const conversationKey = this.key(channel, message.conversationId);
    let conversation = this.conversations.get(conversationKey);

    if (!conversation) {
      const userId = message.userId ?? (await this.ensureChannelUser(channel, message.conversationId));
      const sessionId = randomUUID();
      await this.store.createSession({
        id: sessionId,
        userId,
        title: message.text.slice(0, 60) || "New chat",
        messages: [],
        createdAt: new Date().toISOString(),
      });
      rememberSession(sessionId, userId);
      conversation = { userId, sessionId };
      this.conversations.set(conversationKey, conversation);
    }

    const decision = DECISIONS[message.text.trim().toLowerCase()];
    if (conversation.pending && decision) {
      const task = await this.store.getTask(conversation.pending.taskId);
      if (task) {
        await resolveTaskApproval(this.store, task, conversation.pending.approvalId, decision);
        await adapter.send(
          message.conversationId,
          decision === "allow" ? "Approved — continuing." : "Denied — stopping.",
        );
      }
      conversation.pending = undefined;
      return;
    }

    const session = await this.store.getSession(conversation.sessionId);
    if (!session) return;
    const history = session.messages.map((entry) => ({ role: entry.role, content: entry.content }));

    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      sessionId: conversation.sessionId,
      goal: message.text,
      status: "queued",
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: message.text,
      createdAt: now,
      taskId: task.id,
    };
    session.messages.push(userMessage);
    await this.store.updateSession(session);
    await this.store.createTask(task);
    rememberTask(task.id, conversation.sessionId, conversation.userId);
    this.taskConversation.set(task.id, conversationKey);
    emit({ type: "session.updated", session });
    emit({ type: "task.created", task });

    await adapter.send(message.conversationId, "On it — I'll report back here.");
    void runTask({ store: this.store, userId: conversation.userId, history }, task).catch(() => {});
  }

  private onEvent(event: ServerEvent): void {
    let taskId: string | undefined;
    if (event.type === "approval.requested") taskId = event.taskId;
    else if (event.type === "task.completed" || event.type === "task.failed") taskId = event.task.id;
    if (!taskId) return;

    const conversationKey = this.taskConversation.get(taskId);
    if (!conversationKey) return;
    const separator = conversationKey.indexOf(":");
    const channel = conversationKey.slice(0, separator);
    const conversationId = conversationKey.slice(separator + 1);
    const adapter = this.adapters.get(channel);
    const conversation = this.conversations.get(conversationKey);
    if (!adapter || !conversation) return;

    if (event.type === "approval.requested") {
      conversation.pending = { taskId, approvalId: event.approval.id };
      void adapter.send(
        conversationId,
        `Approval needed: ${event.approval.title}\n${event.approval.description}\n\nReply "allow" or "deny".`,
      );
    } else if (event.type === "task.completed") {
      conversation.pending = undefined;
      this.taskConversation.delete(taskId);
      void adapter.send(conversationId, `Done: ${event.task.result ?? "task completed"}`);
    } else if (event.type === "task.failed") {
      conversation.pending = undefined;
      this.taskConversation.delete(taskId);
      void adapter.send(conversationId, `Stopped: ${event.task.error ?? "task failed"}`);
    }
  }
}
