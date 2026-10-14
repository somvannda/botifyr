import { randomUUID } from "node:crypto";
import type { ChatMessage, ServerEvent, Task } from "@botifyr/shared";
import type { ChannelAdapter, ChannelMessage } from "@botifyr/channels";
import { emit, subscribe } from "../events.js";
import { rememberSession, rememberTask } from "../runtime.js";
import { hashPassword, newId } from "../auth.js";
import { resolveTaskApproval } from "../approvals.js";
import { runTask, type RunnerDeps } from "../runner.js";
import type { Store } from "../store/index.js";
import { scopedChannelIdentity, type ChannelScope } from "../channel-routing.js";

interface Conversation {
  userId: string;
  sessionId: string;
  /** The employee this thread runs as, when the channel is company-scoped. */
  authorId?: string;
  pending?: { taskId: string; approvalId: string };
}

/** Runs one agent task; injectable so channel routing is testable. */
export type RunTaskFn = (deps: RunnerDeps, task: Task) => Promise<void>;

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
  private readonly scopes = new Map<string, ChannelScope>();
  private started = false;

  constructor(
    private readonly store: Store,
    private readonly run: RunTaskFn = runTask,
  ) {
    subscribe((event) => this.onEvent(event));
  }

  /**
   * Register an adapter. `key` isolates bots that share an adapter name (one bot
   * per company); `scope` binds the channel to the employee it answers as
   * (docs/external-communications.md §8).
   */
  register(adapter: ChannelAdapter, opts: { key?: string; scope?: ChannelScope } = {}): void {
    const key = opts.key ?? adapter.name;
    this.adapters.set(key, adapter);
    if (opts.scope) this.scopes.set(key, opts.scope);
    adapter.onMessage((message) => {
      void this.handle(key, message);
    });
    // A company bot is registered asynchronously after startup, so start it here.
    if (this.started) void adapter.start();
  }

  async start(): Promise<void> {
    this.started = true;
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
      // A company-scoped channel runs as the employee it answers for, so it
      // inherits that role's instructions, tools and permissions.
      const scope = this.scopes.get(channel);
      const identity = scope
        ? scopedChannelIdentity(scope, await this.store.getWorkspace(scope.workspaceId).catch(() => null))
        : null;
      const userId =
        identity?.userId ?? message.userId ?? (await this.ensureChannelUser(channel, message.conversationId));
      const sessionId = randomUUID();
      await this.store.createSession({
        id: sessionId,
        userId,
        title: message.text.slice(0, 60) || "New chat",
        messages: [],
        createdAt: new Date().toISOString(),
        botId: identity?.authorId,
      });
      rememberSession(sessionId, userId);
      conversation = { userId, sessionId, authorId: identity?.authorId };
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
    void this
      .run(
        {
          store: this.store,
          userId: conversation.userId,
          author: conversation.authorId ? { id: conversation.authorId } : undefined,
          history,
        },
        task,
      )
      .catch(() => {});
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
