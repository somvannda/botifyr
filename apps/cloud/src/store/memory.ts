import type { Task } from "@botifyr/shared";
import type {
  ApiKeyRecord,
  AuditRecord,
  BotRecord,
  ConnectionRecord,
  FileRecord,
  FriendRequestRecord,
  LearnedSkillRecord,
  MediaRecord,
  Plan,
  SecretRecord,
  SessionRecord,
  Store,
  UsageRecord,
  UserRecord,
} from "./types.js";

/** Zero-setup store for development and tests. Nothing survives a restart. */

export class MemoryStore implements Store {
  private users = new Map<string, UserRecord>();
  private usersByEmail = new Map<string, string>();
  private tokens = new Map<string, { userId: string; expiresAt: string; kind: string }>();
  private sessions = new Map<string, SessionRecord>();
  private bots = new Map<string, BotRecord>();
  private tasks = new Map<string, Task>();
  private audit: AuditRecord[] = [];
  private secrets = new Map<string, SecretRecord>();
  private connections = new Map<string, ConnectionRecord>();
  private usage: UsageRecord[] = [];
  private files = new Map<string, FileRecord>();
  private learnedSkills = new Map<string, LearnedSkillRecord>();
  private apiKeys = new Map<string, ApiKeyRecord>();
  private media = new Map<string, MediaRecord>();
  private friendRequests = new Map<string, FriendRequestRecord>();
  private friendships = new Set<string>();

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

  async listUsers(): Promise<UserRecord[]> {
    return [...this.users.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async setUserRole(id: string, role: "user" | "admin"): Promise<void> {
    const record = this.users.get(id);
    if (record) record.role = role;
  }

  async setUserPlan(id: string, plan: Plan): Promise<void> {
    const record = this.users.get(id);
    if (record) record.plan = plan;
  }

  async getUserByHandle(handle: string): Promise<UserRecord | null> {
    const wanted = handle.replace(/^@/, "").toLowerCase();
    for (const record of this.users.values()) {
      if (record.handle?.toLowerCase() === wanted) return { ...record };
    }
    return null;
  }

  async searchUsers(query: string, excludeId: string, limit: number): Promise<UserRecord[]> {
    const q = query.replace(/^@/, "").toLowerCase().trim();
    if (!q) return [];
    return [...this.users.values()]
      .filter(
        (record) =>
          record.id !== excludeId &&
          (record.handle?.toLowerCase().includes(q) ||
            record.email.toLowerCase().includes(q) ||
            (record.displayName ?? "").toLowerCase().includes(q)),
      )
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map((record) => ({ ...record }));
  }

  async updateUserProfile(
    id: string,
    profile: { handle?: string; displayName?: string; avatarEmoji?: string; avatarScheme?: number },
  ): Promise<void> {
    const record = this.users.get(id);
    if (!record) return;
    if (profile.handle !== undefined) record.handle = profile.handle;
    if (profile.displayName !== undefined) record.displayName = profile.displayName;
    if (profile.avatarEmoji !== undefined) record.avatarEmoji = profile.avatarEmoji;
    if (profile.avatarScheme !== undefined) record.avatarScheme = profile.avatarScheme;
  }

  private friendKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  async createFriendRequest(record: FriendRequestRecord): Promise<void> {
    this.friendRequests.set(record.id, { ...record });
  }

  async getFriendRequest(id: string): Promise<FriendRequestRecord | null> {
    const record = this.friendRequests.get(id);
    return record ? { ...record } : null;
  }

  async listFriendRequests(userId: string): Promise<FriendRequestRecord[]> {
    return [...this.friendRequests.values()]
      .filter((record) => record.fromUserId === userId || record.toUserId === userId)
      .map((record) => ({ ...record }));
  }

  async updateFriendRequest(record: FriendRequestRecord): Promise<void> {
    if (this.friendRequests.has(record.id)) this.friendRequests.set(record.id, { ...record });
  }

  async createFriendship(a: string, b: string): Promise<void> {
    this.friendships.add(this.friendKey(a, b));
  }

  async listFriends(userId: string): Promise<string[]> {
    const ids: string[] = [];
    for (const key of this.friendships) {
      const [x, y] = key.split("|");
      if (x === userId) ids.push(y);
      else if (y === userId) ids.push(x);
    }
    return ids;
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    return this.friendships.has(this.friendKey(a, b));
  }

  async deleteFriendship(a: string, b: string): Promise<boolean> {
    return this.friendships.delete(this.friendKey(a, b));
  }

  async createToken(tokenHash: string, userId: string, expiresAt: string, kind = "access"): Promise<void> {
    this.tokens.set(tokenHash, { userId, expiresAt, kind });
  }

  async getUserIdByTokenHash(tokenHash: string, kind = "access"): Promise<string | null> {
    const entry = this.tokens.get(tokenHash);
    if (!entry) return null;
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      this.tokens.delete(tokenHash);
      return null;
    }
    // Refresh tokens must never authenticate API calls.
    if (entry.kind !== kind) return null;
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

  async listConversations(userId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId || (session.participants ?? []).includes(userId))
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

  async listScheduledBots(): Promise<BotRecord[]> {
    return [...this.bots.values()].filter((bot) => bot.schedule).map((bot) => structuredClone(bot));
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

  async listAuditRecent(limit: number): Promise<AuditRecord[]> {
    return [...this.audit]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, Math.min(500, limit)));
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

  async addUsage(record: UsageRecord): Promise<void> {
    this.usage.push(record);
  }

  async usageSince(userId: string, sinceIso: string): Promise<{ tokens: number; requests: number }> {
    const since = new Date(sinceIso).getTime();
    const rows = this.usage.filter(
      (record) => record.userId === userId && new Date(record.createdAt).getTime() >= since,
    );
    return {
      tokens: rows.reduce((sum, record) => sum + record.promptTokens + record.completionTokens, 0),
      requests: rows.length,
    };
  }

  async upsertFile(record: FileRecord): Promise<void> {
    this.files.set(`${record.botId}:${record.name}`, record);
  }

  async listFiles(botId: string): Promise<FileRecord[]> {
    return [...this.files.values()]
      .filter((file) => file.botId === botId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getFile(userId: string, id: string): Promise<FileRecord | null> {
    for (const file of this.files.values()) {
      if (file.id === id && file.userId === userId) return file;
    }
    return null;
  }

  async deleteFile(userId: string, id: string): Promise<boolean> {
    for (const [key, file] of this.files) {
      if (file.id === id && file.userId === userId) {
        this.files.delete(key);
        return true;
      }
    }
    return false;
  }

  async upsertLearnedSkill(record: LearnedSkillRecord): Promise<void> {
    for (const [key, existing] of this.learnedSkills) {
      if (existing.name.toLowerCase() === record.name.toLowerCase() && existing.id !== record.id) {
        this.learnedSkills.delete(key);
      }
    }
    this.learnedSkills.set(record.id, structuredClone(record));
  }

  async listLearnedSkills(): Promise<LearnedSkillRecord[]> {
    return [...this.learnedSkills.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((record) => structuredClone(record));
  }

  async getLearnedSkill(id: string): Promise<LearnedSkillRecord | null> {
    const record = this.learnedSkills.get(id);
    return record ? structuredClone(record) : null;
  }

  async getLearnedSkillByName(name: string): Promise<LearnedSkillRecord | null> {
    for (const record of this.learnedSkills.values()) {
      if (record.name.toLowerCase() === name.toLowerCase()) return structuredClone(record);
    }
    return null;
  }

  async deleteLearnedSkill(userId: string, id: string): Promise<boolean> {
    const record = this.learnedSkills.get(id);
    if (!record || record.createdBy !== userId) return false;
    this.learnedSkills.delete(id);
    return true;
  }

  async createApiKey(record: ApiKeyRecord): Promise<void> {
    this.apiKeys.set(record.id, { ...record });
  }

  async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
    return [...this.apiKeys.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((record) => ({ ...record }));
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    for (const record of this.apiKeys.values()) {
      if (record.keyHash === keyHash) return { ...record };
    }
    return null;
  }

  async touchApiKey(id: string): Promise<void> {
    const record = this.apiKeys.get(id);
    if (record) record.lastUsedAt = new Date().toISOString();
  }

  async revokeApiKey(userId: string, id: string): Promise<boolean> {
    const record = this.apiKeys.get(id);
    if (!record || record.userId !== userId) return false;
    this.apiKeys.delete(id);
    return true;
  }

  async upsertMedia(record: MediaRecord): Promise<void> {
    for (const [key, existing] of this.media) {
      if (existing.taskId === record.taskId && existing.name === record.name && existing.id !== record.id) {
        this.media.delete(key);
      }
    }
    this.media.set(record.id, { ...record });
  }

  async listMedia(userId: string): Promise<MediaRecord[]> {
    return [...this.media.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((record) => ({ ...record }));
  }

  async getMedia(userId: string, id: string): Promise<MediaRecord | null> {
    const record = this.media.get(id);
    return record && record.userId === userId ? { ...record } : null;
  }

  async updateMedia(record: MediaRecord): Promise<void> {
    const existing = this.media.get(record.id);
    if (existing && existing.userId === record.userId) this.media.set(record.id, { ...record });
  }

  async deleteMedia(userId: string, id: string): Promise<boolean> {
    const record = this.media.get(id);
    if (!record || record.userId !== userId) return false;
    this.media.delete(id);
    return true;
  }
}
