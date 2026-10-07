import { Pool } from "pg";
import type { Task } from "@botifyr/shared";
import type {
  ApiKeyRecord,
  AuditRecord,
  BotRecord,
  BotRoleRecord,
  CapabilityGrantRecord,
  CompanyReportRecord,
  ConnectionRecord,
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
import { SCHEMA_SQL } from "./schema.js";

/** Serialize writes per session so concurrent runs can't clobber each other. */
const sessionWriteLocks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionWriteLocks.get(id) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  sessionWriteLocks.set(
    id,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** Durable store backed by Postgres. Tasks are stored as JSONB documents. */

export class PostgresStore implements Store {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createUser(record: UserRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO users (id, email, password_hash, role, plan, handle, display_name, avatar_emoji, avatar_scheme, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        record.id,
        record.email,
        record.passwordHash,
        record.role ?? "user",
        record.plan ?? "free",
        record.handle ?? null,
        record.displayName ?? null,
        record.avatarEmoji ?? null,
        record.avatarScheme ?? null,
        record.createdAt,
      ],
    );
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserByHandle(handle: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE lower(handle) = lower($1)", [
      handle.replace(/^@/, ""),
    ]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async searchUsers(query: string, excludeId: string, limit: number): Promise<UserRecord[]> {
    const like = `%${query.replace(/^@/, "").trim()}%`;
    const { rows } = await this.pool.query(
      "SELECT * FROM users WHERE id <> $1 AND (handle ILIKE $2 OR email ILIKE $2 OR display_name ILIKE $2) " +
        "ORDER BY handle NULLS LAST LIMIT $3",
      [excludeId, like, Math.max(1, Math.min(50, limit))],
    );
    return rows.map(toUser);
  }

  async updateUserProfile(
    id: string,
    profile: { handle?: string; displayName?: string; avatarEmoji?: string; avatarScheme?: number },
  ): Promise<void> {
    await this.pool.query(
      "UPDATE users SET handle = COALESCE($1, handle), display_name = COALESCE($2, display_name), " +
        "avatar_emoji = COALESCE($3, avatar_emoji), avatar_scheme = COALESCE($4, avatar_scheme) WHERE id = $5",
      [
        profile.handle ?? null,
        profile.displayName ?? null,
        profile.avatarEmoji ?? null,
        profile.avatarScheme ?? null,
        id,
      ],
    );
  }

  async listUsers(): Promise<UserRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM users ORDER BY created_at ASC");
    return rows.map(toUser);
  }

  async setUserRole(id: string, role: "user" | "admin"): Promise<void> {
    await this.pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
  }

  async setUserPlan(id: string, plan: Plan): Promise<void> {
    await this.pool.query("UPDATE users SET plan = $1 WHERE id = $2", [plan, id]);
  }

  async createFriendRequest(record: FriendRequestRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO friend_requests (id, from_user, to_user, status, created_at, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6)",
      [record.id, record.fromUserId, record.toUserId, record.status, record.createdAt, record.updatedAt],
    );
  }

  async getFriendRequest(id: string): Promise<FriendRequestRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM friend_requests WHERE id = $1", [id]);
    return rows[0] ? toFriendRequest(rows[0]) : null;
  }

  async listFriendRequests(userId: string): Promise<FriendRequestRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM friend_requests WHERE from_user = $1 OR to_user = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows.map(toFriendRequest);
  }

  async updateFriendRequest(record: FriendRequestRecord): Promise<void> {
    await this.pool.query("UPDATE friend_requests SET status = $1, updated_at = $2 WHERE id = $3", [
      record.status,
      record.updatedAt,
      record.id,
    ]);
  }

  async createFriendship(a: string, b: string): Promise<void> {
    const [x, y] = a < b ? [a, b] : [b, a];
    await this.pool.query("INSERT INTO friendships (user_a, user_b) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
      x,
      y,
    ]);
  }

  async listFriends(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      "SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS friend FROM friendships WHERE user_a = $1 OR user_b = $1",
      [userId],
    );
    return rows.map((row) => row.friend as string);
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const [x, y] = a < b ? [a, b] : [b, a];
    const { rows } = await this.pool.query("SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2", [
      x,
      y,
    ]);
    return rows.length > 0;
  }

  async deleteFriendship(a: string, b: string): Promise<boolean> {
    const [x, y] = a < b ? [a, b] : [b, a];
    const result = await this.pool.query("DELETE FROM friendships WHERE user_a = $1 AND user_b = $2", [x, y]);
    return (result.rowCount ?? 0) > 0;
  }

  async createToken(tokenHash: string, userId: string, expiresAt: string, kind = "access"): Promise<void> {
    await this.pool.query(
      "INSERT INTO auth_tokens (token_hash, user_id, expires_at, kind) VALUES ($1, $2, $3, $4)",
      [tokenHash, userId, expiresAt, kind],
    );
  }

  async getUserIdByTokenHash(tokenHash: string, kind = "access"): Promise<string | null> {
    const { rows } = await this.pool.query(
      "SELECT user_id FROM auth_tokens WHERE token_hash = $1 AND kind = $2 AND expires_at > now()",
      [tokenHash, kind],
    );
    return rows[0]?.user_id ?? null;
  }

  async deleteToken(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM auth_tokens WHERE token_hash = $1", [tokenHash]);
  }

  async createSession(record: SessionRecord): Promise<void> {
    await this.pool.query("INSERT INTO sessions (id, user_id, data, created_at) VALUES ($1, $2, $3, $4)", [
      record.id,
      record.userId,
      {
        title: record.title,
        messages: record.messages,
        botId: record.botId,
        kind: record.kind,
        participants: record.participants,
        summary: record.summary,
        summaryUpTo: record.summaryUpTo,
      },
      record.createdAt,
    ]);
  }

  async updateSession(record: SessionRecord): Promise<void> {
    await withLock(record.id, async () => {
      const { rows } = await this.pool.query("SELECT data FROM sessions WHERE id = $1", [record.id]);
      const existing = rows[0]?.data as
        { messages?: SessionRecord["messages"]; summary?: string; summaryUpTo?: number } | undefined;
      const existingMessages = existing?.messages ?? [];
      const incoming = record.messages ?? [];
      let messages = incoming;
      // A writer holding a stale snapshot must never drop messages another run
      // already appended: union by id and restore chronological order.
      if (existingMessages.length > incoming.length) {
        const seen = new Set(incoming.map((message) => message.id));
        messages = [...incoming, ...existingMessages.filter((message) => !seen.has(message.id))];
        messages.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      }
      await this.pool.query(
        "INSERT INTO sessions (id, user_id, data, created_at) VALUES ($1, $2, $3, $4) " +
          "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
        [
          record.id,
          record.userId,
          {
            title: record.title,
            messages,
            botId: record.botId,
            kind: record.kind,
            participants: record.participants,
            summary: record.summary ?? existing?.summary,
            summaryUpTo: record.summaryUpTo ?? existing?.summaryUpTo,
          },
          record.createdAt,
        ],
      );
    });
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, data, created_at FROM sessions WHERE id = $1",
      [id],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  async deleteSession(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM sessions WHERE user_id = $1 AND id = $2", [userId, id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, data, created_at FROM sessions WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows.map(toSession);
  }

  async listConversations(userId: string): Promise<SessionRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, data, created_at FROM sessions " +
        "WHERE user_id = $1 OR (data->'participants') ? $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows.map(toSession);
  }

  async createBot(record: BotRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO bots (id, user_id, session_id, data, created_at) VALUES ($1, $2, $3, $4, $5)",
      [record.id, record.userId, record.sessionId, record, record.createdAt],
    );
  }

  async getBot(id: string): Promise<BotRecord | null> {
    const { rows } = await this.pool.query("SELECT data FROM bots WHERE id = $1", [id]);
    return rows[0]?.data ?? null;
  }

  async listBots(userId: string): Promise<BotRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT data FROM bots WHERE user_id = $1 ORDER BY created_at ASC",
      [userId],
    );
    return rows.map((row) => row.data as BotRecord);
  }

  async listScheduledBots(): Promise<BotRecord[]> {
    const { rows } = await this.pool.query("SELECT data FROM bots WHERE data->'schedule' IS NOT NULL");
    return rows.map((row) => row.data as BotRecord);
  }

  async deleteBot(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM bots WHERE user_id = $1 AND id = $2", [userId, id]);
    return (result.rowCount ?? 0) > 0;
  }

  async updateBot(record: BotRecord): Promise<void> {
    await this.pool.query("UPDATE bots SET data = $1, session_id = $2 WHERE id = $3", [
      record,
      record.sessionId,
      record.id,
    ]);
  }

  async createWorkspace(record: WorkspaceRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO workspaces (id, owner_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
      [record.id, record.ownerId, record, record.createdAt, record.updatedAt],
    );
  }

  async getWorkspace(id: string): Promise<WorkspaceRecord | null> {
    const { rows } = await this.pool.query("SELECT data FROM workspaces WHERE id = $1", [id]);
    return (rows[0]?.data as WorkspaceRecord) ?? null;
  }

  async listWorkspaces(ownerId: string): Promise<WorkspaceRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT data FROM workspaces WHERE owner_id = $1 ORDER BY created_at ASC",
      [ownerId],
    );
    return rows.map((row) => row.data as WorkspaceRecord);
  }

  async updateWorkspace(record: WorkspaceRecord): Promise<void> {
    await this.pool.query("UPDATE workspaces SET data = $1, updated_at = $2 WHERE id = $3", [
      record,
      record.updatedAt,
      record.id,
    ]);
  }

  async deleteWorkspace(ownerId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM workspaces WHERE owner_id = $1 AND id = $2", [
      ownerId,
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async setBotRole(record: BotRoleRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO workspace_roles (workspace_id, bot_id, data) VALUES ($1, $2, $3) " +
        "ON CONFLICT (workspace_id, bot_id) DO UPDATE SET data = EXCLUDED.data",
      [record.workspaceId, record.botId, record],
    );
  }

  async getBotRole(workspaceId: string, botId: string): Promise<BotRoleRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT data FROM workspace_roles WHERE workspace_id = $1 AND bot_id = $2",
      [workspaceId, botId],
    );
    return (rows[0]?.data as BotRoleRecord) ?? null;
  }

  async listBotRoles(workspaceId: string): Promise<BotRoleRecord[]> {
    const { rows } = await this.pool.query("SELECT data FROM workspace_roles WHERE workspace_id = $1", [
      workspaceId,
    ]);
    return rows.map((row) => row.data as BotRoleRecord);
  }

  async deleteBotRole(workspaceId: string, botId: string): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM workspace_roles WHERE workspace_id = $1 AND bot_id = $2",
      [workspaceId, botId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createWorkItem(record: WorkItemRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO work_items (id, workspace_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
      [record.id, record.workspaceId, record, record.createdAt, record.updatedAt],
    );
  }

  async getWorkItem(id: string): Promise<WorkItemRecord | null> {
    const { rows } = await this.pool.query("SELECT data FROM work_items WHERE id = $1", [id]);
    return (rows[0]?.data as WorkItemRecord) ?? null;
  }

  async listWorkItems(workspaceId: string): Promise<WorkItemRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT data FROM work_items WHERE workspace_id = $1 ORDER BY created_at ASC",
      [workspaceId],
    );
    return rows.map((row) => row.data as WorkItemRecord);
  }

  async updateWorkItem(record: WorkItemRecord): Promise<void> {
    await this.pool.query("UPDATE work_items SET data = $1, updated_at = $2 WHERE id = $3", [
      record,
      record.updatedAt,
      record.id,
    ]);
  }

  async deleteWorkItem(workspaceId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM work_items WHERE workspace_id = $1 AND id = $2", [
      workspaceId,
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async getWorkspaceBudget(workspaceId: string): Promise<WorkspaceBudgetRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT workspace_id, limit_tokens, used_tokens, updated_at FROM workspace_budget WHERE workspace_id = $1",
      [workspaceId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      workspaceId: row.workspace_id as string,
      limitTokens: Number(row.limit_tokens),
      usedTokens: Number(row.used_tokens),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }

  async saveWorkspaceBudget(record: WorkspaceBudgetRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO workspace_budget (workspace_id, limit_tokens, used_tokens, updated_at) VALUES ($1, $2, $3, $4) " +
        "ON CONFLICT (workspace_id) DO UPDATE SET limit_tokens = EXCLUDED.limit_tokens, used_tokens = EXCLUDED.used_tokens, updated_at = EXCLUDED.updated_at",
      [record.workspaceId, record.limitTokens, record.usedTokens, record.updatedAt],
    );
  }

  async listCapabilityGrants(workspaceId: string): Promise<CapabilityGrantRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT subject, capability, granted, updated_at FROM capability_grants WHERE workspace_id = $1",
      [workspaceId],
    );
    return rows.map((row) => ({
      workspaceId,
      subject: row.subject as string,
      capability: row.capability as string,
      granted: row.granted as boolean,
      updatedAt: new Date(row.updated_at as string).toISOString(),
    }));
  }

  async setCapabilityGrant(record: CapabilityGrantRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO capability_grants (workspace_id, subject, capability, granted, updated_at) VALUES ($1, $2, $3, $4, $5) " +
        "ON CONFLICT (workspace_id, subject, capability) DO UPDATE SET granted = EXCLUDED.granted, updated_at = EXCLUDED.updated_at",
      [record.workspaceId, record.subject, record.capability, record.granted, record.updatedAt],
    );
  }

  async createCompanyReport(record: CompanyReportRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO company_reports (id, workspace_id, kind, data, created_at) VALUES ($1, $2, $3, $4, $5)",
      [record.id, record.workspaceId, record.kind, record, record.createdAt],
    );
  }

  async listCompanyReports(workspaceId: string): Promise<CompanyReportRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT data FROM company_reports WHERE workspace_id = $1 ORDER BY created_at DESC",
      [workspaceId],
    );
    return rows.map((row) => row.data as CompanyReportRecord);
  }

  async createTask(task: Task): Promise<void> {
    await this.pool.query(
      "INSERT INTO tasks (id, session_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
      [task.id, task.sessionId, task, task.createdAt, task.updatedAt],
    );
  }

  async updateTask(task: Task): Promise<void> {
    await this.pool.query(
      "INSERT INTO tasks (id, session_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) " +
        "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at",
      [task.id, task.sessionId, task, task.createdAt, task.updatedAt],
    );
  }

  async getTask(id: string): Promise<Task | null> {
    const { rows } = await this.pool.query("SELECT data FROM tasks WHERE id = $1", [id]);
    return rows[0]?.data ?? null;
  }

  async listActiveTasks(): Promise<Task[]> {
    const { rows } = await this.pool.query(
      "SELECT data FROM tasks WHERE data->>'status' IN ('running', 'queued', 'awaiting_approval')",
    );
    return rows.map((row) => row.data as Task);
  }

  async listTasksForUser(userId: string): Promise<Task[]> {
    const { rows } = await this.pool.query(
      "SELECT t.data FROM tasks t JOIN sessions s ON s.id = t.session_id " +
        "WHERE s.user_id = $1 ORDER BY t.created_at DESC LIMIT 200",
      [userId],
    );
    return rows.map((row) => row.data as Task);
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO audit_events (id, task_id, user_id, type, tool_name, detail, created_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        record.id,
        record.taskId,
        record.userId,
        record.type,
        record.toolName,
        record.detail,
        record.createdAt,
      ],
    );
  }

  async listAudit(taskId: string): Promise<AuditRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, task_id, user_id, type, tool_name, detail, created_at FROM audit_events " +
        "WHERE task_id = $1 ORDER BY created_at ASC",
      [taskId],
    );
    return rows.map(toAudit);
  }

  async listAuditRecent(limit: number): Promise<AuditRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, task_id, user_id, type, tool_name, detail, created_at FROM audit_events " +
        "ORDER BY created_at DESC LIMIT $1",
      [Math.max(1, Math.min(500, limit))],
    );
    return rows.map(toAudit);
  }

  async createSecret(record: SecretRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO secrets (id, user_id, name, ciphertext, iv, tag, created_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [record.id, record.userId, record.name, record.ciphertext, record.iv, record.tag, record.createdAt],
    );
  }

  async listSecrets(userId: string): Promise<SecretRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, name, ciphertext, iv, tag, created_at FROM secrets WHERE user_id = $1 ORDER BY name",
      [userId],
    );
    return rows.map(toSecret);
  }

  async getSecret(userId: string, name: string): Promise<SecretRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, name, ciphertext, iv, tag, created_at FROM secrets WHERE user_id = $1 AND name = $2",
      [userId, name],
    );
    return rows[0] ? toSecret(rows[0]) : null;
  }

  async deleteSecret(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM secrets WHERE user_id = $1 AND id = $2", [userId, id]);
    return (result.rowCount ?? 0) > 0;
  }

  async upsertConnection(record: ConnectionRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO connections (id, user_id, provider, ciphertext, iv, tag, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) " +
        "ON CONFLICT (user_id, provider) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, " +
        "tag = EXCLUDED.tag, created_at = EXCLUDED.created_at",
      [record.id, record.userId, record.provider, record.ciphertext, record.iv, record.tag, record.createdAt],
    );
  }

  async listConnections(userId: string): Promise<ConnectionRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, provider, ciphertext, iv, tag, created_at FROM connections WHERE user_id = $1 ORDER BY provider",
      [userId],
    );
    return rows.map(toConnection);
  }

  async getConnection(userId: string, provider: string): Promise<ConnectionRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, provider, ciphertext, iv, tag, created_at FROM connections WHERE user_id = $1 AND provider = $2",
      [userId, provider],
    );
    return rows[0] ? toConnection(rows[0]) : null;
  }

  async deleteConnection(userId: string, provider: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM connections WHERE user_id = $1 AND provider = $2", [
      userId,
      provider,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async addUsage(record: UsageRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO usage_events (id, user_id, task_id, prompt_tokens, completion_tokens, model, created_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        record.id,
        record.userId,
        record.taskId,
        record.promptTokens,
        record.completionTokens,
        record.model ?? null,
        record.createdAt,
      ],
    );
  }

  async usageSince(userId: string, sinceIso: string): Promise<{ tokens: number; requests: number }> {
    const { rows } = await this.pool.query(
      "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens, COUNT(*) AS requests " +
        "FROM usage_events WHERE user_id = $1 AND created_at >= $2",
      [userId, sinceIso],
    );
    return { tokens: Number(rows[0]?.tokens ?? 0), requests: Number(rows[0]?.requests ?? 0) };
  }

  async upsertFile(record: FileRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO files (id, bot_id, user_id, workspace_id, name, content, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) " +
        "ON CONFLICT (bot_id, name) DO UPDATE SET content = EXCLUDED.content, workspace_id = EXCLUDED.workspace_id, updated_at = EXCLUDED.updated_at",
      [
        record.id,
        record.botId,
        record.userId,
        record.workspaceId ?? null,
        record.name,
        record.content,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async listFiles(botId: string): Promise<FileRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, bot_id, user_id, workspace_id, name, content, created_at, updated_at FROM files WHERE bot_id = $1 ORDER BY name",
      [botId],
    );
    return rows.map(toFile);
  }

  async listWorkspaceFiles(workspaceId: string): Promise<FileRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, bot_id, user_id, workspace_id, name, content, created_at, updated_at FROM files WHERE workspace_id = $1 ORDER BY name",
      [workspaceId],
    );
    return rows.map(toFile);
  }

  async getFile(userId: string, id: string): Promise<FileRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, bot_id, user_id, workspace_id, name, content, created_at, updated_at FROM files WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return rows[0] ? toFile(rows[0]) : null;
  }

  async deleteFile(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM files WHERE user_id = $1 AND id = $2", [userId, id]);
    return (result.rowCount ?? 0) > 0;
  }

  async upsertLearnedSkill(record: LearnedSkillRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO learned_skills (id, name, data, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6) " +
        "ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at",
      [record.id, record.name, record, record.createdBy, record.createdAt, record.updatedAt],
    );
  }

  async listLearnedSkills(): Promise<LearnedSkillRecord[]> {
    const { rows } = await this.pool.query("SELECT data FROM learned_skills ORDER BY updated_at DESC");
    return rows.map((row) => row.data as LearnedSkillRecord);
  }

  async getLearnedSkill(id: string): Promise<LearnedSkillRecord | null> {
    const { rows } = await this.pool.query("SELECT data FROM learned_skills WHERE id = $1", [id]);
    return rows[0]?.data ?? null;
  }

  async getLearnedSkillByName(name: string): Promise<LearnedSkillRecord | null> {
    const { rows } = await this.pool.query("SELECT data FROM learned_skills WHERE lower(name) = lower($1)", [
      name,
    ]);
    return rows[0]?.data ?? null;
  }

  async deleteLearnedSkill(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM learned_skills WHERE id = $1 AND created_by = $2", [
      id,
      userId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async createApiKey(record: ApiKeyRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [record.id, record.userId, record.name, record.prefix, record.keyHash, record.createdAt],
    );
  }

  async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, name, prefix, key_hash, created_at, last_used_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows.map(toApiKey);
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, name, prefix, key_hash, created_at, last_used_at FROM api_keys WHERE key_hash = $1",
      [keyHash],
    );
    return rows[0] ? toApiKey(rows[0]) : null;
  }

  async touchApiKey(id: string): Promise<void> {
    await this.pool.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [id]);
  }

  async revokeApiKey(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM api_keys WHERE id = $1 AND user_id = $2", [id, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  async upsertMedia(record: MediaRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO media (id, user_id, task_id, name, size, mime, location, device, created_at, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) " +
        "ON CONFLICT (task_id, name) DO UPDATE SET size = EXCLUDED.size, mime = EXCLUDED.mime, " +
        "location = CASE WHEN media.location = 'device' THEN media.location ELSE EXCLUDED.location END, " +
        "device = CASE WHEN media.location = 'device' THEN media.device ELSE EXCLUDED.device END, " +
        "updated_at = EXCLUDED.updated_at",
      [
        record.id,
        record.userId,
        record.taskId,
        record.name,
        record.size,
        record.mime,
        record.location,
        record.device ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async listMedia(userId: string): Promise<MediaRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM media WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows.map(toMedia);
  }

  async getMedia(userId: string, id: string): Promise<MediaRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM media WHERE id = $1 AND user_id = $2", [
      id,
      userId,
    ]);
    return rows[0] ? toMedia(rows[0]) : null;
  }

  async updateMedia(record: MediaRecord): Promise<void> {
    await this.pool.query(
      "UPDATE media SET location = $1, device = $2, updated_at = $3 WHERE id = $4 AND user_id = $5",
      [record.location, record.device ?? null, record.updatedAt, record.id, record.userId],
    );
  }

  async deleteMedia(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM media WHERE id = $1 AND user_id = $2", [id, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  async deleteMediaByTask(taskId: string): Promise<number> {
    const result = await this.pool.query("DELETE FROM media WHERE task_id = $1", [taskId]);
    return result.rowCount ?? 0;
  }

  /* Billing --------------------------------------------------------------- */

  async getPlatformSettings(): Promise<PlatformSettings> {
    const { rows } = await this.pool.query("SELECT data FROM platform_settings WHERE id = 'global'");
    return (rows[0]?.data as PlatformSettings) ?? DEFAULT_SETTINGS();
  }

  async savePlatformSettings(settings: PlatformSettings): Promise<void> {
    await this.pool.query(
      "INSERT INTO platform_settings (id, data, updated_at) VALUES ('global', $1, now()) " +
        "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
      [settings],
    );
  }

  async listModelPricing(): Promise<ModelPricingRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM model_pricing ORDER BY model ASC");
    return rows.map(toModelPricing);
  }

  async saveModelPricing(record: ModelPricingRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO model_pricing (model, provider, input_cents_per_m, output_cents_per_m, markup_percent, enabled, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,now()) " +
        "ON CONFLICT (model) DO UPDATE SET provider = EXCLUDED.provider, input_cents_per_m = EXCLUDED.input_cents_per_m, " +
        "output_cents_per_m = EXCLUDED.output_cents_per_m, markup_percent = EXCLUDED.markup_percent, " +
        "enabled = EXCLUDED.enabled, updated_at = now()",
      [
        record.model,
        record.provider ?? null,
        record.inputCentsPerM,
        record.outputCentsPerM,
        record.markupPercent ?? null,
        record.enabled,
      ],
    );
  }

  async deleteModelPricing(model: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM model_pricing WHERE model = $1", [model]);
    return (result.rowCount ?? 0) > 0;
  }

  async createInvoice(record: InvoiceRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO invoices (id, user_id, kind, plan, amount_cents, currency, reference_id, provider_payment_id, " +
        "checkout_url, qr_string, provider_status, status, period_start, period_end, reminders, expires_at, paid_at, " +
        "created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",
      [
        record.id,
        record.userId,
        record.kind,
        record.plan ?? null,
        record.amountCents,
        record.currency,
        record.referenceId ?? null,
        record.providerPaymentId ?? null,
        record.checkoutUrl ?? null,
        record.qrString ?? null,
        record.providerStatus,
        record.status,
        record.periodStart ?? null,
        record.periodEnd ?? null,
        record.reminders,
        record.expiresAt ?? null,
        record.paidAt ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async updateInvoice(record: InvoiceRecord): Promise<void> {
    await this.pool.query(
      "UPDATE invoices SET plan = $1, amount_cents = $2, currency = $3, reference_id = $4, " +
        "provider_payment_id = $5, checkout_url = $6, qr_string = $7, provider_status = $8, status = $9, " +
        "period_start = $10, period_end = $11, reminders = $12, expires_at = $13, paid_at = $14, updated_at = $15 " +
        "WHERE id = $16",
      [
        record.plan ?? null,
        record.amountCents,
        record.currency,
        record.referenceId ?? null,
        record.providerPaymentId ?? null,
        record.checkoutUrl ?? null,
        record.qrString ?? null,
        record.providerStatus,
        record.status,
        record.periodStart ?? null,
        record.periodEnd ?? null,
        record.reminders,
        record.expiresAt ?? null,
        record.paidAt ?? null,
        record.updatedAt,
        record.id,
      ],
    );
  }

  async getInvoice(id: string): Promise<InvoiceRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM invoices WHERE id = $1", [id]);
    return rows[0] ? toInvoice(rows[0]) : null;
  }

  async getInvoiceByProviderPayment(providerPaymentId: string): Promise<InvoiceRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM invoices WHERE provider_payment_id = $1", [
      providerPaymentId,
    ]);
    return rows[0] ? toInvoice(rows[0]) : null;
  }

  async listInvoices(userId: string, status?: string): Promise<InvoiceRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM invoices WHERE user_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC",
      [userId, status ?? null],
    );
    return rows.map(toInvoice);
  }

  async listOpenInvoices(): Promise<InvoiceRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM invoices WHERE status = 'open' ORDER BY created_at ASC LIMIT 500",
    );
    return rows.map(toInvoice);
  }

  async getWallet(userId: string): Promise<WalletRecord> {
    const { rows } = await this.pool.query("SELECT * FROM wallets WHERE user_id = $1", [userId]);
    if (rows[0]) return toWallet(rows[0]);
    return { userId, balanceCents: 0, updatedAt: new Date().toISOString() };
  }

  async addWalletCents(userId: string, deltaCents: number): Promise<WalletRecord> {
    const { rows } = await this.pool.query(
      "INSERT INTO wallets (user_id, balance_cents, updated_at) VALUES ($1, $2, now()) " +
        "ON CONFLICT (user_id) DO UPDATE SET balance_cents = wallets.balance_cents + $2, updated_at = now() " +
        "RETURNING *",
      [userId, deltaCents],
    );
    return toWallet(rows[0]);
  }

  async addLedger(record: LedgerRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO ledger (id, user_id, kind, amount_cents, tokens, model, note, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        record.id,
        record.userId,
        record.kind,
        record.amountCents,
        record.tokens ?? null,
        record.model ?? null,
        record.note ?? null,
        record.createdAt,
      ],
    );
  }

  async listLedger(userId: string, limit = 50): Promise<LedgerRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
      [userId, limit],
    );
    return rows.map(toLedger);
  }

  async createNotification(record: NotificationRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO notifications (id, user_id, kind, subject, body, channels, sent, created_at, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        record.id,
        record.userId,
        record.kind,
        record.subject ?? null,
        record.body ?? null,
        record.channels,
        record.sent,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async updateNotification(record: NotificationRecord): Promise<void> {
    await this.pool.query("UPDATE notifications SET sent = $1, updated_at = $2 WHERE id = $3", [
      record.sent,
      record.updatedAt,
      record.id,
    ]);
  }

  async listPendingNotifications(): Promise<NotificationRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM notifications ORDER BY created_at ASC LIMIT 200");
    return rows.map(toNotification).filter((record) => Object.values(record.sent).some((value) => !value));
  }

  async setUserBilling(
    id: string,
    fields: Partial<
      Pick<UserRecord, "plan" | "billingMode" | "periodStart" | "periodEnd" | "graceUntil" | "subStatus">
    >,
  ): Promise<void> {
    await this.pool.query(
      "UPDATE users SET plan = COALESCE($1, plan), billing_mode = COALESCE($2, billing_mode), " +
        "period_start = COALESCE($3, period_start), period_end = COALESCE($4, period_end), " +
        "grace_until = COALESCE($5, grace_until), sub_status = COALESCE($6, sub_status) WHERE id = $7",
      [
        fields.plan ?? null,
        fields.billingMode ?? null,
        fields.periodStart ?? null,
        fields.periodEnd ?? null,
        fields.graceUntil ?? null,
        fields.subStatus ?? null,
        id,
      ],
    );
  }

  async listMediaRecipes(): Promise<MediaRecipe[]> {
    const { rows } = await this.pool.query("SELECT * FROM media_recipes ORDER BY domain ASC");
    return rows.map(toMediaRecipe);
  }

  async getMediaRecipe(domain: string): Promise<MediaRecipe | null> {
    const { rows } = await this.pool.query("SELECT * FROM media_recipes WHERE domain = $1", [
      domain.toLowerCase(),
    ]);
    return rows[0] ? toMediaRecipe(rows[0]) : null;
  }

  async saveMediaRecipe(record: MediaRecipe): Promise<void> {
    await this.pool.query(
      "INSERT INTO media_recipes (domain, pattern, headers, status, created_by, note, created_at, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8) " +
        "ON CONFLICT (domain) DO UPDATE SET pattern = EXCLUDED.pattern, headers = EXCLUDED.headers, " +
        "status = EXCLUDED.status, created_by = EXCLUDED.created_by, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at",
      [
        record.domain.toLowerCase(),
        record.pattern,
        record.headers ?? null,
        record.status,
        record.createdBy ?? null,
        record.note ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async deleteMediaRecipe(domain: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM media_recipes WHERE domain = $1", [
      domain.toLowerCase(),
    ]);
    return (result.rowCount ?? 0) > 0;
  }
}

function toMedia(row: any): MediaRecord {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    name: row.name,
    size: Number(row.size ?? 0),
    mime: row.mime ?? "application/octet-stream",
    location: row.location === "device" ? "device" : "server",
    device: row.device ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toAudit(row: any): AuditRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    type: row.type,
    toolName: row.tool_name,
    detail: row.detail,
    createdAt: row.created_at.toISOString(),
  };
}

function toApiKey(row: any): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prefix: row.prefix,
    keyHash: row.key_hash,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : undefined,
  };
}

function toUser(row: any): UserRecord {
  const plan: Plan = row.plan === "pro" ? "pro" : row.plan === "business" ? "business" : "free";
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role ?? "user",
    plan,
    handle: row.handle ?? undefined,
    displayName: row.display_name ?? undefined,
    avatarEmoji: row.avatar_emoji ?? undefined,
    avatarScheme: row.avatar_scheme ?? undefined,
    billingMode: row.billing_mode ?? undefined,
    periodStart: row.period_start ? new Date(row.period_start).toISOString() : undefined,
    periodEnd: row.period_end ? new Date(row.period_end).toISOString() : undefined,
    graceUntil: row.grace_until ? new Date(row.grace_until).toISOString() : undefined,
    subStatus: row.sub_status ?? undefined,
    telegramChatId: row.telegram_chat_id ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

function toInvoice(row: any): InvoiceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    plan: row.plan ?? undefined,
    amountCents: Number(row.amount_cents ?? 0),
    currency: row.currency,
    referenceId: row.reference_id ?? undefined,
    providerPaymentId: row.provider_payment_id ?? undefined,
    checkoutUrl: row.checkout_url ?? undefined,
    qrString: row.qr_string ?? undefined,
    providerStatus: row.provider_status,
    status: row.status,
    periodStart: row.period_start ? new Date(row.period_start).toISOString() : undefined,
    periodEnd: row.period_end ? new Date(row.period_end).toISOString() : undefined,
    reminders: row.reminders ?? {},
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toModelPricing(row: any): ModelPricingRecord {
  return {
    model: row.model,
    provider: row.provider ?? undefined,
    inputCentsPerM: Number(row.input_cents_per_m ?? 0),
    outputCentsPerM: Number(row.output_cents_per_m ?? 0),
    markupPercent: row.markup_percent ?? undefined,
    enabled: row.enabled !== false,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toWallet(row: any): WalletRecord {
  return {
    userId: row.user_id,
    balanceCents: Number(row.balance_cents ?? 0),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toLedger(row: any): LedgerRecord {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    amountCents: Number(row.amount_cents ?? 0),
    tokens: row.tokens ?? undefined,
    model: row.model ?? undefined,
    note: row.note ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toNotification(row: any): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    subject: row.subject ?? undefined,
    body: row.body ?? undefined,
    channels: row.channels ?? [],
    sent: row.sent ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toMediaRecipe(row: any): MediaRecipe {
  return {
    domain: row.domain,
    pattern: row.pattern,
    headers: row.headers ?? undefined,
    status: row.status,
    createdBy: row.created_by ?? undefined,
    note: row.note ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
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

function toFriendRequest(row: any): FriendRequestRecord {
  return {
    id: row.id,
    fromUserId: row.from_user,
    toUserId: row.to_user,
    status: row.status === "accepted" ? "accepted" : row.status === "declined" ? "declined" : "pending",
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSecret(row: any): SecretRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    ciphertext: row.ciphertext,
    iv: row.iv,
    tag: row.tag,
    createdAt: row.created_at.toISOString(),
  };
}

function toConnection(row: any): ConnectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    ciphertext: row.ciphertext,
    iv: row.iv,
    tag: row.tag,
    createdAt: row.created_at.toISOString(),
  };
}

function toFile(row: any): FileRecord {
  return {
    id: row.id,
    botId: row.bot_id,
    userId: row.user_id,
    workspaceId: row.workspace_id ?? undefined,
    name: row.name,
    content: row.content,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSession(row: any): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.data?.title ?? "New chat",
    messages: row.data?.messages ?? [],
    botId: row.data?.botId,
    kind: row.data?.kind,
    participants: row.data?.participants,
    summary: row.data?.summary,
    summaryUpTo: row.data?.summaryUpTo,
    createdAt: row.created_at.toISOString(),
  };
}
