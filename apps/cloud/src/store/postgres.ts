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
  DeviceKey,
  FileRecord,
  FriendRequestRecord,
  GroupMemberRecord,
  GroupRecord,
  InvoiceRecord,
  LearnedSkillRecord,
  LedgerRecord,
  MediaRecipe,
  MediaRecord,
  ModelPricingRecord,
  NotificationRecord,
  PageRecord,
  PageRoleRecord,
  Plan,
  PlatformSettings,
  PollRecord,
  PostCommentRecord,
  PostRecord,
  PostReportRecord,
  PostStatsRecord,
  ProviderRole,
  ProviderRoleConfig,
  QuestRecord,
  ReactionType,
  SecretRecord,
  SessionRecord,
  Store,
  StoryRecord,
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
      "INSERT INTO users (id, email, password_hash, role, plan, handle, display_name, avatar_emoji, avatar_scheme, avatar_url, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
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
        record.avatarUrl ?? null,
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
    profile: {
      handle?: string;
      displayName?: string;
      avatarEmoji?: string;
      avatarScheme?: number;
      avatarUrl?: string | null;
    },
  ): Promise<void> {
    await this.pool.query(
      "UPDATE users SET handle = COALESCE($1, handle), display_name = COALESCE($2, display_name), " +
        "avatar_emoji = COALESCE($3, avatar_emoji), avatar_scheme = COALESCE($4, avatar_scheme), " +
        "avatar_url = CASE WHEN $6 THEN $5 ELSE avatar_url END WHERE id = $7",
      [
        profile.handle ?? null,
        profile.displayName ?? null,
        profile.avatarEmoji ?? null,
        profile.avatarScheme ?? null,
        profile.avatarUrl ?? null,
        profile.avatarUrl !== undefined,
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
        readAt: record.readAt,
      },
      record.createdAt,
    ]);
  }

  async updateSession(record: SessionRecord): Promise<void> {
    await withLock(record.id, async () => {
      const { rows } = await this.pool.query("SELECT data FROM sessions WHERE id = $1", [record.id]);
      const existing = rows[0]?.data as
        | {
            messages?: SessionRecord["messages"];
            summary?: string;
            summaryUpTo?: number;
            readAt?: Record<string, string>;
          }
        | undefined;
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
            readAt: record.readAt ?? existing?.readAt,
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
      "INSERT INTO work_items (id, workspace_id, quest_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [record.id, record.workspaceId, record.questId ?? null, record, record.createdAt, record.updatedAt],
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
    await this.pool.query("UPDATE work_items SET data = $1, quest_id = $2, updated_at = $3 WHERE id = $4", [
      record,
      record.questId ?? null,
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

  async createQuest(record: QuestRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO quests (id, workspace_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
      [record.id, record.workspaceId, record, record.createdAt, record.updatedAt],
    );
  }

  async getQuest(id: string): Promise<QuestRecord | null> {
    const { rows } = await this.pool.query("SELECT data FROM quests WHERE id = $1", [id]);
    return (rows[0]?.data as QuestRecord) ?? null;
  }

  async listQuests(workspaceId: string): Promise<QuestRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT data FROM quests WHERE workspace_id = $1 ORDER BY created_at ASC",
      [workspaceId],
    );
    return rows.map((row) => row.data as QuestRecord);
  }

  async updateQuest(record: QuestRecord): Promise<void> {
    await this.pool.query("UPDATE quests SET data = $1, updated_at = $2 WHERE id = $3", [
      record,
      record.updatedAt,
      record.id,
    ]);
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
      "SELECT subject, capability, granted, state, successes, failures, last_used_at, updated_at " +
        "FROM capability_grants WHERE workspace_id = $1",
      [workspaceId],
    );
    return rows.map((row) => ({
      workspaceId,
      subject: row.subject as string,
      capability: row.capability as string,
      granted: row.granted as boolean,
      state: (row.state as CapabilityGrantRecord["state"] | null) ?? undefined,
      successes: row.successes === null ? undefined : Number(row.successes),
      failures: row.failures === null ? undefined : Number(row.failures),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string).toISOString() : undefined,
      updatedAt: new Date(row.updated_at as string).toISOString(),
    }));
  }

  async setCapabilityGrant(record: CapabilityGrantRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO capability_grants (workspace_id, subject, capability, granted, state, successes, failures, last_used_at, updated_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) " +
        "ON CONFLICT (workspace_id, subject, capability) DO UPDATE SET granted = EXCLUDED.granted, " +
        "state = EXCLUDED.state, successes = EXCLUDED.successes, failures = EXCLUDED.failures, " +
        "last_used_at = EXCLUDED.last_used_at, updated_at = EXCLUDED.updated_at",
      [
        record.workspaceId,
        record.subject,
        record.capability,
        record.granted,
        record.state ?? null,
        record.successes ?? 0,
        record.failures ?? 0,
        record.lastUsedAt ?? null,
        record.updatedAt,
      ],
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
      "INSERT INTO secrets (id, user_id, workspace_id, name, ciphertext, iv, tag, created_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        record.id,
        record.userId,
        record.workspaceId ?? null,
        record.name,
        record.ciphertext,
        record.iv,
        record.tag,
        record.createdAt,
      ],
    );
  }

  async listSecrets(userId: string): Promise<SecretRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, workspace_id, name, ciphertext, iv, tag, created_at FROM secrets WHERE user_id = $1 AND workspace_id IS NULL ORDER BY name",
      [userId],
    );
    return rows.map(toSecret);
  }

  async listWorkspaceSecrets(workspaceId: string): Promise<SecretRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, workspace_id, name, ciphertext, iv, tag, created_at FROM secrets WHERE workspace_id = $1 ORDER BY name",
      [workspaceId],
    );
    return rows.map(toSecret);
  }

  async getSecret(userId: string, name: string): Promise<SecretRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, workspace_id, name, ciphertext, iv, tag, created_at FROM secrets WHERE user_id = $1 AND name = $2 AND workspace_id IS NULL",
      [userId, name],
    );
    return rows[0] ? toSecret(rows[0]) : null;
  }

  async getWorkspaceSecret(workspaceId: string, name: string): Promise<SecretRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, workspace_id, name, ciphertext, iv, tag, created_at FROM secrets WHERE workspace_id = $1 AND name = $2",
      [workspaceId, name],
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
      "INSERT INTO usage_events (id, user_id, task_id, prompt_tokens, completion_tokens, model, quest_id, created_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        record.id,
        record.userId,
        record.taskId,
        record.promptTokens,
        record.completionTokens,
        record.model ?? null,
        record.questId ?? null,
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

  async usageTokensForQuest(questId: string): Promise<number> {
    const { rows } = await this.pool.query(
      "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens FROM usage_events WHERE quest_id = $1",
      [questId],
    );
    return Number(rows[0]?.tokens ?? 0);
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

  async listProviderRoles(): Promise<ProviderRoleConfig[]> {
    const { rows } = await this.pool.query("SELECT data FROM provider_roles");
    return rows.map((row) => row.data as ProviderRoleConfig);
  }

  async getProviderRole(role: ProviderRole): Promise<ProviderRoleConfig | null> {
    const { rows } = await this.pool.query("SELECT data FROM provider_roles WHERE role = $1", [role]);
    return (rows[0]?.data as ProviderRoleConfig) ?? null;
  }

  async saveProviderRole(config: ProviderRoleConfig): Promise<void> {
    await this.pool.query(
      "INSERT INTO provider_roles (role, data) VALUES ($1, $2) ON CONFLICT (role) DO UPDATE SET data = EXCLUDED.data",
      [config.role, config],
    );
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

  async listDeviceKeys(userId: string): Promise<DeviceKey[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM device_keys WHERE user_id = $1 ORDER BY updated_at DESC",
      [userId],
    );
    return rows.map(toDeviceKey);
  }

  async getDeviceKey(userId: string, deviceId: string): Promise<DeviceKey | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM device_keys WHERE user_id = $1 AND device_id = $2",
      [userId, deviceId],
    );
    return rows[0] ? toDeviceKey(rows[0]) : null;
  }

  async saveDeviceKey(record: DeviceKey): Promise<void> {
    await this.pool.query(
      "INSERT INTO device_keys (id, user_id, device_id, public_key, created_at, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6) " +
        "ON CONFLICT (user_id, device_id) DO UPDATE SET public_key = EXCLUDED.public_key, " +
        "updated_at = EXCLUDED.updated_at",
      [record.id, record.userId, record.deviceId, record.publicKey, record.createdAt, record.updatedAt],
    );
  }

  async listUsersByIds(ids: string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query("SELECT * FROM users WHERE id = ANY($1)", [ids]);
    return rows.map(toUser);
  }

  async createPost(record: PostRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO posts (id, author_id, body, media_id, page_id, repost_of, group_id, audience, scheduled_at, created_at, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        record.id,
        record.authorId,
        record.body,
        record.mediaId ?? null,
        record.pageId ?? null,
        record.repostOf ?? null,
        record.groupId ?? null,
        record.audience ?? "friends",
        record.scheduledAt ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async getPost(id: string): Promise<PostRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM posts WHERE id = $1", [id]);
    return rows[0] ? toPost(rows[0]) : null;
  }

  async addPostMedia(postId: string, mediaId: string, position: number): Promise<void> {
    await this.pool.query(
      "INSERT INTO post_media (post_id, media_id, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [postId, mediaId, position],
    );
  }

  async listPostMedia(postId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      "SELECT media_id FROM post_media WHERE post_id = $1 ORDER BY position ASC",
      [postId],
    );
    return rows.map((row) => row.media_id as string);
  }

  async addPostTag(postId: string, tag: string): Promise<void> {
    await this.pool.query("INSERT INTO post_hashtags (post_id, tag) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
      postId,
      tag.replace(/^#/, "").toLowerCase(),
    ]);
  }

  async listPostTags(postId: string): Promise<string[]> {
    const { rows } = await this.pool.query("SELECT tag FROM post_hashtags WHERE post_id = $1 ORDER BY tag", [
      postId,
    ]);
    return rows.map((row) => row.tag as string);
  }

  async listPostsByTag(tag: string, limit: number): Promise<PostRecord[]> {
    const capped = Math.max(1, Math.min(100, limit));
    const { rows } = await this.pool.query(
      "SELECT p.* FROM posts p JOIN post_hashtags t ON t.post_id = p.id " +
        "WHERE t.tag = $1 ORDER BY p.created_at DESC LIMIT $2",
      [tag.replace(/^#/, "").toLowerCase(), capped],
    );
    return rows.map(toPost);
  }

  async deletePost(authorId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM posts WHERE id = $1 AND author_id = $2", [
      id,
      authorId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async listFeedPosts(authorIds: string[], limit: number, before?: string): Promise<PostRecord[]> {
    if (authorIds.length === 0) return [];
    const capped = Math.max(1, Math.min(100, limit));
    const { rows } = before
      ? await this.pool.query(
          "SELECT * FROM posts WHERE author_id = ANY($1) AND created_at < $2 ORDER BY created_at DESC LIMIT $3",
          [authorIds, before, capped],
        )
      : await this.pool.query(
          "SELECT * FROM posts WHERE author_id = ANY($1) ORDER BY created_at DESC LIMIT $2",
          [authorIds, capped],
        );
    return rows.map(toPost);
  }

  async listPostsByAuthor(authorId: string, limit: number): Promise<PostRecord[]> {
    const capped = Math.max(1, Math.min(100, limit));
    const { rows } = await this.pool.query(
      "SELECT * FROM posts WHERE author_id = $1 ORDER BY created_at DESC LIMIT $2",
      [authorId, capped],
    );
    return rows.map(toPost);
  }

  async listTrendingPosts(authorIds: string[], sinceIso: string, limit: number): Promise<PostRecord[]> {
    if (authorIds.length === 0) return [];
    const capped = Math.max(1, Math.min(50, limit));
    const { rows } = await this.pool.query(
      "SELECT p.*, " +
        "(SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id) + " +
        "(SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) + " +
        "(SELECT COUNT(*) FROM post_shares WHERE post_id = p.id) AS score " +
        "FROM posts p WHERE p.author_id = ANY($1) AND p.created_at >= $2 " +
        "ORDER BY score DESC, p.created_at DESC LIMIT $3",
      [authorIds, sinceIso, capped],
    );
    return rows.map(toPost);
  }

  async setPostReaction(postId: string, userId: string, reaction: ReactionType | null): Promise<void> {
    if (reaction) {
      await this.pool.query(
        "INSERT INTO post_reactions (post_id, user_id, reaction) VALUES ($1,$2,$3) " +
          "ON CONFLICT (post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction",
        [postId, userId, reaction],
      );
    } else {
      await this.pool.query("DELETE FROM post_reactions WHERE post_id = $1 AND user_id = $2", [
        postId,
        userId,
      ]);
    }
  }

  async listPostComments(postId: string): Promise<PostCommentRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM post_comments WHERE post_id = $1 ORDER BY created_at ASC",
      [postId],
    );
    return rows.map(toPostComment);
  }

  async getPostComment(id: string): Promise<PostCommentRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM post_comments WHERE id = $1", [id]);
    return rows[0] ? toPostComment(rows[0]) : null;
  }

  async createPostComment(record: PostCommentRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO post_comments (id, post_id, author_id, body, parent_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [record.id, record.postId, record.authorId, record.body, record.parentId ?? null, record.createdAt],
    );
  }

  async deletePostComment(authorId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM post_comments WHERE id = $1 AND author_id = $2", [
      id,
      authorId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async setPostShare(postId: string, userId: string, shared: boolean): Promise<void> {
    if (shared) {
      await this.pool.query(
        "INSERT INTO post_shares (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [postId, userId],
      );
    } else {
      await this.pool.query("DELETE FROM post_shares WHERE post_id = $1 AND user_id = $2", [postId, userId]);
    }
  }

  async setCommentReaction(commentId: string, userId: string, reaction: ReactionType | null): Promise<void> {
    if (reaction) {
      await this.pool.query(
        "INSERT INTO comment_reactions (comment_id, user_id, reaction) VALUES ($1,$2,$3) " +
          "ON CONFLICT (comment_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction",
        [commentId, userId, reaction],
      );
    } else {
      await this.pool.query("DELETE FROM comment_reactions WHERE comment_id = $1 AND user_id = $2", [
        commentId,
        userId,
      ]);
    }
  }

  async createGroup(record: GroupRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO groups (id, owner_id, name, handle, about, avatar_emoji, created_at, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        record.id,
        record.ownerId,
        record.name,
        record.handle,
        record.about ?? null,
        record.avatarEmoji ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async getGroup(id: string): Promise<GroupRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM groups WHERE id = $1", [id]);
    return rows[0] ? toGroup(rows[0]) : null;
  }

  async getGroupByHandle(handle: string): Promise<GroupRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM groups WHERE lower(handle) = lower($1)", [
      handle.replace(/^@/, ""),
    ]);
    return rows[0] ? toGroup(rows[0]) : null;
  }

  async listGroupsForUser(userId: string): Promise<GroupRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT g.* FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = $1 ORDER BY g.created_at ASC",
      [userId],
    );
    return rows.map(toGroup);
  }

  async updateGroup(record: GroupRecord): Promise<void> {
    await this.pool.query(
      "UPDATE groups SET name=$2, handle=$3, about=$4, avatar_emoji=$5, updated_at=$6 WHERE id=$1",
      [
        record.id,
        record.name,
        record.handle,
        record.about ?? null,
        record.avatarEmoji ?? null,
        record.updatedAt,
      ],
    );
  }

  async deleteGroup(ownerId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM groups WHERE id = $1 AND owner_id = $2", [id, ownerId]);
    return (result.rowCount ?? 0) > 0;
  }

  async setGroupMember(record: GroupMemberRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role",
      [record.groupId, record.userId, record.role],
    );
  }

  async deleteGroupMember(groupId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [
      groupId,
      userId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2",
      [groupId, userId],
    );
    return rows.length > 0;
  }

  async listGroupMembers(groupId: string): Promise<GroupMemberRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM group_members WHERE group_id = $1", [groupId]);
    return rows.map(toGroupMember);
  }

  async setPostSaved(postId: string, userId: string, saved: boolean): Promise<void> {
    if (saved) {
      await this.pool.query("INSERT INTO post_saves (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
        postId,
        userId,
      ]);
    } else {
      await this.pool.query("DELETE FROM post_saves WHERE post_id = $1 AND user_id = $2", [postId, userId]);
    }
  }

  async listSavedPostIds(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      "SELECT post_id FROM post_saves WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows.map((row) => row.post_id as string);
  }

  async setPostHidden(postId: string, userId: string, hidden: boolean): Promise<void> {
    if (hidden) {
      await this.pool.query("INSERT INTO post_hides (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
        postId,
        userId,
      ]);
    } else {
      await this.pool.query("DELETE FROM post_hides WHERE post_id = $1 AND user_id = $2", [postId, userId]);
    }
  }

  async listHiddenPostIds(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query("SELECT post_id FROM post_hides WHERE user_id = $1", [userId]);
    return rows.map((row) => row.post_id as string);
  }

  async setAuthorMute(userId: string, authorId: string, until: string | null): Promise<void> {
    await this.pool.query(
      "INSERT INTO author_mutes (user_id, author_id, until) VALUES ($1,$2,$3) " +
        "ON CONFLICT (user_id, author_id) DO UPDATE SET until = EXCLUDED.until",
      [userId, authorId, until],
    );
  }

  async deleteAuthorMute(userId: string, authorId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM author_mutes WHERE user_id = $1 AND author_id = $2", [
      userId,
      authorId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async listMutedAuthorIds(userId: string, nowIso: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      "SELECT author_id FROM author_mutes WHERE user_id = $1 AND (until IS NULL OR until > $2)",
      [userId, nowIso],
    );
    return rows.map((row) => row.author_id as string);
  }

  async listGroupPosts(groupId: string, limit: number): Promise<PostRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM posts WHERE group_id = $1 ORDER BY created_at DESC LIMIT $2",
      [groupId, Math.max(1, Math.min(100, limit))],
    );
    return rows.map(toPost);
  }

  async createStory(record: StoryRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO stories (id, author_id, media_id, caption, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        record.id,
        record.authorId,
        record.mediaId ?? null,
        record.caption,
        record.createdAt,
        record.expiresAt,
      ],
    );
  }

  async listActiveStories(authorIds: string[], nowIso: string, limit: number): Promise<StoryRecord[]> {
    if (authorIds.length === 0) return [];
    const { rows } = await this.pool.query(
      "SELECT * FROM stories WHERE author_id = ANY($1) AND expires_at > $2 ORDER BY created_at DESC LIMIT $3",
      [authorIds, nowIso, Math.max(1, Math.min(100, limit))],
    );
    return rows.map(toStory);
  }

  async createPoll(postId: string, options: string[], closesAt?: string): Promise<void> {
    await this.pool.query("INSERT INTO post_polls (post_id, closes_at) VALUES ($1,$2)", [
      postId,
      closesAt ?? null,
    ]);
    let index = 0;
    for (const label of options) {
      await this.pool.query("INSERT INTO poll_options (id, post_id, label, position) VALUES ($1,$2,$3,$4)", [
        `${postId}:opt${index}`,
        postId,
        label,
        index,
      ]);
      index += 1;
    }
  }

  async getPoll(postId: string, viewerId: string): Promise<PollRecord | null> {
    const poll = await this.pool.query("SELECT closes_at FROM post_polls WHERE post_id = $1", [postId]);
    if (poll.rows.length === 0) return null;
    const closesAt = poll.rows[0].closes_at ? new Date(poll.rows[0].closes_at).toISOString() : undefined;
    const { rows } = await this.pool.query(
      "SELECT o.id, o.label, (SELECT COUNT(*)::int FROM poll_votes v WHERE v.option_id = o.id) AS votes " +
        "FROM poll_options o WHERE o.post_id = $1 ORDER BY o.position ASC",
      [postId],
    );
    const options = rows.map((row) => ({
      id: row.id as string,
      label: row.label as string,
      votes: Number(row.votes ?? 0),
    }));
    const total = options.reduce((sum, option) => sum + option.votes, 0);
    const mine = await this.pool.query(
      "SELECT option_id FROM poll_votes WHERE post_id = $1 AND user_id = $2",
      [postId, viewerId],
    );
    return {
      postId,
      options,
      total,
      myVote: (mine.rows[0]?.option_id as string) ?? null,
      closesAt,
      closed: Boolean(closesAt && closesAt <= new Date().toISOString()),
    };
  }

  async votePoll(postId: string, optionId: string, userId: string): Promise<boolean> {
    const option = await this.pool.query("SELECT 1 FROM poll_options WHERE id = $1 AND post_id = $2", [
      optionId,
      postId,
    ]);
    if (option.rows.length === 0) return false;
    const poll = await this.pool.query("SELECT closes_at FROM post_polls WHERE post_id = $1", [postId]);
    const closesAt = poll.rows[0]?.closes_at;
    if (closesAt && new Date(closesAt).getTime() <= Date.now()) return false;
    await this.pool.query(
      "INSERT INTO poll_votes (post_id, option_id, user_id) VALUES ($1,$2,$3) " +
        "ON CONFLICT (post_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id",
      [postId, optionId, userId],
    );
    return true;
  }

  async setCommentHidden(commentId: string, hidden: boolean): Promise<void> {
    await this.pool.query("UPDATE post_comments SET hidden = $2 WHERE id = $1", [commentId, hidden]);
  }

  async listPageComments(pageId: string, limit: number): Promise<PostCommentRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT c.* FROM post_comments c JOIN posts p ON p.id = c.post_id " +
        "WHERE p.page_id = $1 ORDER BY c.created_at DESC LIMIT $2",
      [pageId, Math.max(1, Math.min(200, limit))],
    );
    return rows.map(toPostComment);
  }

  async getCommentStats(
    commentId: string,
    viewerId: string,
  ): Promise<{ reactions: Record<ReactionType, number>; myReaction: ReactionType | null }> {
    const reactions: Record<ReactionType, number> = {
      like: 0,
      love: 0,
      care: 0,
      haha: 0,
      wow: 0,
      sad: 0,
      angry: 0,
    };
    const { rows } = await this.pool.query(
      "SELECT reaction, COUNT(*)::int AS n FROM comment_reactions WHERE comment_id = $1 GROUP BY reaction",
      [commentId],
    );
    for (const row of rows) {
      const reaction = row.reaction as ReactionType;
      if (reaction in reactions) reactions[reaction] = Number(row.n);
    }
    const mine = await this.pool.query(
      "SELECT reaction FROM comment_reactions WHERE comment_id = $1 AND user_id = $2",
      [commentId, viewerId],
    );
    return { reactions, myReaction: (mine.rows[0]?.reaction as ReactionType) ?? null };
  }

  async getPostStats(postId: string, viewerId: string): Promise<PostStatsRecord> {
    const reactions: Record<ReactionType, number> = {
      like: 0,
      love: 0,
      care: 0,
      haha: 0,
      wow: 0,
      sad: 0,
      angry: 0,
    };
    const grouped = await this.pool.query(
      "SELECT reaction, COUNT(*)::int AS n FROM post_reactions WHERE post_id = $1 GROUP BY reaction",
      [postId],
    );
    let likes = 0;
    for (const row of grouped.rows) {
      const reaction = row.reaction as ReactionType;
      if (reaction in reactions) reactions[reaction] = Number(row.n);
      likes += Number(row.n);
    }
    const { rows } = await this.pool.query(
      "SELECT " +
        "(SELECT COUNT(*)::int FROM post_comments WHERE post_id = $1) AS comments, " +
        "(SELECT COUNT(*)::int FROM post_shares WHERE post_id = $1) AS shares, " +
        "EXISTS (SELECT 1 FROM post_reactions WHERE post_id = $1 AND user_id = $2) AS liked, " +
        "EXISTS (SELECT 1 FROM post_shares WHERE post_id = $1 AND user_id = $2) AS shared, " +
        "(SELECT reaction FROM post_reactions WHERE post_id = $1 AND user_id = $2) AS mine",
      [postId, viewerId],
    );
    const row = rows[0] ?? {};
    return {
      likes,
      comments: Number(row.comments ?? 0),
      shares: Number(row.shares ?? 0),
      likedByMe: row.liked === true,
      sharedByMe: row.shared === true,
      reactions,
      myReaction: (row.mine as ReactionType) ?? null,
    };
  }

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [blockerId, blockedId],
    );
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2", [
      blockerId,
      blockedId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async listBlockedIds(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query("SELECT blocked_id FROM blocks WHERE blocker_id = $1", [userId]);
    return rows.map((row) => row.blocked_id as string);
  }

  async listBlockedEither(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      "SELECT CASE WHEN blocker_id = $1 THEN blocked_id ELSE blocker_id END AS id " +
        "FROM blocks WHERE blocker_id = $1 OR blocked_id = $1",
      [userId],
    );
    return rows.map((row) => row.id as string);
  }

  async isBlockedEither(a: string, b: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1",
      [a, b],
    );
    return rows.length > 0;
  }

  async createReport(record: PostReportRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO post_reports (id, post_id, reporter_id, reason, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [record.id, record.postId, record.reporterId, record.reason ?? null, record.status, record.createdAt],
    );
  }

  async listReports(limit: number): Promise<PostReportRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM post_reports ORDER BY created_at DESC LIMIT $1", [
      Math.max(1, Math.min(200, limit)),
    ]);
    return rows.map(toReport);
  }

  async updateReportStatus(id: string, status: PostReportRecord["status"]): Promise<boolean> {
    const result = await this.pool.query("UPDATE post_reports SET status = $2 WHERE id = $1", [id, status]);
    return (result.rowCount ?? 0) > 0;
  }

  async createPage(record: PageRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO pages (id, owner_id, workspace_id, bot_id, handle, name, category, about, avatar_emoji, avatar_url, cover_url, cta, verified, created_at, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [
        record.id,
        record.ownerId,
        record.workspaceId ?? null,
        record.botId ?? null,
        record.handle,
        record.name,
        record.category ?? null,
        record.about ?? null,
        record.avatarEmoji ?? null,
        record.avatarUrl ?? null,
        record.coverUrl ?? null,
        record.cta ?? null,
        record.verified,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async getPage(id: string): Promise<PageRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM pages WHERE id = $1", [id]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  async getPageByHandle(handle: string): Promise<PageRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM pages WHERE lower(handle) = lower($1)", [
      handle.replace(/^@/, ""),
    ]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  async listPages(ownerId: string): Promise<PageRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM pages WHERE owner_id = $1 ORDER BY created_at ASC",
      [ownerId],
    );
    return rows.map(toPage);
  }

  async updatePage(record: PageRecord): Promise<void> {
    await this.pool.query(
      "UPDATE pages SET handle=$2, name=$3, category=$4, about=$5, avatar_emoji=$6, avatar_url=$7, cover_url=$8, cta=$9, verified=$10, updated_at=$11 WHERE id=$1",
      [
        record.id,
        record.handle,
        record.name,
        record.category ?? null,
        record.about ?? null,
        record.avatarEmoji ?? null,
        record.avatarUrl ?? null,
        record.coverUrl ?? null,
        record.cta ?? null,
        record.verified,
        record.updatedAt,
      ],
    );
  }

  async deletePage(ownerId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM pages WHERE id = $1 AND owner_id = $2", [id, ownerId]);
    return (result.rowCount ?? 0) > 0;
  }

  async setPagePinnedPost(pageId: string, postId: string | null): Promise<void> {
    await this.pool.query("UPDATE pages SET pinned_post_id = $2, updated_at = now() WHERE id = $1", [
      pageId,
      postId,
    ]);
  }

  async setPageRole(record: PageRoleRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO page_roles (page_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (page_id, user_id) DO UPDATE SET role = EXCLUDED.role",
      [record.pageId, record.userId, record.role],
    );
  }

  async getPageRole(pageId: string, userId: string): Promise<PageRoleRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM page_roles WHERE page_id = $1 AND user_id = $2", [
      pageId,
      userId,
    ]);
    const row = rows[0];
    return row ? { pageId: row.page_id, userId: row.user_id, role: row.role } : null;
  }

  async listPageRoles(pageId: string): Promise<PageRoleRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM page_roles WHERE page_id = $1", [pageId]);
    return rows.map((row) => ({ pageId: row.page_id, userId: row.user_id, role: row.role }));
  }

  async deletePageRole(pageId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM page_roles WHERE page_id = $1 AND user_id = $2", [
      pageId,
      userId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async followPage(pageId: string, userId: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO page_followers (page_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [pageId, userId],
    );
  }

  async unfollowPage(pageId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM page_followers WHERE page_id = $1 AND user_id = $2", [
      pageId,
      userId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async isFollowingPage(pageId: string, userId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM page_followers WHERE page_id = $1 AND user_id = $2",
      [pageId, userId],
    );
    return rows.length > 0;
  }

  async listPageFollowerIds(pageId: string): Promise<string[]> {
    const { rows } = await this.pool.query("SELECT user_id FROM page_followers WHERE page_id = $1", [pageId]);
    return rows.map((row) => row.user_id as string);
  }

  async listFollowedPageIds(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query("SELECT page_id FROM page_followers WHERE user_id = $1", [userId]);
    return rows.map((row) => row.page_id as string);
  }

  async countPageFollowers(pageId: string): Promise<number> {
    const { rows } = await this.pool.query("SELECT COUNT(*) AS n FROM page_followers WHERE page_id = $1", [
      pageId,
    ]);
    return Number(rows[0]?.n ?? 0);
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

function toDeviceKey(row: any): DeviceKey {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    publicKey: row.public_key,
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
    avatarUrl: row.avatar_url ?? undefined,
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

function toPost(row: any): PostRecord {
  return {
    id: row.id,
    authorId: row.author_id,
    body: row.body ?? "",
    mediaId: row.media_id ?? undefined,
    pageId: row.page_id ?? undefined,
    repostOf: row.repost_of ?? undefined,
    groupId: row.group_id ?? undefined,
    audience: row.audience ?? "friends",
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toPostComment(row: any): PostCommentRecord {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    body: row.body,
    parentId: row.parent_id ?? undefined,
    hidden: row.hidden === true,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toGroup(row: any): GroupRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    handle: row.handle,
    about: row.about ?? undefined,
    avatarEmoji: row.avatar_emoji ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toGroupMember(row: any): GroupMemberRecord {
  return {
    groupId: row.group_id,
    userId: row.user_id,
    role: row.role === "admin" ? "admin" : "member",
  };
}

function toStory(row: any): StoryRecord {
  return {
    id: row.id,
    authorId: row.author_id,
    mediaId: row.media_id ?? undefined,
    caption: row.caption ?? "",
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

function toPage(row: any): PageRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    workspaceId: row.workspace_id ?? undefined,
    botId: row.bot_id ?? undefined,
    handle: row.handle,
    name: row.name,
    category: row.category ?? undefined,
    about: row.about ?? undefined,
    avatarEmoji: row.avatar_emoji ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    coverUrl: row.cover_url ?? undefined,
    cta: row.cta ?? undefined,
    verified: row.verified === true,
    pinnedPostId: row.pinned_post_id ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toReport(row: any): PostReportRecord {
  return {
    id: row.id,
    postId: row.post_id,
    reporterId: row.reporter_id,
    reason: row.reason ?? undefined,
    status: row.status === "reviewed" ? "reviewed" : row.status === "dismissed" ? "dismissed" : "pending",
    createdAt: new Date(row.created_at).toISOString(),
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
    workspaceId: row.workspace_id ?? undefined,
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
    readAt: row.data?.readAt,
    createdAt: row.created_at.toISOString(),
  };
}
