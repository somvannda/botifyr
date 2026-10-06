import type { ChatMessage, Task } from "@botifyr/shared";

/** Persistence contracts shared by the memory and Postgres stores. */

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

/** A conversation: id + owner + title + transcript. */
export interface SessionRecord {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  botId?: string;
  summary?: string;
  summaryUpTo?: number;
}

/** A bot: a named agent that owns one conversation thread. */
export interface BotRecord {
  id: string;
  userId: string;
  name: string;
  emoji: string;
  scheme: number;
  instructions: string;
  memberIds?: string[];
  sessionId: string;
  createdAt: string;
}

export interface SecretRecord {
  id: string;
  userId: string;
  name: string;
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  taskId: string | null;
  userId: string | null;
  type: string;
  toolName: string | null;
  detail: string;
  createdAt: string;
}

/** Encrypted OAuth tokens for a connected third-party app. */
export interface ConnectionRecord {
  id: string;
  userId: string;
  provider: string;
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: string;
}

/** One model call's token usage, for cost control. */
export interface UsageRecord {
  id: string;
  userId: string;
  taskId: string | null;
  promptTokens: number;
  completionTokens: number;
  createdAt: string;
}

export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;

  createUser(record: UserRecord): Promise<void>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(id: string): Promise<UserRecord | null>;

  createToken(tokenHash: string, userId: string, expiresAt: string): Promise<void>;
  getUserIdByTokenHash(tokenHash: string): Promise<string | null>;
  deleteToken(tokenHash: string): Promise<void>;

  createSession(record: SessionRecord): Promise<void>;
  updateSession(record: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  listSessions(userId: string): Promise<SessionRecord[]>;

  createBot(record: BotRecord): Promise<void>;
  getBot(id: string): Promise<BotRecord | null>;
  listBots(userId: string): Promise<BotRecord[]>;
  updateBot(record: BotRecord): Promise<void>;
  deleteBot(userId: string, id: string): Promise<boolean>;

  createTask(task: Task): Promise<void>;
  updateTask(task: Task): Promise<void>;
  getTask(id: string): Promise<Task | null>;

  appendAudit(record: AuditRecord): Promise<void>;
  listAudit(taskId: string): Promise<AuditRecord[]>;

  createSecret(record: SecretRecord): Promise<void>;
  listSecrets(userId: string): Promise<SecretRecord[]>;
  getSecret(userId: string, name: string): Promise<SecretRecord | null>;
  deleteSecret(userId: string, id: string): Promise<boolean>;

  upsertConnection(record: ConnectionRecord): Promise<void>;
  listConnections(userId: string): Promise<ConnectionRecord[]>;
  getConnection(userId: string, provider: string): Promise<ConnectionRecord | null>;
  deleteConnection(userId: string, provider: string): Promise<boolean>;

  addUsage(record: UsageRecord): Promise<void>;
  /** Total tokens + request count for a user since an ISO timestamp. */
  usageSince(userId: string, sinceIso: string): Promise<{ tokens: number; requests: number }>;
}
