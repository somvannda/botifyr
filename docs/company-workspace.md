# Botifyr — Company Workspaces (design)

> Status: **living design — Part I is partly shipped.** Owner: product/eng.
> Goal: turn Botifyr from "a bot you chat with" into **"a company you run"** —
> point it at a website or an idea, and it scaffolds a virtual startup whose
> employees are AI bots. You are the CEO; the bots do the work.
>
> **Shipped (Part I):** `Workspace` + `BotRole` (shared → store → API), the
> planner (`POST /v1/workspaces/plan`), create (`POST /v1/workspaces`), client
> methods, sidebar grouping + switcher + role pills + header badge, the
> onboarding modal with an **editable** org, and rename/delete.
>
> **Design-only:** Parts II–V (Company DNA, the role/capability catalog,
> website intelligence, the conversational builder, the HQ view, and the
> marketing/sales hands — including the Part V transport/verification policy).
>
> §46 is the **authoritative roadmap** (one build order across all parts).
>
> **Architecture & full specs** — schema, employee model, the catalog,
> orchestrator, work system, permissions, memory, integrations, lifecycle, cost
> and security — live in [`company-os.md`](company-os.md).

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

> **Implemented note.** The shipped `Department` union has **8** values
> (`exec, product, engineering, growth, ops, finance, support, design`); Part IV
> §32 proposes expanding it (marketing, sales, data, ai, …). The shipped model
> also uses a `Bot.workspace` **name label** plus the `workspace_roles` table —
> **not** the `bots.workspace_id` columns sketched in §4.2 (that per-row scoping
> is still planned).

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

> **Status: planned — not built.** Only `workspaces` + `workspace_roles` exist
> today. Per-row scoping of `bots` / `secrets` / `connections` / `files` by
> `workspace_id`, and the shared Library, are still to come.

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

> **Status: shipped, split in two.** The generator is implemented as
> `POST /v1/workspaces/plan` (model → editable blueprint) followed by
> `POST /v1/workspaces` (create with `members[]` / `memberships[]`). Seeding the
> wiki and the first backlog tasks is still planned. The single-endpoint sketch
> below is the original shape.

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

---

# Part II — Idea → Company (the generator & operating system)

> Part I is the **entity** a company lives in. Part II is how the company is
> **born** and how you **run** it. The product is not "create an AI agent" —
> it is: *give it an idea or a website and it builds and runs the company around
> it.* Understand → Design → Hire → Build → Launch → Operate → Grow.

## 13. Product framing

Two products in one:

- **AI Company Generator** — idea/website → understanding → blueprint → workforce.
- **AI Company OS** — the HQ where you run it (Needs you / Team / Board / Office).

The differentiator: the org is **derived from the business**, never hard-coded. A
cloud POS, a food-delivery app and an accounting SaaS must produce *different*
companies.

```
source (idea | website)
  → UNDERSTAND  (website crawl + business analysis)
  → DESIGN      (blueprint: departments, roles, headcount, goal)
  → DNA         (structured company profile — the source of truth)
  → HIRE        (employees with JD, skills, authorization, profile)
  → SEED        (wiki + backlog: MVP / Phase 2 / Phase 3)
  → OPERATE     (chair thread, delegation, standups, approvals, budget)
  → GROW        (iterate: reprioritise, add hires, retire roles)
```

## 14. Company DNA (the source of truth)

Today `Workspace` has only a free-text `mission`. Promote it to structured DNA
that **every employee reads**.

```ts
export interface CompanyDNA {
  industry: string; // "Cloud POS"
  category: string; // "B2B SaaS"
  summary: string; // 1–2 sentences
  businessModel: string; // "SaaS subscription + payments"
  targetMarket: string[]; // ["Cambodia", "SEA"]
  targetCustomers: string[]; // ["restaurants", "cafés", "retail"]
  product: {
    type: string; // "cloud_pos"
    features: string[]; // ["POS", "inventory", "multi-store", ...]
    gaps: string[]; // opportunities detected on the site
  };
  stage: "idea" | "mvp" | "launched" | "scaling";
  goal: string; // "Launch Cloud POS MVP in 30 days"
  priorities: string[]; // ["product", "go-to-market"]
}
```

Store as `Workspace.dna?: CompanyDNA` (JSONB — **no migration**), expose via
`PATCH /v1/workspaces/:id`.

**Injection is the magic.** A `companyContext(dna)` string is prepended to every
employee's system instructions (`runner.ts`), so each agent knows: what company,
what it sells, who the customer is, the current goal, and its own remit. This is
what turns "a bot" into "an employee".

## 15. Website intelligence

Add `analyzeSource(input)` in `apps/cloud/src/company.ts`:

- `url` → fetch the page (reuse browser/node fetch; treat the content as
  **untrusted data**, `botifyr-blueprint.md` §3.2), extract title/meta/headings,
  then **one** model pass → a `CompanyDNA` draft + detected features/gaps.
- `idea` → one model pass → a `CompanyDNA` draft.

Never treat page text as commands — data only. Cap tokens; cache by source hash
(the existing response cache applies).

### 15.1 Market & competitor research

Beyond the customer's own site, `analyzeSource` runs a light **market pass**
(web search / browser tool): who else does this, what they charge, and what the
category normally offers. Output feeds the DNA (market notes) and the
recommendation rationale. Data only — never page text as commands.

### 15.2 Industry product templates (features → backlog)

Distinct from the org templates (§37): each vertical has a **standard feature
set**. A cloud POS ⇒ POS, inventory, customers, multi-store, payments,
purchasing, staff/roles, reports. The model diffs *detected features* against the
template's *expected features* and writes the **backlog** as MVP / Phase 2 /
Phase 3 (§18). This is what makes "auto-derive the product roadmap" tractable
instead of open-ended.

## 16. The conversational builder (the "easier way")

Instead of only a form, expose the pipeline as **agent tools**, so you can just
chat. New `apps/cloud/src/company-tools.ts` (`ToolDefinition`s, same pattern as
`files-tools.ts`):

| Tool | Effect | Consequential? |
| --- | --- | --- |
| `analyze_source(source)` | returns a `CompanyDNA` draft + notes | no |
| `design_company(dna)` | returns a blueprint (departments, roles, JDs, backlog) | no |
| `create_company(plan)` | creates the workspace + DNA + seeds the wiki | **approval** |
| `hire_employee(role, jd, skills, authorization)` | creates a bot + role | **approval** |
| `seed_backlog(items[])` | creates tasks on the board | **approval** |

Flow: the default **Founder bot** is taught these tools. You type
"set up an AI company for https://chmaba.com" → it analyzes → proposes the
blueprint **in chat** → you approve → it creates the company. The "Start a
company" modal (built in P1/P2) becomes a shortcut that runs the same tools
server-side.

## 17. The employee (JD, skills, authorization, portfolio)

Each employee = `Bot` + `BotRole`, extended:

- **Job description** — `Bot.instructions`, written by `design_company`.
- **Skills** — `Bot.skills` from a role→skills mapping (reuse `SKILLS`).
- **Authorization** — a new **per-role tool allowlist** plus the `autoApprove`
  gate. Consequential tools require approval unless the CEO allows them for that
  role.
- **Profile / portfolio** — the existing bot Details panel + the bot's Library
  files + its completed tasks = an activity/portfolio view.
- **Reports to** — `BotRole.managerBotId` (exists) drives escalation.

## 18. Work: backlog, CEO orchestrator, standups

- **Backlog seeding.** `design_company` also proposes MVP / Phase 2 / Phase 3
  features; `seed_backlog` turns them into `Task`s grouped by phase. Product then
  assigns them to Engineering, etc.
- **CEO orchestrator.** The `Workspace.ceoBotId` chair thread; a `delegate(role,
  task)` tool (Part I §6) hands work down; results roll back up.
- **Assignment chain.** PM → CTO → individual contributors, via `delegate`:
  the Product Manager splits the backlog, the CTO owns the engineering plan and
  assigns to engineers/QA, and each result rolls back up. One board reflects all
  of it.
- **Standups.** A scheduled chair run aggregates status; only decisions/blockers
  surface to you as approvals.

## 19. Company HQ (the screen from the sketch)

One shared `packages/ui` view — reuse approvals, tasks, the bot panel, and the
computer stream:

```
┌ CHMABA HQ ────────────────────────── 🟢 COMPANY ONLINE ┐
│ Cloud POS Startup · ARR $0 · Customers 0 · Tasks 47 · AI 14
├ NEEDS YOU 3 │ TEAM 14 │ BOARD │ OFFICE ┤
│ 🟢 Maya  AI CEO · "Building strategy"                   │
│ 🟢 Leo   CTO    · "Building multi-tenant architecture"  │
│ 🟡 Nora  QA     · Waiting on Leo                        │
│ 🟡 Sam   Sales  · Waiting on you                        │
├ GIVE YOUR COMPANY AN INSTRUCTION ──────────────────────┤
│ "Build the inventory module next."        [SEND TO CEO] │
└─────────────────────────────────────────────────────────┘
```

- **Needs you** = pending `Approval`s + blocked tasks.
- **Team** = employees by department (roles + live status from tasks).
- **Board** = tasks by phase/status.
- **Office** = the `computer` live view per employee.

> **Metric sourcing.** "ARR / Customers" need a data source (a billing connector
> or a manual figure). Until one exists the HQ shows them as **unknown**, never
> guessed.

## 20. Permissions, budget, approvals

- **Human-approved first** — create / hire / spend / deploy / contact all gate on
  `Approval`. This is the safety story, not a limitation.
- **Per-role authorization** — a tool allowlist per `BotRole`; default to
  read/research, escalate for consequential actions.
- **Per-workspace budget** — extend `docs/cost-controls.md`; on cap, pause the
  workspace's schedules and notify the CEO (Part I §9).

## 21. End-to-end (concrete)

```
CEO: "Set up an AI company for https://chmaba.com — cloud POS for Cambodia."
  Founder bot → analyze_source(url) → CompanyDNA draft (+ features/gaps)
  → design_company(dna) → blueprint (CEO, Product, Engineering, Growth, Sales, CS, Ops + JDs)
  → chat shows the blueprint  →  CEO edits  →  [Approve]
  → create_company(plan)  → workspace "Chmaba" + DNA + BRIEF.md / OKRS.md
  → hire_employee(...) × N → employees with JD, skills, authorization
  → seed_backlog(MVP…)    → tasks on the Board
  → status: "Chmaba HQ — 14 AI online, 3 need you"
```

## 22. Company knowledge (memory)

- DNA (structured) + Wiki (BRIEF / OKRS / DECISIONS / CRM) + task history.
- Injected context + the existing conversation summary keep every employee on
  message. Prefer **structured DNA** over stuffing raw site text (prompt
  injection + cost).

## 23. Phasing (Part II)

- **P5 — Company DNA** on `Workspace` + injection into instructions. *(smallest,
  foundational — do first)*
- **P6 — Website intelligence** — `analyzeSource` (fetch + model) feeding the planner.
- **P7 — Builder tools** — `company-tools.ts` + Founder bot → conversational setup
  with approvals. *(the "easier way")*
- **P8 — Backlog seeding** + Board view.
- **P9 — Company HQ view** (Needs you / Team / Board / Office).
- **P10 — Per-role authorization + per-workspace budget.**

## 24. Open questions (Part II)

- **Understanding quality vs. cost** — one pass for DNA, one for the blueprint;
  cache by source hash. DNA/blueprint are one-shot, not agentic loops.
- **Headcount default** — start 5–8, let the CEO "add hires" later; don't spin up
  a 20-bot company on day one (cost + noise).
- **Editing DNA** — CEO edits; recompute the chair's briefing rather than rehire.
- **Approval fatigue** — batch the hires into **one** approval, not N.
- **Model choice** — use the cheapest model that yields a sensible org.

---

# Part III — Marketing & sales hands (social, ads, replies, design)

> §17 gave employees a job. This part gives marketing and sales the **tools to
> actually do it** — with the CEO approving anything consequential.

## 25. Capability map

| Capability | Mechanism | Approval |
| --- | --- | --- |
| Read insights (FB/IG page, LinkedIn) | official API connector | no |
| Draft a post / comment reply / DM | model → Library artifact | no |
| Publish a post / article | API connector | **yes** |
| Reply to a comment / DM | API connector | **yes** (saved replies can be pre-approved) |
| Schedule a post | queue + `BotSchedule` | at schedule/launch |
| Design a poster / cover image | image model, or HTML→PNG in the code sandbox | no (artifact) |
| Launch / boost / edit an ad | Ads API | **yes** + budget cap |
| Manage multiple accounts | per-connection OAuth scope | per account |

Rule of thumb: **read and draft are free; publish, send, and spend are gated.**

## 26. Transport hierarchy (how a hand acts)

Per capability, choose the most **stable + compliant** transport available:

1. **API connector** — preferred when it exists (self-serve platforms, or an
   aggregator). Stable, auditable, no UI fragility.
2. **Browser / computer-use** — on the CEO's **own logged-in session** (via the
   local node), **supervised** (approval per consequential action), human-paced,
   per-account. **No platform approval needed — first-class, not a fallback**
   (this is how Claude/Grok operate).
3. **Manual-assist** — the bot drafts text + poster, the CEO posts. Zero risk.

`SocialClient` (`apps/cloud/src/social-tools.ts`) is the seam: one interface,
interchangeable transports. Operational details — sessions, verification, the
anti-bot policy, and platform realities — are in **Part V**.

## 27. Content & design

- **Copy** — the model drafts; you edit in chat; saved as a Library artifact.
- **Posters / visuals** — two paths: (a) an image-generation provider, or
  (b) an HTML/CSS template rendered to PNG in the code sandbox (brand-consistent,
  cheap, no extra vendor). Output → Library → attached to the post.
- **Brand kit** — colors / logo / tone stored in the workspace (Company DNA /
  wiki) so every employee designs on-brand.

## 28. Safety, consent, and cost

- **Human-approved first** — every publish / send / ad is an `Approval`; batch a
  week of scheduled posts into **one** approval, not N.
- **Per-role authorization** (§17) — marketers get social tools, sales gets
  messaging; nobody gets ad spend without an explicit allow.
- **No autonomous cold outreach** — replies/DMs need consent and rate limits;
  default to drafts + approval (anti-spam, legal).
- **Budgets** — ad spend needs a per-workspace budget + caps (§20); treat it like
  money, because it is.
- **Audit** — every action is logged (existing `AuditEvent`), replayable.

## 29. Phasing (Part III)

- **P11 — Social connectors (read + draft + publish).** Meta/LinkedIn OAuth;
  insights tool; draft-in-Library; publish behind approval.
- **P12 — Messaging (replies + DMs).** Page/IG/Messenger replies, gated; saved
  replies can be pre-approved.
- **P13 — Ads.** Read campaigns; create/boost behind approval + budget cap.
- **P14 — Design.** Image generation or the HTML→PNG poster pipeline + brand kit.

## 30. Open questions (Part III)

- **Platform onboarding** — Meta app review and ad-account setup are the real
  bottleneck, not the code; needs a guided connect flow per customer.
- **Image vendor** — image-gen API vs. template rendering (cost vs. brand control).
- **Scheduling + approval** — approve the *plan* (a week of posts) vs. each post.
- **Account safety** — never automate logins; OAuth only.

---

# Part IV — The capability catalog (every department, every skill)

> Parts II–III showed the flow and one department in depth. This part is the
> **library** behind it: a curated catalog of departments, roles, job
> descriptions, skills and tool authorizations — so the generator **recommends
> the right company setup** instead of inventing it from scratch each time.

## 31. Principle: catalog × model

Two layers, deliberately separated:

- **Catalog (deterministic, curated, versioned).** Departments, roles, job
  descriptions, skills, capabilities/authorizations, KPIs and industry blueprint
  templates — stored as **data**, not prompt text. Consistent, cheap, reviewable.
- **Model (tailoring).** Reads the business, **selects** roles from the catalog,
  adapts the JDs to the specific product/market, and proposes headcount + a first
  goal.

Marketing is not special — it is one department in the catalog with its own roles,
skills and tools. "Every department, every skill" = extend the **data**.

## 32. Department taxonomy

`exec, product, engineering, design, data, ai, growth, marketing, sales, support,
success, ops, finance, legal, people, logistics` — extensible per industry
template.

## 33. Role definition

```ts
export interface RoleDefinition {
  id: string; // "growth.seo-specialist"
  title: string; // "SEO Specialist"
  department: Department;
  level: "ic" | "lead" | "head" | "exec";
  summary: string;
  jobDescription: string; // seeded into Bot.instructions
  skills: string[]; // ids from the Skill catalog (§34)
  capabilities: string[]; // tool/connector ids (§35)
  kpis: string[];
  reportsTo?: string; // another RoleDefinition id
}
```

The catalog = a list of these, plus **industry blueprint templates** that
reference role ids + headcount bands.

## 34. Skill catalog

Reuse the existing `Skill` (built-in) + `LearnedSkill` (self-learned) registries;
add a `role → skills` mapping so a hire automatically receives the right skills
(§17). "Every skill" = the union of the built-in packs plus what the company
learns.

## 35. Capability & authorization registry

A registry of everything an employee can *do*, each tagged with risk — this is
how §17's "authorization" becomes concrete, and how the catalog guarantees each
department ships with the **right** tools, not all of them:

| id | kind | risk |
| --- | --- | --- |
| `social.read_insights` | connector | none |
| `social.publish` | connector | consequential → approval |
| `social.reply` | connector | consequential → approval |
| `ads.manage` | connector | money → approval + budget |
| `files.write` | tool | none |
| `browser.use` | tool | none |
| `code.run` | tool | sandbox |

`RoleDefinition.capabilities` references these ids; the CEO can grant/revoke per
role (§17/§20).

## 36. Recommendation engine

```
source → analyzeSource (DNA: industry, model, market, size, stage)
       → match blueprint template(s)              (industry + model + size)
       → select roles from the catalog            (departments relevant here)
       → model tailors JDs + headcount + goal
       → RECOMMEND: "Start with 8 employees" + rationale + a 90-day goal
       → CEO reviews / edits                       (existing editable org)
       → hire_employee(...) pulls JD + skills + capabilities from the catalog
```

The output includes a **recommendation rationale** (why *these* roles) so the CEO
can judge it — not just a list.

## 37. Industry blueprint templates (data)

`cloud_pos`, `food_delivery`, `accounting_saas`, `ai_video`, `ecommerce`,
`agency`, `marketplace`, … each = a default department/role mix + headcount band
+ KPIs. New industries are added as **data** (and can be **learned** — like
`LearnedSkill` / media recipes — once approved).

## 38. Phasing (Part IV)

- **F1 — Role & capability catalog** as data in `packages/shared` (+ a seed set
  covering the core departments). Do this **together with** Company DNA.
- **F2 — Blueprint templates** + the recommendation step.
- Parts I–III then build on it: every role already knows its JD, skills and tools.

> Labelled **F1/F2** to avoid clashing with the **P**-numbers in Parts I–III.
> The consolidated build order is in **§40**.

## 39. Open questions (Part IV)

- **Catalog breadth vs. launch** — seed ~8 departments × 3–5 roles first; grow.
- **Role id stability** — stable ids so learned/edited roles and analytics survive.
- **Custom roles** — allow customer-specific roles, but keep them catalog-shaped.
- **The catalog is also the cost model** — capabilities flag which roles can spend.

---

# Part V — Hands in practice (sessions, verification, platform reality)

> The revision that replaces "API first, browser last". Our agents drive **real
> browsers on the CEO's own machine**, supervised — no need to wait on platform
> approval. This part is the operating policy.

## 40. Owned channels first (unblocked today)

Ship the channels we already control, no platform review:

- **Telegram** — Botifyr already integrates it; a bot can post to a channel and
  reply to messages.
- **Email** — outreach + support (SMTP/IMAP).
- **The company's own website/blog** — built and published by the code/design
  hands; no external gate.

## 41. Persistent sessions per employee

Each employee gets a **persistent browser profile** (cookies / localStorage) so
logins survive across tasks and fewer verifications appear. Rules: the profile
belongs to the employee; credentials live only in the **vault**, never in the
prompt or the model context.

## 42. Human verification handoff (CAPTCHA / 2FA / checkpoint)

When a platform shows a CAPTCHA, 2FA, or a checkpoint, the agent **pauses**,
surfaces it in the HQ **Needs you**, and the **CEO solves it on the live screen**
(existing computer stream + `computer/input`) — then the agent resumes. The
human stays the human; the agent does the repetitive work.

## 43. Anti-bot policy — no evasion

Botifyr does **not** evade platform security. Specifically: **no CAPTCHA-solving
to defeat a third party's anti-bot.** A solver hook is allowed **only on domains
the customer owns** (per-workspace allowlist, **off by default**). Reasons: the
platforms' ToS, **account bans** (behavioural detection beats any single puzzle),
legal exposure (unauthorized-access theories; platforms litigate automation), and
it contradicts the product's **"safe by default"** wedge
(`docs/botifyr-blueprint.md` §3.2).

## 44. Platform reality (Meta / LinkedIn / Ads)

- **Meta** (Pages, Messenger, **Ads**) and **LinkedIn org pages** need **app
  review / partner programs** (`pages_manage_posts`, `pages_messaging`,
  `ads_management`). Hard for a single multi-tenant app; **Ads** also needs
  business verification.
- **Per-customer BYO** dissolves the problem: in a company OS each customer
  manages **their own** pages, so the approved app is **theirs** — approval
  becomes a **per-customer onboarding step**, not a blocker for us.
- **Self-serve (no review):** Telegram, Mastodon, Bluesky, Discord, Slack, Reddit.
- **Aggregators:** **Postiz** (open-source, **AGPL-3.0**, self-hostable; public
  API + MCP + webhooks) or a hosted aggregator.
  - **Postiz Cloud** — pre-approved apps for every channel → *you* skip review
    (paid; tokens live on their infra).
  - **Postiz self-hosted** — you still create your **own** developer apps per
    platform and pass review (Meta/YouTube/TikTok can take weeks); it removes the
    scheduling/connection work, not the approval.
  - **License:** AGPL-3.0 — calling its API is fine; forking/embedding it as a
    service triggers network copyleft.

## 45. Ordering — which hand to build

1. **Owned channels:** Telegram, email, own website.
2. **Self-serve social:** Mastodon / Bluesky / Discord / Slack / Reddit.
3. **Supervised browser-use** (local node) for FB / IG / LinkedIn / X / Ads,
   with persistent profiles + the verification handoff.
4. **Aggregator** (Postiz cloud or self-host) for customers who want
   multi-platform without browser-use.
5. **Direct Meta/LinkedIn APIs** only if/when approved.

---

# Roadmap (authoritative)

## 46. Build order across all parts

One sequence; the per-part lists (§10, §23, §29, §38) are detail views of the
same items. Status: ✅ shipped · 🔜 next · ⏳ later.

| Order | Deliverable | Label | Status |
| --- | --- | --- | --- |
| 1 | `Workspace` + `BotRole` entity, store, API, tests | P0 (I) | ✅ |
| 2 | Planner + create + onboarding UI (editable org) | P1–P2 (I) | ✅ |
| 3 | Sidebar grouping · switcher · role pills · badge · rename/delete | — | ✅ |
| 4 | **Company DNA** + **Role & capability catalog** | P5 (II) · F1 (IV) | 🔜 |
| 5 | Blueprint templates + recommendation step | F2 (IV) | ⏳ |
| 6 | Website intelligence (`analyzeSource`) | P6 (II) | ⏳ |
| 6.1 | Market & competitor research | §15.1 | ⏳ |
| 6.2 | Industry product templates → backlog | §15.2 | ⏳ |
| 7 | Conversational builder tools (`company-tools.ts`) | P7 (II) | ⏳ |
| 8 | Delegation + standups | P3 (I) | ⏳ |
| 9 | Backlog seeding + Board view | P8 (II) | ⏳ |
| 10 | Company HQ view (Needs you / Team / Board / Office) | P9 (II) | ⏳ |
| 11 | Per-role authorization + per-workspace budget | P4 (I) · P10 (II) | ⏳ |
| 12 | Social connectors (read · draft · publish) | P11 (III) | ⏳ |
| 13 | Messaging (replies + DMs) | P12 (III) | ⏳ |
| 14 | Ads (create/boost behind approval + cap) | P13 (III) | ⏳ |
| 15 | Design pipeline (image gen / HTML→PNG) + brand kit | P14 (III) | ⏳ |

> **Note on numbering.** Parts I–III label their phases **P0–P14**; Part IV uses
> **F1/F2**. Items 4 and 11 merge overlapping labels. This table is what to build
> in what order; ignore the split when planning.
