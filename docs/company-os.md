# Botifyr — Company OS (architecture)

> Companion to [`company-workspace.md`](company-workspace.md). That doc is the
> **concept and flow**; this one is the **full architecture** — schema, models,
> systems and specs — so nothing is left implicit. Read together:
>
> - **Part I–IV design** → `company-workspace.md`
> - **Architecture & specs (this file)** → everything an engineer needs to build.
>
> Status legend: ✅ shipped · 🟡 partial · ⏳ planned.

## 0. Scope

The product: *give it an idea or a website → it builds and runs an AI company
whose employees do real work, with the human CEO approving anything
consequential.* This doc specifies the whole system:

1. Domain model & database schema
2. Company DNA
3. Employee model
4. Capability catalog (departments · roles · skills · capabilities)
5. Blueprint & product templates
6. The orchestrator (CEO)
7. Work system (tasks, board, phases)
8. Permissions, authorization & approvals
9. Memory & knowledge
10. Integrations & connectors
11. Notifications & digests
12. UI surface (the HQ)
13. Company lifecycle
14. Quality & evaluation
15. Cost & monetization
16. Security, tenancy & compliance
17. Humans in the company (multi-user)
18. Seed-data plan

---

## 1. Domain model

```
User (human CEO)
  └─ Workspace (a company) ── DNA (1:1)
        ├─ Employee  = Bot + BotRole  (N)   ── grants ── Capability
        ├─ Team/Department (N)              ── roles from Catalog
        ├─ WorkItem / Project (N)           ── tasks, phases, deps
        ├─ Knowledge (wiki + artifacts) (N)
        ├─ Connection (per provider) (N)
        ├─ Budget / Ledger (1:N)
        └─ Report/Standup, AuditEvent (N)
```

Persistence rule (repo convention): contracts in `packages/shared`, records +
methods in `apps/cloud/src/store/*` (memory **and** postgres), JSONB documents
for flexible data, no migration required for additive fields.

## 2. Database schema

Shipped ✅: `workspaces`, `workspace_roles`. Planned ⏳ for the OS:

```sql
-- Company profile (DNA) — 1:1 with a workspace.
-- Could live on workspaces.data; separate only if queried heavily.
-- data JSONB holds CompanyDNA (§3).

-- Employee = Bot + role. Bot already carries instructions/skills/schedule;
-- role carries title/department/manager/authorization.
-- workspace_roles.data JSONB := BotRole (+ employee extras, §4).

-- Capability grants (per role or per employee).
CREATE TABLE IF NOT EXISTS capability_grants (
  workspace_id TEXT NOT NULL,
  subject      TEXT NOT NULL,   -- "role:<id>" | "bot:<id>"
  capability   TEXT NOT NULL,   -- e.g. "social.publish"
  granted      BOOLEAN NOT NULL DEFAULT false,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, subject, capability)
);

-- Work items (the board). One row per task; phases + deps as columns/JSONB.
CREATE TABLE IF NOT EXISTS work_items (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL,   -- WorkItem (§7)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_items_ws_idx ON work_items (workspace_id, updated_at DESC);

-- Knowledge (wiki + artifacts), scoped to the workspace.
CREATE TABLE IF NOT EXISTS knowledge (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  bot_id       TEXT,             -- author
  kind         TEXT NOT NULL,    -- brief | okrs | decision | crm | artifact
  name         TEXT NOT NULL,
  content      TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_ws_idx ON knowledge (workspace_id, kind);

-- Per-workspace budget + ledger for attribution (§14).
CREATE TABLE IF NOT EXISTS workspace_budget (
  workspace_id TEXT PRIMARY KEY,
  limit_tokens BIGINT NOT NULL DEFAULT 0,   -- 0 = inherit account cap
  used_tokens  BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- usage_events gains workspace_id + bot_id for per-employee attribution.

-- Standups / reports the chair produces (§5).
CREATE TABLE IF NOT EXISTS company_reports (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind         TEXT NOT NULL,    -- standup | weekly | incident
  data         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS workspace_id` on `bots`,
`connections`, `secrets`, `files`, `usage_events` (see company-workspace.md §4.2).

## 3. Company DNA

The structured source of truth for the *business* (not the workforce).

```ts
interface CompanyDNA {
  industry: string;
  category: string;
  summary: string;
  businessModel: string;
  targetMarket: string[];
  targetCustomers: string[];
  product: { type: string; features: string[]; gaps: string[] };
  stage: "idea" | "mvp" | "launched" | "scaling";
  goal: string;
  priorities: string[];
  brand?: { tone: string; colors: string[]; logoUrl?: string; handles: Record<string, string> };
  metrics?: { arrCents?: number; customers?: number; source?: string }; // §14 sourcing
}
```

- **Storage:** `Workspace.dna` (JSONB). No migration.
- **Injection:** `companyContext(dna)` prepended to every employee's system
  instructions (`runner.ts`) — the shared context every agent reads.
- **Versioning:** `dna.updatedAt` + an audit event; edits re-brief the chair
  (do not rehire).
- **Untrusted input:** DNA is derived from site text → treat as **data**, never
  instructions (`botifyr-blueprint.md` §3.2).

## 4. Employee model

`Employee = Bot + BotRole`, extended:

```ts
interface EmployeeExtras {           // stored in BotRole.data
  roleId: string;                    // catalog RoleDefinition id (§6)
  jobDescription: string;            // seeded into Bot.instructions
  skills: string[];                  // Skill ids (§6)
  capabilities: string[];            // capability ids granted (§8)
  kpis: string[];
  status: "hired" | "working" | "paused" | "offboarded";
  portfolio?: { taskId: string; title: string; outcome: string }[];
  hiredAt: string;
}
```

- **Lifecycle:** hire → working → paused → offboarded. Offboarding keeps history
  (audit) but removes from the active roster.
- **Profile/portfolio** = role + JD + skills + the bot's knowledge artifacts +
  its completed work items.
- **Reports to** = `BotRole.managerBotId`; drives delegation + escalation.

## 5. The orchestrator (CEO)

- **Chair** = `Workspace.ceoBotId` (a group bot) — your single thread.
- **Planning cadence:** on demand ("plan the week") and on schedule (weekly
  planning, daily standup) via `BotSchedule`.
- **Routing:** the chair decomposes a goal → work items → assigns by role.
- **Delegation tool** `delegate(role, task)` (Part I §6): creates a task in the
  report's session; the result rolls back up.
- **Escalation:** anything requiring money / publishing / deletion → `Approval`
  to the CEO; blockers → surfaced in the HQ "Needs you".
- **Standups:** chair aggregates one-line statuses → a `company_reports` row.

## 6. Capability catalog (departments · roles · skills · capabilities)

**Catalog × model** (company-workspace.md §31): curated data, model selects &
tailors.

**Departments:** `exec, product, engineering, design, data, ai, growth,
marketing, sales, support, success, ops, finance, legal, people, logistics`.

**RoleDefinition** (data): `{ id, title, department, level, summary,
jobDescription, skills[], capabilities[], kpis[], reportsTo? }`.

**Skills:** reuse `Skill` (built-in) + `LearnedSkill` (self-learned); a
`role → skills` map.

**Capability registry** (everything an employee can *do*, with risk):

| id | kind | risk |
| --- | --- | --- |
| `research.web` | tool | none |
| `files.read` / `files.write` | tool | none |
| `browser.use` | tool | none |
| `code.run` | tool | sandbox |
| `social.read_insights` | connector | none |
| `social.publish` / `social.reply` | connector | consequential |
| `email.send` | connector | consequential |
| `ads.manage` | connector | money |
| `payments.charge` | connector | money |
| `repo.write` / `deploy.production` | connector | consequential |

Seeded first: ~8 departments × 3–5 roles.

## 7. Templates

- **Org blueprint templates** (per vertical): default department/role mix +
  headcount band + KPIs. e.g. `cloud_pos`, `food_delivery`, `accounting_saas`,
  `ai_video`, `ecommerce`, `agency`, `marketplace`.
- **Product templates** (per vertical): standard feature sets → drive the
  backlog (company-workspace.md §15.2).
- **Both are data**, and can be **learned** (like `LearnedSkill` / media
  recipes) once approved.
- **Stage modifier:** the same vertical yields *different* teams by `DNA.stage`
  — an idea is product/engineering-heavy, an existing product is
  growth/sales-heavy (§21.2).

## 8. Permissions, authorization & approvals

- **RBAC:** capabilities are granted per **role** or per **employee**
  (`capability_grants`). Default: read/research on; consequential off.
- **Approval policy:** consequential/money actions create an `Approval`
  ("allow once / always for this role / deny"). Batchable (a week of posts = one
  approval).
- **Budget gate:** a money action also checks the workspace budget (§15).
- **Audit:** every action → `AuditEvent` (already exists), replayable.
- **Principle:** *human-approved first* — create / hire / spend / deploy /
  contact all gate on approval.

## 9. Memory & knowledge

Four layers (mirrors `botifyr-blueprint.md` §3.1):

- **Working** — the conversation + current task (exists).
- **Episodic** — past task runs (exists via `Task`).
- **Semantic** — Company DNA + Knowledge (wiki: BRIEF/OKRS/DECISIONS/CRM).
- **Procedural** — `Skill` / `LearnedSkill` (exists).

Injection order: DNA → role/JD → wiki summary → conversation summary. Keep
**structured DNA over raw site text** (cost + prompt-injection).

## 10. Integrations & connectors

- Reuse the `connections-tools.ts` + encrypted-vault pattern.
- **Auth model:** OAuth **per workspace** (a company owns its pages), tokens
  never enter model context.
- **Priority connectors:** Google (mail/calendar/drive), GitHub, Slack/Notion
  (exist), then **Meta** (pages, IG, Messenger, Ads), **LinkedIn**, **Stripe**
  (billing/metrics), a **CRM**, and a **support desk**.
- **Browser/computer use** is the fallback for software with no API — never for
  social logins (ToS/2FA/ban risk).

## 11. Notifications & digests

- **What triggers:** approval requests, "needs you", blockers, budget warnings,
  completed milestones, standups.
- **Channels:** in-app (exists), OS notification (exists), **email** and
  **Telegram** (partially exists) — rate-limited, digest-first (a CEO does not
  want 200 pings).

## 12. UI surface (one UI, two hosts)

`AGENTS.md` §7 applies — all in `packages/ui`, hosts thin.

- **Onboarding:** idea/website → editable org → hire. ✅
- **HQ:** Needs you · Team · Board · Office · Budget · Wiki.
- **Team:** employees by department; card = role, status, current work,
  portfolio.
- **Board:** work items by phase/status; drag to reassign (approval for
  consequential moves).
- **Office:** the per-employee `computer` live view.
- **Settings:** DNA editor, capability grants, budget, connections, lifecycle.

## 13. Company lifecycle

`create → onboard (plan+hire) → operate → grow → pause | archive | transfer |
delete`.

- **Pause** = schedules off, agents stop spending.
- **Archive** = read-only, history kept.
- **Delete** = removes company + roles; employees return to Personal (shipped ✅).
- **Transfer** = move ownership to another human (multi-user, §17).

## 14. Quality & evaluation

- **KPIs** per role (from the catalog) checked by the chair.
- **Acceptance criteria** on work items; a reviewer (another employee) or the
  CEO marks done/redo.
- **Ratings/feedback** on employees roll into improving their JD (a learned
  loop).
- **Guardrail:** quality > headcount — few, well-briefed employees beat many
  weak ones.

## 15. Cost & monetization

- **Per-workspace budget** (cap) + **per-employee/project attribution**
  (`usage_events.workspace_id` / `bot_id`). On cap → pause schedules + notify.
- **Company pricing** (product): the company product is a higher tier than a
  personal bot — bundle a token allowance + markup (existing `billing.ts` /
  `docs/cost-controls.md`).
- **Ads spend** is the customer's own money — never the platform's; treat as a
  metered capability with its own cap.

## 16. Security, tenancy & compliance

- **Tenancy:** every row scoped by `workspace_id`; no cross-company reads.
- **Token scoping:** connectors limited to the capabilities granted.
- **Audit + replay** for all consequential actions.
- **Prompt-injection:** all fetched/site content is data, never commands.
- **Data residency / retention:** configurable per workspace (aligns with the
  existing media retention controls).
- **Compliance:** consent for outreach, platform ToS, no login automation.

## 17. Humans in the company (multi-user)

- Start single-CEO. Later: **co-founders** / invited humans via
  `Session.kind === "group"` (exists) + a workspace membership table.
- **Roles for humans:** owner, admin, approver, viewer.

## 18. Seed-data plan (first shippable catalog)

- **Departments:** exec, product, engineering, design, growth, sales, support,
  ops, finance.
- **Roles (~30):** CEO; Product Manager, Business Analyst, UX Designer,
  Researcher; CTO, Backend/Frontend/DevOps/QA Engineer; CMO, Content, SEO,
  Social, Growth Analyst; Sales Manager, Lead Researcher, Outreach; Support,
  Onboarding, CSM; Finance, Ops, Compliance.
- **Capabilities:** the registry in §6.
- **Templates:** `cloud_pos`, `ecommerce`, `agency` first.
- **Skills:** map the existing `SKILLS` catalog to the roles above.

---

## 19. Build order

Authoritative sequence lives in `company-workspace.md` §40. Immediate next items:

- **DNA + catalog** (data) → **templates + recommendation** → **website/market
  intelligence** → **builder tools** → **delegation/standups** → **backlog +
  board** → **HQ** → **authorization + budget** → **hands** (social, ads,
  design).

## 20. Open decisions

- **`Department` taxonomy:** the shipped union has 8; this doc proposes 16.
  Decide before the catalog ships.
- **`Bot.workspace` label vs. real `workspace_id`:** move to IDs with the
  catalog.
- **DNA on `workspaces.data` vs. its own table:** start on the workspace JSON.
- **Image vendor** for design (API vs. template render).
- **Connector priority** after Meta/LinkedIn (Stripe? CRM? support desk?).

---

## 21. Expected outcome — what "done" looks like

> Added so we build a **true product**, not a demo. This is the acceptance bar
> for the whole arc, and it is what every phase in `company-workspace.md` §40 is
> judged against.

**Definition of success:** a non-technical founder goes from *an idea or a
website* to a **staffed, working company** in minutes — and stays in control of
anything that **costs money, touches customers, or can't be undone.**

### 21.1 The end-to-end experience

```
You:  "I want to build a cloud POS for restaurants and retail in Cambodia."
      (or paste https://chmaba.com)

Bot:  🔍 reads the source (site/market) → Company DNA draft
      🏢 recommends a team + rationale + a first goal
      ❓ asks you to review and approve

You:  [edit the org]  →  [Hire the team]        ← nothing exists until this

→ Company HQ: "N AI online · 3 need you"
→ wiki (brief/OKRs) + backlog seeded; employees start behind approvals
```

### 21.2 The team recommendation is **dynamic and stage-aware**

The org is **never hard-coded**. It is recommended from the **catalog (§6)** +
**blueprint/product templates (§7)** matched to the business and its **stage**,
then **approved by the human**. Same product, different company:

| Stage | Example input | Recommended team shape |
| --- | --- | --- |
| **Idea only** | "build a POS app" | **Product + Engineering heavy** (PM, BA, UX, CTO, Backend, Frontend, Mobile, QA) + *light* marketing/sales |
| **Existing product** | `chmaba.com`, ready to sell | **Thinner engineering** (enhancement, QA) + **heavier** growth, sales, support, success |
| **Launched / scaling** | live customers | growth/sales/CS/**data** heavy + engineering for scale & reliability |

Rules:

- The recommendation always states a **rationale** ("why these roles").
- It always ends in a **review step** — the CEO edits and **approves**.
- **Nothing is created until approval** (the shipped editable-org modal + the
  `create_company` / `hire_employee` approval gates).

### 21.3 What *you* do day to day

The **HQ**: a **Needs you** queue (approvals + blockers), the **Team** (who is
doing what), the **Board** (tasks by phase), the **Office** (live screens), and
**Budget**. You approve batches, send one instruction to the CEO, and read the
standup digest.

### 21.4 What the employees produce (realistic scope)

| Department | Real output |
| --- | --- |
| Product | specs, requirements, roadmap, backlog |
| Engineering | code in sandboxes, PRs, tests |
| Design | wireframes, poster/brand assets (HTML→PNG or image gen) |
| Marketing | copy, posts, SEO, analytics — **publish gated** |
| Sales | lead research, outreach drafts, replies — **send gated** |
| Support | drafted replies, knowledge base — **send gated** |
| Ops / Finance | tracking, reports, reminders |

**Digital work with a human gate — not a money printer.**

### 21.5 Milestone-by-milestone expected result

| After | You can expect |
| --- | --- |
| DNA + catalog (§40 item 4) | every new company knows its business; employees get the right JD/skills/authorization |
| Templates + website/market intelligence + builder tools (5–7) | create a well-formed company **from chat** in one conversation |
| Delegation + backlog + HQ (8–10) | the company **runs** — you manage a board + approvals, not a chat |
| Authorization + budget (11) | it can run **autonomously within limits** you set |
| Social + messaging + ads + design (12–15) | marketing/sales operate your **real channels** under approval |

### 21.6 Honest limits

- **Not fully autonomous by default** — money / publishing / outreach need you.
- **Not magic quality** — model + tools + platform access set the ceiling.
- **Not free** — a working company spends tokens continuously (budgets/caps
  built in); ad spend is metered separately and is the customer's money.
- **Platform-gated** — real social management depends on Meta/LinkedIn app
  review; no login automation.
- **Legal / consent** apply to outreach; nothing irreversible without a human.

---

## 22. Autonomy & work assignment

**Yes — the company is run by AI agents, and you can put work on *any* agent at
*any* time.** Two dials: *how autonomous* it is, and *how work flows in*.

### 22.1 Autonomy levels (a setting, not a binary)

| Level | Behaviour |
| --- | --- |
| `manual` *(default)* | agents research/draft freely; **every** consequential action → approval |
| `supervised` | low-risk actions auto; consequential still gated; budget caps enforced |
| `autonomous` | agents act within their **granted capabilities + budget**, no per-action approval |

Set per **employee** and per **workspace**. New companies ship `manual`; you raise
it. "Autonomous" always means *within capabilities + budget + audit* — **never
uncapped**.

### 22.2 Add work to any agent (multiple doors)

- **Direct assign** — from the HQ or an employee card: create a work item for any
  employee, on demand or recurring.
- **Delegate via the CEO** — one instruction to the chair; it decomposes the goal
  and routes it.
- **Standing responsibilities** — edit an employee's JD/schedule so new work is
  permanently theirs (e.g. "own the weekly report").
- **Reassign** — move a work item to another employee or role.

Every work item carries an owner, a phase, and an approval policy derived from the
capabilities it needs.

### 22.3 What "the company runs itself" means

- Between your approvals, agents keep working their queues and schedules.
- The chair plans the week, delegates, and escalates blockers.
- You steer with one instruction — not micromanagement.

**Guardrail:** autonomy is always bounded by (a) granted capabilities,
(b) budget, (c) approvals for consequential actions, (d) audit.
