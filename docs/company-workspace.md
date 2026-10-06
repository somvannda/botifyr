# Botifyr — Company Workspaces (design)

> Status: **proposal**. No code beyond this doc. Owner: product/eng.
> Goal: turn Botifyr from "a bot you chat with" into **"a company you run"** —
> point it at a website or an idea, and it scaffolds a virtual startup whose
> employees are AI bots. You are the CEO; the bots do the work.

## 1. Concept

A **Company Workspace** is a scoped organisation that owns:

- **Employees** — bots with a **role**, a manager, instructions, skills, tools,
  and a schedule.
- **Shared state** — a company wiki, a task board, a shared Library and vault.
- **A budget** — tokens/credits spent by the whole company, with one CEO gate.
- **A memory** — company facts, OKRs, decisions, and history all employees see.

The flow the user asked for:

```
enter a website / an idea
        │
        ▼
  onboarding agent reads it, proposes an org chart
        │
        ▼
  Workspace + employees created (with instructions, skills, schedules)
        │
        ▼
  first tasks seeded → bots work → standups & approvals reach the CEO
```

## 2. What already exists (reuse map — do not rebuild)

| Company need | Existing primitive | Where |
| --- | --- | --- |
| An employee | `Bot` (name, emoji, scheme, `instructions`, `skills`, `schedule`) | `packages/shared/src/index.ts` |
| A team that works together | Group bot: `memberIds` + `autonomous` | `Bot` type; `apps/cloud/src/server.ts` group run |
| Multi-agent turn-taking / handoff | Group orchestration loop, `[SKIP]`, `group.working` events | `apps/cloud/src/server.ts` |
| Manager→worker attribution | Per-message `botId`, per-task author identity | `ChatMessage.botId`, `runner.ts` |
| CEO approvals | `Approval` + `RiskLevel` + approval gates | `approvals.ts`, `packages/shared` |
| Company SOPs / playbooks | `Skill` (built-in) + `LearnedSkill` (global) | `skills.ts`, `server.ts` |
| Company tools | Connections: Google, GitHub, Slack, Notion, Telegram | `connections-tools.ts` |
| Money/budget | Usage records, wallet, daily caps, prepaid plans | `billing.ts`, `docs/cost-controls.md` |
| Company files | Per-bot Library (`BotFile`) | `files-tools.ts` |
| Audit / replay | `AuditEvent` log | `store/types.ts` |
| Hands (browser/desktop/code) | Per-task sandboxes | `infra/`, `packages/agent-core/src/sandbox` |
| Scheduled work | `BotSchedule` + scheduler ticker | `listScheduledBots()` |

**Takeaway:** ~60% of the engine is already here. A group bot whose members are
department heads *is* a company MVP. This doc adds the org layer around it.

## 3. The gap (the four new pieces)

1. **`Workspace` entity.** Today every `Bot`, `Secret`, `File`, `Connection`
   belongs to a `userId`; there is no organisation. Add a workspace that owns
   them.
2. **Roles & hierarchy.** Group members are currently peers. Add a role, a
   manager pointer, and a reporting/escalation path.
3. **The onboarding generator.** "Website/idea → org chart + employees + first
   tasks." Mostly a prompt + a create loop over existing bot creation.
4. **Shared company memory.** Files are per-bot today; a company needs one wiki,
   one task board, and a shared vault/budget all employees read.

## 4. Data model

Follow the repo convention: add to `@botifyr/shared` (contracts) and
`apps/cloud/src/store/{types,schema,memory,postgres}.ts` (persistence).

### 4.1 New shared types (`packages/shared/src/index.ts`)

```ts
export type WorkspaceStatus = "onboarding" | "active" | "paused" | "archived";

/** A virtual company. Owns employees, shared state, budget. */
export interface Workspace {
  id: string;
  ownerId: string;            // the CEO (a real user)
  name: string;               // "Acme Robotics"
  /** The input that spawned it: a website or a free-form idea. */
  source: { kind: "url" | "idea"; value: string };
  mission: string;
  status: WorkspaceStatus;
  /** The bot that chairs the company (reports to the CEO). */
  ceoBotId?: string;
  avatarEmoji?: string;
  scheme?: number;
  createdAt: string;
  updatedAt: string;
}

/** The seat an employee bot fills in a workspace. */
export interface BotRole {
  workspaceId: string;
  botId: string;
  /** e.g. "CTO", "Head of Growth", "Support Lead". */
  title: string;
  department: "exec" | "product" | "engineering" | "growth" | "ops" | "finance" | "support" | "design";
  /** The bot this one reports to (null = reports to the CEO). */
  managerBotId?: string;
  /** True for the single chair bot that aggregates standups to the CEO. */
  isChair?: boolean;
  hiredAt: string;
}
```

Copy the same shapes into `apps/cloud/src/store/types.ts` as `WorkspaceRecord` /
`BotRoleRecord` (the store mirrors shared types; see existing `BotRecord`).

### 4.2 Schema (`apps/cloud/src/store/schema.ts`)

Idempotent `CREATE TABLE IF NOT EXISTS`, matching existing style:

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL,          -- serialised Workspace
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces (owner_id, created_at);

-- One row per employee bot; role data lives alongside.
CREATE TABLE IF NOT EXISTS workspace_roles (
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bot_id         TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  data           JSONB NOT NULL,      -- serialised BotRole
  PRIMARY KEY (workspace_id, bot_id)
);
```

Then add nullable, back-filled columns so existing rows keep working:

```sql
ALTER TABLE bots        ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE secrets     ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE files       ADD COLUMN IF NOT EXISTS workspace_id TEXT;  -- shared wiki
CREATE INDEX IF NOT EXISTS bots_workspace_idx ON bots (workspace_id);
```

- **Backward compatible:** `workspace_id NULL` = a personal bot, exactly today's
  behaviour. No migration of existing accounts required.
- **Scoped secrets/vault:** a workspace secret is visible to every employee; a
  personal secret stays private. Resolve at read time: workspace first if set.
- **Shared Library:** a file with `workspace_id` set (and `bot_id` = the author)
  is readable by all employees. This is the company wiki.

### 4.3 Store methods (`Store` interface)

Mirror the existing `bots` group:

```ts
createWorkspace(record: WorkspaceRecord): Promise<void>;
getWorkspace(id: string): Promise<WorkspaceRecord | null>;
listWorkspaces(ownerId: string): Promise<WorkspaceRecord[]>;
updateWorkspace(record: WorkspaceRecord): Promise<void>;
deleteWorkspace(ownerId: string, id: string): Promise<boolean>;

setBotRole(record: BotRoleRecord): Promise<void>;
getBotRole(workspaceId: string, botId: string): Promise<BotRoleRecord | null>;
listBotRoles(workspaceId: string): Promise<BotRoleRecord[]>;
deleteBotRole(workspaceId: string, botId: string): Promise<boolean>;
```

Implement in **both** `memory.ts` and `postgres.ts` (there are store tests in
`memory.test.ts`; add coverage there — no model spend).

## 5. The onboarding generator

An endpoint + an agent run. **One** strong model call plans; deterministic code
creates.

```
POST /v1/workspaces            { source: { kind: "url" | "idea", value } }
  → create Workspace(status: "onboarding")
  → read the source (webfetch / browser tool for a URL; raw text for an idea)
  → one planner call returns a strict JSON org chart:
      { name, mission, departments: [ { title, department,
        managerTitle, instructions, skills[], emoji, emojiScheme,
        everyMinutes? } ] }
  → for each role: createBotFor(...) grouped under a chair bot
  → write the company brief + OKRs to shared Library (workspace_id)
  → seed first tasks (one per department) as group messages
  → status: "active"; emit workspace.created
```

Rules:

- **Structured output only.** Validate the JSON; on failure retry once, then
  fall back to a fixed default org (Product, Engineering, Growth, Ops).
- **Cap the headcount** (e.g. ≤ 8 employees) so onboarding can't spend wildly.
- **Everything the planner writes is instructions**, i.e. untrusted text passed
  to bots — keep the existing prompt-injection stance (`docs/botifyr-blueprint.md`
  §3.2): treat scraped site content as data, never as commands.
- **Idempotent-ish:** creating a workspace from the same source twice is allowed
  but flagged; the CEO can delete.

This reuses `createBotFor()` in `server.ts` verbatim — the generator adds
**roles + shared memory + first tasks**, not a new engine.

## 6. Orchestration: hierarchy, delegation, standups

Build on group bots (`memberIds` + `autonomous`) with three additions:

1. **Chair bot.** The workspace's `ceoBotId` is a group bot whose members are the
   department heads. The CEO (human) talks to this one thread.
2. **Delegation tool.** A `delegate(botTitle, task)` tool so a manager can hand a
   subtask to a report (creates a task in that report's session and tags the
   reply back up). Small addition to `packages/agent-core/src/tools`.
3. **Standups / escalation.** On a schedule, the chair asks each head for a
   one-line status (`BotSchedule`), aggregates into a **Standup** message, and
   surfaces only decisions/approvals to the CEO. Escalation = an `Approval`.

Department threads stay normal bot sessions, so all current chat, tasks,
approvals, and audit "just work".

## 7. Shared company state

- **Wiki (Library):** workspace-scoped files. Seed with `BRIEF.md`, `OKRS.md`,
  `DECISIONS.md`, `CRM.md`. Any employee can read; writes go through the file
  tools.
- **Task board:** derive from existing `Task` rows scoped to the workspace's
  sessions (status + owner). No new table at first — a projection. Add columns
  later only if the projection is too expensive.
- **Folder mounting:** the code sandbox can mount the workspace Library so
  employees read/write the same docs as files. (Follows existing per-task
  sandbox lifecycle.)

## 8. UI (one UI, two hosts)

Per `AGENTS.md` §7, build once in `packages/ui/src/BotifyrApp.tsx` and shared
styles; hosts stay thin.

- **Onboarding screen:** one input — "Website or idea" — plus a proposed org-chart
  preview the CEO can edit before hiring. Shown to new accounts and from a
  "New company" action.
- **Company view:** left rail = employees by department; main = the chair thread
  (standups, approvals); a **Board** tab = task board; a **Wiki** tab = shared
  Library; a **Budget** tab = this company's spend.
- **Employee card:** reuse the existing bot Details panel; add **Role** and
  **Reports to**.
- Host differences (open external, focus window) stay behind `BotBridge`
  (`packages/ui/src/bridge.ts`). `parity.test.ts` already guards this — the new
  views must live in the shared app.

## 9. Cost & safety (the #1 risk)

A company of scheduled bots spends tokens **continuously**. Reuse
`docs/cost-controls.md`, but make it **per-workspace**:

- **Workspace budget:** a token/credit cap on the workspace; when hit, pause all
  its schedules and notify the CEO. Enforced next to the existing daily cap in
  `apps/cloud/src/billing.ts` / `runner.ts`.
- **Schedule defaults:** new workspaces ship with schedules **off** for
  non-exec bots; the CEO opts in per employee.
- **Approval defaults:** keep consequential tools (send/pay/publish/delete) gated
  behind `Approval`; `autoApprove` stays opt-in per bot, never default-on for a
  whole company.
- **Headcount + step caps** during onboarding (see §5).

## 10. Phasing

- **P0 — Entity + scoping.** `Workspace` + `BotRole` in shared/store/schema;
  `POST/GET/PATCH/DELETE /v1/workspaces`; scope bots/secrets/files by
  `workspace_id`. No UI change required to ship; verify with store tests.
- **P1 — Onboarding generator.** The website/idea endpoint, planner → org chart,
  bot creation, seeded wiki + first tasks. This is the visible feature.
- **P2 — Company view UI.** Org rail, chair thread, Board, Wiki, Budget tabs in
  `packages/ui`.
- **P3 — Delegation + standups.** `delegate` tool, scheduled standups, escalation.
- **P4 — Per-workspace budgets** hardening + admin visibility.

## 11. First milestone (concrete)

A new user pastes **one URL** and, within one model run, gets:

- a workspace named from the site,
- 3–5 employees with roles and instructions,
- a chair thread they can talk to as CEO,
- a seeded `BRIEF.md` + `OKRS.md`,
- one first task per department queued,
- a visible note of the estimated token cost and a **workspace budget** default.

*Success test:* the CEO replies "give me a status" in the chair thread and gets a
synthesised standup. No consequential action happens without an approval.

## 12. Open questions / risks

- **Shared vs personal vault** precedence when both exist — propose: explicit
  `workspace/` scope names, personal wins on exact-name collision, log both.
- **Folder-level file ACLs** — start coarse (everyone read/write the wiki); add
  per-department scopes only if asked.
- **Multi-user companies** (several humans as co-founders) — out of scope for P0;
  model is single-CEO-per-workspace first. `Session.kind === "group"` between
  users already exists if we revisit.
- **Quality > headcount.** Many weak bots read as noise. Prefer fewer, better
  instructed employees plus strong shared memory.
- **Legal/real-world:** bots research/build/draft, but the human stays the
  approver for money, messages, publishing, and anything irreversible.
