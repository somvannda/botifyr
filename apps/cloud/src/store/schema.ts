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
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
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
/* Company secrets are shared across a workspace's employees. */
ALTER TABLE secrets ADD COLUMN IF NOT EXISTS workspace_id TEXT;
CREATE INDEX IF NOT EXISTS secrets_workspace_idx ON secrets (workspace_id);

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
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS quest_id TEXT;
CREATE INDEX IF NOT EXISTS work_items_quest_idx ON work_items (quest_id);

/* Company quests: missions above the board (docs/company-quests.md §4). */
CREATE TABLE IF NOT EXISTS quests (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quests_ws_idx ON quests (workspace_id, updated_at DESC);

/* Per-workspace token budget (docs/company-os.md §15). */
CREATE TABLE IF NOT EXISTS workspace_budget (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  limit_tokens BIGINT NOT NULL DEFAULT 0,
  used_tokens  BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* Per-subject capability grants (docs/company-os.md §8). */
CREATE TABLE IF NOT EXISTS capability_grants (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subject      TEXT NOT NULL,   -- "bot:<id>" | "role:<title>"
  capability   TEXT NOT NULL,
  granted      BOOLEAN NOT NULL DEFAULT false,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, subject, capability)
);
-- Capability trust ladder (docs/product-plan.md §3).
ALTER TABLE capability_grants ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE capability_grants ADD COLUMN IF NOT EXISTS successes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE capability_grants ADD COLUMN IF NOT EXISTS failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE capability_grants ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

/* Company reports — standups etc. (docs/company-os.md §5). */
CREATE TABLE IF NOT EXISTS company_reports (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'standup',
  data         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_reports_ws_idx ON company_reports (workspace_id, created_at DESC);

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
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS quest_id TEXT;
CREATE INDEX IF NOT EXISTS usage_quest_idx ON usage_events (quest_id);

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

/* Shared, workspace-scoped files (the company wiki). */
ALTER TABLE files ADD COLUMN IF NOT EXISTS workspace_id TEXT;
CREATE INDEX IF NOT EXISTS files_workspace_idx ON files (workspace_id);

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

/* DM end-to-end encryption: each device publishes its public identity key. */
CREATE TABLE IF NOT EXISTS device_keys (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  public_key JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS device_keys_user_idx ON device_keys (user_id);

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

-- Video translation: the admin-managed provider per role (docs/video-translation.md).
CREATE TABLE IF NOT EXISTS provider_roles (
  role TEXT PRIMARY KEY,
  data JSONB NOT NULL
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

/* Feed (social posts) — see docs/feed.md */
CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  media_id   TEXT REFERENCES media(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_created_idx ON posts (created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_comments_post_idx ON post_comments (post_id, created_at);
/* Replies: one level. Deleting a parent removes its replies. */
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES post_comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS post_comments_parent_idx ON post_comments (parent_id);

CREATE TABLE IF NOT EXISTS post_shares (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

/* Hashtags (docs/feed-next.md §FR-11). */
CREATE TABLE IF NOT EXISTS post_hashtags (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX IF NOT EXISTS post_hashtags_tag_idx ON post_hashtags (tag);

/* Comment reactions (docs/feed-next.md §FR-3). */
CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id TEXT NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

/* Multi-image posts (docs/feed-next.md §FR-5). */
CREATE TABLE IF NOT EXISTS post_media (
  post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, media_id)
);
CREATE INDEX IF NOT EXISTS post_media_post_idx ON post_media (post_id, position);

/* Reactions (superset of likes). One per user per post. */
CREATE TABLE IF NOT EXISTS post_reactions (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

/* Moderation: blocks (one-directional, enforced both ways on read) + reports. */
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id);

CREATE TABLE IF NOT EXISTS post_reports (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_reports_status_idx ON post_reports (status, created_at DESC);

/* Pages: public, followable entities (docs/feed-next.md). */
CREATE TABLE IF NOT EXISTS pages (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT,
  bot_id       TEXT,
  handle       TEXT NOT NULL,
  name         TEXT NOT NULL,
  category     TEXT,
  about        TEXT,
  avatar_emoji TEXT,
  avatar_url   TEXT,
  cover_url    TEXT,
  cta          TEXT,
  verified     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pages_handle_idx ON pages (lower(handle));
ALTER TABLE pages ADD COLUMN IF NOT EXISTS pinned_post_id TEXT;

CREATE TABLE IF NOT EXISTS page_roles (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL,
  PRIMARY KEY (page_id, user_id)
);

CREATE TABLE IF NOT EXISTS page_followers (
  page_id    TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, user_id)
);

/* Posts may be authored by a Page. */
ALTER TABLE posts ADD COLUMN IF NOT EXISTS page_id TEXT REFERENCES pages(id) ON DELETE CASCADE;
/* Reposts (shares) link back to the original post. */
ALTER TABLE posts ADD COLUMN IF NOT EXISTS repost_of TEXT REFERENCES posts(id) ON DELETE SET NULL;
/* Post audience: public | friends | only_me. */
ALTER TABLE posts ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'friends';
/* Scheduled publish time (null = published now). */
ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- Seed the default policy and a starter model price (editable in admin).
INSERT INTO platform_settings (id, data) VALUES ('global', '{"plans":{"proPriceCents":500,"businessPriceCents":1900,"proPeriodDays":30,"includedTokens":{"pro":5000000,"business":50000000},"currency":"USD"},"freeMonthlyTokens":500000,"lowBalanceCents":100,"graceDays":7,"reminderDays":[7,3,1],"reminderChannels":{"os":true,"email":true,"telegram":true},"onDemand":{"enabled":true,"markupPercent":15,"minTopUpCents":100,"allowPro":false,"onEmpty":"block"},"fallbackPlan":"free"}')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO model_pricing (model, provider, input_cents_per_m, output_cents_per_m) VALUES
  ('deepseek-chat', 'deepseek', 27, 110)
  ON CONFLICT (model) DO NOTHING;
`;
