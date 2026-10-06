import { Pool } from "pg";
import type { Task } from "@botifyr/shared";
import type {
  ApiKeyRecord,
  AuditRecord,
  BotRecord,
  ConnectionRecord,
  FileRecord,
  LearnedSkillRecord,
  Plan,
  SecretRecord,
  SessionRecord,
  Store,
  UsageRecord,
  UserRecord,
} from "./types.js";
import { SCHEMA_SQL } from "./schema.js";

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
      "INSERT INTO users (id, email, password_hash, role, plan, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        record.id,
        record.email,
        record.passwordHash,
        record.role ?? "user",
        record.plan ?? "trial",
        record.createdAt,
      ],
    );
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, email, password_hash, role, plan, created_at FROM users WHERE lower(email) = lower($1)",
      [email],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, email, password_hash, role, plan, created_at FROM users WHERE id = $1",
      [id],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async listUsers(): Promise<UserRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, email, password_hash, role, plan, created_at FROM users ORDER BY created_at ASC",
    );
    return rows.map(toUser);
  }

  async setUserRole(id: string, role: "user" | "admin"): Promise<void> {
    await this.pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
  }

  async setUserPlan(id: string, plan: Plan): Promise<void> {
    await this.pool.query("UPDATE users SET plan = $1 WHERE id = $2", [plan, id]);
  }

  async createToken(tokenHash: string, userId: string, expiresAt: string): Promise<void> {
    await this.pool.query("INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
      tokenHash,
      userId,
      expiresAt,
    ]);
  }

  async getUserIdByTokenHash(tokenHash: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      "SELECT user_id FROM auth_tokens WHERE token_hash = $1 AND expires_at > now()",
      [tokenHash],
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
        summary: record.summary,
        summaryUpTo: record.summaryUpTo,
      },
      record.createdAt,
    ]);
  }

  async updateSession(record: SessionRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO sessions (id, user_id, data, created_at) VALUES ($1, $2, $3, $4) " +
        "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
      [
        record.id,
        record.userId,
        {
          title: record.title,
          messages: record.messages,
          botId: record.botId,
          summary: record.summary,
          summaryUpTo: record.summaryUpTo,
        },
        record.createdAt,
      ],
    );
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, data, created_at FROM sessions WHERE id = $1",
      [id],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, user_id, data, created_at FROM sessions WHERE user_id = $1 ORDER BY created_at DESC",
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
      "INSERT INTO usage_events (id, user_id, task_id, prompt_tokens, completion_tokens, created_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6)",
      [
        record.id,
        record.userId,
        record.taskId,
        record.promptTokens,
        record.completionTokens,
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
      "INSERT INTO files (id, bot_id, user_id, name, content, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) " +
        "ON CONFLICT (bot_id, name) DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at",
      [
        record.id,
        record.botId,
        record.userId,
        record.name,
        record.content,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async listFiles(botId: string): Promise<FileRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT id, bot_id, user_id, name, content, created_at, updated_at FROM files WHERE bot_id = $1 ORDER BY name",
      [botId],
    );
    return rows.map(toFile);
  }

  async getFile(userId: string, id: string): Promise<FileRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT id, bot_id, user_id, name, content, created_at, updated_at FROM files WHERE id = $1 AND user_id = $2",
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
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role ?? "user",
    plan: row.plan === "pro" ? "pro" : "trial",
    createdAt: row.created_at.toISOString(),
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
    summary: row.data?.summary,
    summaryUpTo: row.data?.summaryUpTo,
    createdAt: row.created_at.toISOString(),
  };
}
