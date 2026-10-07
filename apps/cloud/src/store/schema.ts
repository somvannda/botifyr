/** Schema applied on startup (idempotent). */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_emoji TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_scheme INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_idx ON users (lower(handle)) WHERE handle IS NOT NULL;

CREATE TABLE IF NOT EXISTS friendships (
  user_a     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b)
);
CREATE INDEX IF NOT EXISTS friendships_b_idx ON friendships (user_b);

CREATE TABLE IF NOT EXISTS friend_requests (
  id         TEXT PRIMARY KEY,
  from_user  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS friend_requests_to_idx ON friend_requests (to_user, status);
CREATE INDEX IF NOT EXISTS friend_requests_from_idx ON friend_requests (from_user, status);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
-- Access vs long-lived refresh tokens; only 'refresh' can be exchanged.
ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'access';

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS data JSONB;
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_session_idx ON tasks (session_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id         TEXT PRIMARY KEY,
  task_id    TEXT,
  user_id    TEXT,
  type       TEXT NOT NULL,
  tool_name  TEXT,
  detail     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_task_idx ON audit_events (task_id, created_at);

CREATE TABLE IF NOT EXISTS secrets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv         TEXT NOT NULL,
  tag        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS bots (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bots_user_idx ON bots (user_id, created_at);

/* Company workspaces (see docs/company-workspace.md). */
CREATE TABLE IF NOT EXISTS workspaces (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces (owner_id, created_at);

CREATE TABLE IF NOT EXISTS workspace_roles (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bot_id       TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  data         JSONB NOT NULL,
  PRIMARY KEY (workspace_id, bot_id)
);
CREATE INDEX IF NOT EXISTS workspace_roles_ws_idx ON workspace_roles (workspace_id);

/* Company board: work items (docs/company-os.md §7). */
CREATE TABLE IF NOT EXISTS work_items (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_items_ws_idx ON work_items (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS connections (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv         TEXT NOT NULL,
  tag        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id           TEXT,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_user_idx ON usage_events (user_id, created_at);

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  bot_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id, name)
);
CREATE INDEX IF NOT EXISTS files_bot_idx ON files (bot_id);

CREATE TABLE IF NOT EXISTS learned_skills (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  data        JSONB NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id, created_at);

CREATE TABLE IF NOT EXISTS media (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  size       BIGINT NOT NULL DEFAULT 0,
  mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
  location   TEXT NOT NULL DEFAULT 'server',
  device     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, name)
);
CREATE INDEX IF NOT EXISTS media_user_idx ON media (user_id, created_at);

/* Self-learned per-domain extraction recipes (yt-dlp-unsupported sites). */
CREATE TABLE IF NOT EXISTS media_recipes (
  domain     TEXT PRIMARY KEY,
  pattern    TEXT NOT NULL,
  headers    JSONB,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_recipes_status_idx ON media_recipes (status);

/* --- Billing (prepaid plans + on-demand credits via ChmabaPay) ------------- */
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_status TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'free';
UPDATE users SET plan = 'free' WHERE plan IS NULL OR plan = 'trial';

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS model TEXT;

-- One row (id='global'): all pricing/policy an admin can change without a deploy.
CREATE TABLE IF NOT EXISTS platform_settings (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-model provider cost, so on-demand pricing = cost × (1 + markup).
CREATE TABLE IF NOT EXISTS model_pricing (
  model               TEXT PRIMARY KEY,
  provider            TEXT,
  input_cents_per_m   INTEGER NOT NULL DEFAULT 0,
  output_cents_per_m  INTEGER NOT NULL DEFAULT 0,
  markup_percent      INTEGER,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL DEFAULT 'plan',
  plan               TEXT,
  amount_cents       INTEGER NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'USD',
  reference_id       TEXT,
  provider_payment_id TEXT,
  checkout_url       TEXT,
  qr_string          TEXT,
  provider_status    TEXT NOT NULL DEFAULT 'pending',
  status             TEXT NOT NULL DEFAULT 'open',
  period_start       TIMESTAMPTZ,
  period_end         TIMESTAMPTZ,
  reminders          JSONB NOT NULL DEFAULT '{}',
  expires_at         TIMESTAMPTZ,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_user_idx ON invoices (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_provider_payment_idx ON invoices (provider_payment_id);

CREATE TABLE IF NOT EXISTS wallets (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  tokens       INTEGER,
  model        TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  subject    TEXT,
  body       TEXT,
  channels   JSONB NOT NULL DEFAULT '[]',
  sent       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

-- Seed the default policy and a starter model price (editable in admin).
INSERT INTO platform_settings (id, data) VALUES ('global', '{"plans":{"proPriceCents":500,"businessPriceCents":1900,"proPeriodDays":30,"includedTokens":{"pro":5000000,"business":50000000},"currency":"USD"},"freeMonthlyTokens":20000,"lowBalanceCents":100,"graceDays":7,"reminderDays":[7,3,1],"reminderChannels":{"os":true,"email":true,"telegram":true},"onDemand":{"enabled":true,"markupPercent":15,"minTopUpCents":100,"allowPro":false,"onEmpty":"block"},"fallbackPlan":"free"}')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO model_pricing (model, provider, input_cents_per_m, output_cents_per_m) VALUES
  ('deepseek-chat', 'deepseek', 27, 110)
  ON CONFLICT (model) DO NOTHING;
`;
