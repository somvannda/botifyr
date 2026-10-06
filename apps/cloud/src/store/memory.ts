import type { Task } from "@botifyr/shared";
import type {
  AuditRecord,
  BotRecord,
  ConnectionRecord,
  SecretRecord,
  SessionRecord,
  Store,
  UserRecord,
} from "./types.js";

/** Zero-setup store for development and tests. Nothing survives a restart. */

export class MemoryStore implements Store {
  private users = new Map<string, UserRecord>();
  private usersByEmail = new Map<string, string>();
  private tokens = new Map<string, { userId: string; expiresAt: string }>();
  private sessions = new Map<string, SessionRecord>();
  private bots = new Map<string, BotRecord>();
  private tasks = new Map<string, Task>();
  private audit: AuditRecord[] = [];
  private secrets = new Map<string, SecretRecord>();
  private connections = new Map<string, ConnectionRecord>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async createUser(record: UserRecord): Promise<void> {
    this.users.set(record.id, record);
    this.usersByEmail.set(record.email.toLowerCase(), record.id);
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const id = this.usersByEmail.get(email.toLowerCase());
    return id ? (this.users.get(id) ?? null) : null;
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async createToken(tokenHash: string, userId: string, expiresAt: string): Promise<void> {
    this.tokens.set(tokenHash, { userId, expiresAt });
  }

  async getUserIdByTokenHash(tokenHash: string): Promise<string | null> {
    const entry = this.tokens.get(tokenHash);
    if (!entry) return null;
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      this.tokens.delete(tokenHash);
      return null;
    }
    return entry.userId;
  }

  async deleteToken(tokenHash: string): Promise<void> {
    this.tokens.delete(tokenHash);
  }

  async createSession(record: SessionRecord): Promise<void> {
    this.sessions.set(record.id, structuredClone(record));
  }

  async updateSession(record: SessionRecord): Promise<void> {
    this.sessions.set(record.id, structuredClone(record));
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const record = this.sessions.get(id);
    return record ? structuredClone(record) : null;
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((session) => structuredClone(session));
  }

  async createBot(record: BotRecord): Promise<void> {
    this.bots.set(record.id, structuredClone(record));
  }

  async getBot(id: string): Promise<BotRecord | null> {
    const record = this.bots.get(id);
    return record ? structuredClone(record) : null;
  }

  async listBots(userId: string): Promise<BotRecord[]> {
    return [...this.bots.values()]
      .filter((bot) => bot.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((bot) => structuredClone(bot));
  }

  async deleteBot(userId: string, id: string): Promise<boolean> {
    const record = this.bots.get(id);
    if (!record || record.userId !== userId) return false;
    this.bots.delete(id);
    return true;
  }

  async updateBot(record: BotRecord): Promise<void> {
    this.bots.set(record.id, structuredClone(record));
  }

  async createTask(task: Task): Promise<void> {
    this.tasks.set(task.id, structuredClone(task));
  }

  async updateTask(task: Task): Promise<void> {
    this.tasks.set(task.id, structuredClone(task));
  }

  async getTask(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    this.audit.push(record);
  }

  async listAudit(taskId: string): Promise<AuditRecord[]> {
    return this.audit.filter((entry) => entry.taskId === taskId);
  }

  async createSecret(record: SecretRecord): Promise<void> {
    this.secrets.set(`${record.userId}:${record.name}`, record);
  }

  async listSecrets(userId: string): Promise<SecretRecord[]> {
    return [...this.secrets.values()].filter((secret) => secret.userId === userId);
  }

  async getSecret(userId: string, name: string): Promise<SecretRecord | null> {
    return this.secrets.get(`${userId}:${name}`) ?? null;
  }

  async deleteSecret(userId: string, id: string): Promise<boolean> {
    for (const [key, secret] of this.secrets) {
      if (secret.id === id && secret.userId === userId) {
        this.secrets.delete(key);
        return true;
      }
    }
    return false;
  }

  async upsertConnection(record: ConnectionRecord): Promise<void> {
    this.connections.set(`${record.userId}:${record.provider}`, record);
  }

  async listConnections(userId: string): Promise<ConnectionRecord[]> {
    return [...this.connections.values()].filter((record) => record.userId === userId);
  }

  async getConnection(userId: string, provider: string): Promise<ConnectionRecord | null> {
    return this.connections.get(`${userId}:${provider}`) ?? null;
  }

  async deleteConnection(userId: string, provider: string): Promise<boolean> {
    return this.connections.delete(`${userId}:${provider}`);
  }
}
