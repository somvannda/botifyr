import type { Task } from "@botifyr/shared";
import type {
  ApiKeyRecord,
  AuditRecord,
  BotRecord,
  BotRoleRecord,
  CapabilityGrantRecord,
  CompanyReportRecord,
  ConnectionRecord,
  DeviceKey,
  FileRecord,
  FriendRequestRecord,
  InvoiceRecord,
  LearnedSkillRecord,
  LedgerRecord,
  MediaRecipe,
  MediaRecord,
  ModelPricingRecord,
  NotificationRecord,
  Plan,
  PlatformSettings,
  ProviderRole,
  ProviderRoleConfig,
  SecretRecord,
  SessionRecord,
  Store,
  UsageRecord,
  UserRecord,
  WalletRecord,
  WorkItemRecord,
  WorkspaceBudgetRecord,
  WorkspaceRecord,
} from "./types.js";

/** Zero-setup store for development and tests. Nothing survives a restart. */

export class MemoryStore implements Store {
  private users = new Map<string, UserRecord>();
  private usersByEmail = new Map<string, string>();
  private tokens = new Map<string, { userId: string; expiresAt: string; kind: string }>();
  private sessions = new Map<string, SessionRecord>();
  private bots = new Map<string, BotRecord>();
  private workspaces = new Map<string, WorkspaceRecord>();
  /** Keyed by `${workspaceId}:${botId}`. */
  private botRoles = new Map<string, BotRoleRecord>();
  private workItems = new Map<string, WorkItemRecord>();
  private budgets = new Map<string, WorkspaceBudgetRecord>();
  /** Keyed by `${workspaceId}:${subject}:${capability}`. */
  private grants = new Map<string, CapabilityGrantRecord>();
  private reports = new Map<string, CompanyReportRecord>();
  private providerRoles = new Map<ProviderRole, ProviderRoleConfig>();
  private deviceKeys = new Map<string, DeviceKey>();
  private tasks = new Map<string, Task>();
  private audit: AuditRecord[] = [];
  private secrets = new Map<string, SecretRecord>();
  private connections = new Map<string, ConnectionRecord>();
  private usage: UsageRecord[] = [];
  private files = new Map<string, FileRecord>();
  private learnedSkills = new Map<string, LearnedSkillRecord>();
  private apiKeys = new Map<string, ApiKeyRecord>();
  private media = new Map<string, MediaRecord>();
  private mediaRecipes = new Map<string, MediaRecipe>();
  private friendRequests = new Map<string, FriendRequestRecord>();
  private friendships = new Set<string>();
  private settings: PlatformSettings | null = null;
  private modelPricing = new Map<string, ModelPricingRecord>();
  private invoices = new Map<string, InvoiceRecord>();
  private wallets = new Map<string, WalletRecord>();
  private ledger: LedgerRecord[] = [];
  private notifications = new Map<string, NotificationRecord>();

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
    profile: {
      handle?: string;
      displayName?: string;
      avatarEmoji?: string;
      avatarScheme?: number;
      avatarUrl?: string | null;
    },
  ): Promise<void> {
    const record = this.users.get(id);
    if (!record) return;
    if (profile.handle !== undefined) record.handle = profile.handle;
    if (profile.displayName !== undefined) record.displayName = profile.displayName;
    if (profile.avatarEmoji !== undefined) record.avatarEmoji = profile.avatarEmoji;
    if (profile.avatarScheme !== undefined) record.avatarScheme = profile.avatarScheme;
    if (profile.avatarUrl !== undefined) record.avatarUrl = profile.avatarUrl ?? undefined;
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

  async deleteSession(userId: string, id: string): Promise<boolean> {
    const record = this.sessions.get(id);
    if (!record || record.userId !== userId) return false;
    this.sessions.delete(id);
    return true;
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

  async createWorkspace(record: WorkspaceRecord): Promise<void> {
    this.workspaces.set(record.id, structuredClone(record));
  }

  async getWorkspace(id: string): Promise<WorkspaceRecord | null> {
    const record = this.workspaces.get(id);
    return record ? structuredClone(record) : null;
  }

  async listWorkspaces(ownerId: string): Promise<WorkspaceRecord[]> {
    return [...this.workspaces.values()]
      .filter((workspace) => workspace.ownerId === ownerId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((workspace) => structuredClone(workspace));
  }

  async updateWorkspace(record: WorkspaceRecord): Promise<void> {
    this.workspaces.set(record.id, structuredClone(record));
  }

  async deleteWorkspace(ownerId: string, id: string): Promise<boolean> {
    const record = this.workspaces.get(id);
    if (!record || record.ownerId !== ownerId) return false;
    this.workspaces.delete(id);
    for (const [key, role] of [...this.botRoles.entries()]) {
      if (role.workspaceId === id) this.botRoles.delete(key);
    }
    return true;
  }

  async setBotRole(record: BotRoleRecord): Promise<void> {
    this.botRoles.set(`${record.workspaceId}:${record.botId}`, structuredClone(record));
  }

  async getBotRole(workspaceId: string, botId: string): Promise<BotRoleRecord | null> {
    const record = this.botRoles.get(`${workspaceId}:${botId}`);
    return record ? structuredClone(record) : null;
  }

  async listBotRoles(workspaceId: string): Promise<BotRoleRecord[]> {
    return [...this.botRoles.values()]
      .filter((role) => role.workspaceId === workspaceId)
      .map((role) => structuredClone(role));
  }

  async deleteBotRole(workspaceId: string, botId: string): Promise<boolean> {
    return this.botRoles.delete(`${workspaceId}:${botId}`);
  }

  async createWorkItem(record: WorkItemRecord): Promise<void> {
    this.workItems.set(record.id, structuredClone(record));
  }

  async getWorkItem(id: string): Promise<WorkItemRecord | null> {
    const record = this.workItems.get(id);
    return record ? structuredClone(record) : null;
  }

  async listWorkItems(workspaceId: string): Promise<WorkItemRecord[]> {
    return [...this.workItems.values()]
      .filter((item) => item.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((item) => structuredClone(item));
  }

  async updateWorkItem(record: WorkItemRecord): Promise<void> {
    this.workItems.set(record.id, structuredClone(record));
  }

  async deleteWorkItem(workspaceId: string, id: string): Promise<boolean> {
    const record = this.workItems.get(id);
    if (!record || record.workspaceId !== workspaceId) return false;
    this.workItems.delete(id);
    return true;
  }

  async getWorkspaceBudget(workspaceId: string): Promise<WorkspaceBudgetRecord | null> {
    const record = this.budgets.get(workspaceId);
    return record ? structuredClone(record) : null;
  }

  async saveWorkspaceBudget(record: WorkspaceBudgetRecord): Promise<void> {
    this.budgets.set(record.workspaceId, structuredClone(record));
  }

  async listCapabilityGrants(workspaceId: string): Promise<CapabilityGrantRecord[]> {
    return [...this.grants.values()]
      .filter((grant) => grant.workspaceId === workspaceId)
      .map((grant) => structuredClone(grant));
  }

  async setCapabilityGrant(record: CapabilityGrantRecord): Promise<void> {
    this.grants.set(`${record.workspaceId}:${record.subject}:${record.capability}`, structuredClone(record));
  }

  async createCompanyReport(record: CompanyReportRecord): Promise<void> {
    this.reports.set(record.id, structuredClone(record));
  }

  async listCompanyReports(workspaceId: string): Promise<CompanyReportRecord[]> {
    return [...this.reports.values()]
      .filter((report) => report.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((report) => structuredClone(report));
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

  async listActiveTasks(): Promise<Task[]> {
    return [...this.tasks.values()].filter(
      (task) => task.status === "running" || task.status === "queued" || task.status === "awaiting_approval",
    );
  }

  async listTasksForUser(userId: string): Promise<Task[]> {
    const sessionIds = new Set(
      [...this.sessions.values()].filter((entry) => entry.userId === userId).map((entry) => entry.id),
    );
    return [...this.tasks.values()]
      .filter((task) => sessionIds.has(task.sessionId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    this.secrets.set(`${record.workspaceId ?? record.userId}:${record.name}`, record);
  }

  async listSecrets(userId: string): Promise<SecretRecord[]> {
    return [...this.secrets.values()].filter((secret) => secret.userId === userId && !secret.workspaceId);
  }

  async listWorkspaceSecrets(workspaceId: string): Promise<SecretRecord[]> {
    return [...this.secrets.values()].filter((secret) => secret.workspaceId === workspaceId);
  }

  async getSecret(userId: string, name: string): Promise<SecretRecord | null> {
    return this.secrets.get(`${userId}:${name}`) ?? null;
  }

  async getWorkspaceSecret(workspaceId: string, name: string): Promise<SecretRecord | null> {
    return this.secrets.get(`${workspaceId}:${name}`) ?? null;
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

  async listWorkspaceFiles(workspaceId: string): Promise<FileRecord[]> {
    return [...this.files.values()]
      .filter((file) => file.workspaceId === workspaceId)
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

  async deleteMediaByTask(taskId: string): Promise<number> {
    let removed = 0;
    for (const [key, record] of this.media) {
      if (record.taskId === taskId) {
        this.media.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /* Billing --------------------------------------------------------------- */

  async getPlatformSettings(): Promise<PlatformSettings> {
    return this.settings ?? DEFAULT_SETTINGS();
  }

  async savePlatformSettings(settings: PlatformSettings): Promise<void> {
    this.settings = settings;
  }

  async listModelPricing(): Promise<ModelPricingRecord[]> {
    return [...this.modelPricing.values()].map((record) => ({ ...record }));
  }

  async saveModelPricing(record: ModelPricingRecord): Promise<void> {
    this.modelPricing.set(record.model, { ...record });
  }

  async deleteModelPricing(model: string): Promise<boolean> {
    return this.modelPricing.delete(model);
  }

  async listProviderRoles(): Promise<ProviderRoleConfig[]> {
    return [...this.providerRoles.values()].map((record) => ({ ...record }));
  }

  async getProviderRole(role: ProviderRole): Promise<ProviderRoleConfig | null> {
    const record = this.providerRoles.get(role);
    return record ? { ...record } : null;
  }

  async saveProviderRole(config: ProviderRoleConfig): Promise<void> {
    this.providerRoles.set(config.role, { ...config });
  }

  async createInvoice(record: InvoiceRecord): Promise<void> {
    this.invoices.set(record.id, { ...record });
  }

  async updateInvoice(record: InvoiceRecord): Promise<void> {
    this.invoices.set(record.id, { ...record });
  }

  async getInvoice(id: string): Promise<InvoiceRecord | null> {
    const record = this.invoices.get(id);
    return record ? { ...record } : null;
  }

  async getInvoiceByProviderPayment(providerPaymentId: string): Promise<InvoiceRecord | null> {
    for (const record of this.invoices.values()) {
      if (record.providerPaymentId === providerPaymentId) return { ...record };
    }
    return null;
  }

  async listInvoices(userId: string, status?: string): Promise<InvoiceRecord[]> {
    return [...this.invoices.values()]
      .filter((record) => record.userId === userId && (!status || record.status === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((record) => ({ ...record }));
  }

  async listOpenInvoices(): Promise<InvoiceRecord[]> {
    return [...this.invoices.values()]
      .filter((record) => record.status === "open")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((record) => ({ ...record }));
  }

  async getWallet(userId: string): Promise<WalletRecord> {
    return this.wallets.get(userId) ?? { userId, balanceCents: 0, updatedAt: new Date().toISOString() };
  }

  async addWalletCents(userId: string, deltaCents: number): Promise<WalletRecord> {
    const current = this.wallets.get(userId) ?? {
      userId,
      balanceCents: 0,
      updatedAt: new Date().toISOString(),
    };
    const next = {
      ...current,
      balanceCents: current.balanceCents + deltaCents,
      updatedAt: new Date().toISOString(),
    };
    this.wallets.set(userId, next);
    return { ...next };
  }

  async addLedger(record: LedgerRecord): Promise<void> {
    this.ledger.push({ ...record });
  }

  async listLedger(userId: string, limit = 50): Promise<LedgerRecord[]> {
    return this.ledger
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((entry) => ({ ...entry }));
  }

  async createNotification(record: NotificationRecord): Promise<void> {
    this.notifications.set(record.id, { ...record });
  }

  async updateNotification(record: NotificationRecord): Promise<void> {
    this.notifications.set(record.id, { ...record });
  }

  async listPendingNotifications(): Promise<NotificationRecord[]> {
    return [...this.notifications.values()]
      .filter((record) => Object.values(record.sent).some((value) => !value))
      .map((record) => ({ ...record }));
  }

  async setUserBilling(
    id: string,
    fields: Partial<
      Pick<UserRecord, "plan" | "billingMode" | "periodStart" | "periodEnd" | "graceUntil" | "subStatus">
    >,
  ): Promise<void> {
    const record = this.users.get(id);
    if (record) Object.assign(record, fields);
  }

  async listMediaRecipes(): Promise<MediaRecipe[]> {
    return [...this.mediaRecipes.values()]
      .sort((a, b) => a.domain.localeCompare(b.domain))
      .map((record) => ({ ...record }));
  }

  async getMediaRecipe(domain: string): Promise<MediaRecipe | null> {
    const record = this.mediaRecipes.get(domain.toLowerCase());
    return record ? { ...record } : null;
  }

  async saveMediaRecipe(record: MediaRecipe): Promise<void> {
    this.mediaRecipes.set(record.domain.toLowerCase(), { ...record });
  }

  async deleteMediaRecipe(domain: string): Promise<boolean> {
    return this.mediaRecipes.delete(domain.toLowerCase());
  }

  async saveDeviceKey(record: DeviceKey): Promise<void> {
    this.deviceKeys.set(`${record.userId}:${record.deviceId}`, { ...record });
  }

  async listDeviceKeys(userId: string): Promise<DeviceKey[]> {
    return [...this.deviceKeys.values()]
      .filter((record) => record.userId === userId)
      .map((record) => ({ ...record }));
  }

  async getDeviceKey(userId: string, deviceId: string): Promise<DeviceKey | null> {
    const record = this.deviceKeys.get(`${userId}:${deviceId}`);
    return record ? { ...record } : null;
  }
}

/** Default billing policy (matches the seeded `platform_settings` row). */
function DEFAULT_SETTINGS(): PlatformSettings {
  return {
    plans: {
      proPriceCents: 500,
      businessPriceCents: 1900,
      proPeriodDays: 30,
      includedTokens: { pro: 5_000_000, business: 50_000_000 },
      currency: "USD",
    },
    freeMonthlyTokens: 500_000,
    lowBalanceCents: 100,
    graceDays: 7,
    reminderDays: [7, 3, 1],
    reminderChannels: { os: true, email: true, telegram: true },
    onDemand: { enabled: true, markupPercent: 15, minTopUpCents: 100, allowPro: false, onEmpty: "block" },
    fallbackPlan: "free",
  };
}
