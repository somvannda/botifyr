import { randomUUID } from "node:crypto";
import type { ChatMessage, Contact, Conversation, ServerEvent, Task } from "@botifyr/shared";
import type { ChannelAdapter, ChannelMessage } from "@botifyr/channels";
import { emit, subscribe } from "../events.js";
import { rememberSession, rememberTask } from "../runtime.js";
import { hashPassword, newId } from "../auth.js";
import { resolveTaskApproval } from "../approvals.js";
import { runTask, type RunnerDeps } from "../runner.js";
import type { Store } from "../store/index.js";
import { scopedChannelIdentity, type ChannelScope } from "../channel-routing.js";

interface ChannelConversation {
  userId: string;
  sessionId: string;
  /** The employee this thread runs as, when the channel is company-scoped. */
  authorId?: string;
  /** Whether outgoing replies are trusted, or held for the chair's approval (§5). */
  trust?: "gated" | "trusted";
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
  private readonly conversations = new Map<string, ChannelConversation>();
  private readonly taskConversation = new Map<
    string,
    { key: string; channel: string; conversationId: string }
  >();
  private readonly scopes = new Map<string, ChannelScope>();
  /** workspace:platform → the registered adapter key, for chair-approved sends. */
  private readonly scopedAdapters = new Map<string, string>();
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
    if (opts.scope) {
      this.scopes.set(key, opts.scope);
      this.scopedAdapters.set(`${opts.scope.workspaceId}:${adapter.name}`, key);
    }
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

    // A company-scoped channel runs as the employee it answers for (so it
    // inherits that role's instructions, tools and permissions) and keeps the
    // external-comms spine — a contact + thread (docs/external-communications.md §4).
    const scope = this.scopes.get(channel);
    const identity = scope
      ? scopedChannelIdentity(scope, await this.store.getWorkspace(scope.workspaceId).catch(() => null))
      : null;

    if (!conversation) {
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

    // Keep the external-comms spine in sync (contact + thread, §4), now that the
    // thread's session exists so the UI can read it back.
    if (scope && identity) {
      const thread = await this.upsertContactThread(scope, identity, message, conversation.sessionId).catch(
        () => null,
      );
      if (thread) conversation.trust = thread.trust;
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
    this.taskConversation.set(task.id, { key: conversationKey, channel, conversationId: message.conversationId });
    emit({ type: "session.updated", session });
    emit({ type: "task.created", task });

    // Internal chats get an immediate ack; external ones don't, because on a
    // gated thread nothing reaches the customer until the chair approves (§5).
    if (!(scope && identity)) {
      await adapter.send(message.conversationId, "On it — I'll report back here.");
    }
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

  /**
   * Create or refresh the Contact + Conversation for an inbound scoped message,
   * so the CRM/pipeline has a spine (docs/external-communications.md §4).
   */
  private async upsertContactThread(
    scope: ChannelScope,
    identity: { userId: string; authorId: string },
    message: ChannelMessage,
    sessionId?: string,
  ): Promise<Conversation> {
    const now = new Date().toISOString();
    const externalId = message.senderId ?? message.conversationId;
    const existingContact = await this.store.getContactByExternal(scope.workspaceId, "telegram", externalId);
    const contact: Contact = {
      id: existingContact?.id ?? randomUUID(),
      workspaceId: scope.workspaceId,
      platform: "telegram",
      externalId,
      // The Telegram text update carries no display name; a getChat enrichment
      // can fill this in later.
      name: existingContact?.name ?? externalId,
      handle: existingContact?.handle,
      tags: existingContact?.tags ?? [],
      ownerBotId: existingContact?.ownerBotId ?? identity.authorId,
      source: existingContact?.source ?? "inbound",
      status: existingContact?.status ?? "new",
      firstSeenAt: existingContact?.firstSeenAt ?? now,
      lastMessageAt: now,
    };
    await this.store.saveContact(contact);

    const existingConversation = await this.store.getConversationByChat("telegram", message.conversationId);
    const conversation: Conversation = {
      id: existingConversation?.id ?? randomUUID(),
      workspaceId: scope.workspaceId,
      contactId: contact.id,
      platform: "telegram",
      externalChatId: message.conversationId,
      kind: "dm",
      assignedBotId: existingConversation?.assignedBotId ?? identity.authorId,
      sessionId: sessionId ?? existingConversation?.sessionId,
      trust: existingConversation?.trust ?? "gated",
      lastMessageAt: now,
      createdAt: existingConversation?.createdAt ?? now,
    };
    await this.store.saveConversation(conversation);
    return conversation;
  }

  /**
   * Hold a gated reply for the chair instead of sending it to the customer
   * (docs/external-communications.md §5).
   */
  private async stagePendingReply(platform: string, externalChatId: string, text: string): Promise<void> {
    const record = await this.store.getConversationByChat(platform, externalChatId).catch(() => null);
    if (!record) return;
    await this.store
      .saveConversation({ ...record, pendingReply: text, lastMessageAt: new Date().toISOString() })
      .catch(() => {});
  }

  /** Deliver an approved reply to a customer (the chair's approval route, §5). */
  async sendExternalReply(
    workspaceId: string,
    platform: string,
    externalChatId: string,
    text: string,
  ): Promise<boolean> {
    const key = this.scopedAdapters.get(`${workspaceId}:${platform}`);
    const adapter = key ? this.adapters.get(key) : undefined;
    if (!adapter) return false;
    await adapter.send(externalChatId, text);
    return true;
  }

  private onEvent(event: ServerEvent): void {
    let taskId: string | undefined;
    if (event.type === "approval.requested") taskId = event.taskId;
    else if (event.type === "task.completed" || event.type === "task.failed") taskId = event.task.id;
    if (!taskId) return;

    const target = this.taskConversation.get(taskId);
    if (!target) return;
    const { key: conversationKey, channel, conversationId } = target;
    const adapter = this.adapters.get(channel);
    const conversation = this.conversations.get(conversationKey);
    if (!adapter || !conversation) return;

    const external = this.scopes.has(channel);
    if (event.type === "approval.requested") {
      // Internal approvals are never surfaced into a customer's chat, and a
      // customer must not be able to resolve one by typing "allow" (§5).
      if (external) return;
      conversation.pending = { taskId, approvalId: event.approval.id };
      void adapter.send(
        conversationId,
        `Approval needed: ${event.approval.title}\n${event.approval.description}\n\nReply "allow" or "deny".`,
      );
    } else if (event.type === "task.completed") {
      conversation.pending = undefined;
      this.taskConversation.delete(taskId);
      const text = event.task.result ?? "task completed";
      // A gated thread is drafted for the chair, not sent to the customer (§5).
      if (external && conversation.trust !== "trusted") {
        void this.stagePendingReply(adapter.name, conversationId, text);
      } else {
        void adapter.send(conversationId, external ? text : `Done: ${text}`);
      }
    } else if (event.type === "task.failed") {
      conversation.pending = undefined;
      this.taskConversation.delete(taskId);
      void adapter.send(conversationId, `Stopped: ${event.task.error ?? "task failed"}`);
    }
  }
}
