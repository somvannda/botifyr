# Botifyr — Company Quests (directed flow)

> Status: **Q0–Q5 shipped.** Companion to
> [`company-workspace.md`](company-workspace.md) (concept) and
> [`company-os.md`](company-os.md) (architecture). Those describe the *engine*;
> this doc fixes the *experience*: it turns "a company that appears in a minute
> and dumps tasks on everyone" into a **directed flow with a few meaningful
> choices**, where agents **propose directions** and the human **chooses**.
>
> Status legend: ✅ shipped · 🟡 partial · ⏳ planned.

## 1. Why (the finding)

The engine already works. `Workspace` + `BotRole`, the planner
(`POST /v1/workspaces/plan`), the DNA (`companyContext`), the role catalog
(`ROLE_CATALOG`), wiki seeding and the work board are all in the code. The
problem is the **decision flow**, and it has four concrete causes:

1. **It acts before you decide.** `defaultCompany()` + `seedCompany()`
   (`apps/cloud/src/company.ts`, `company-seed.ts`) build a full org and create
   work items immediately. Nothing waits for a real "what should we do?" choice —
   so the company is staffed and busy before the CEO has said anything.
2. **The org comes from keyword-spotting.** `recommendTeam()`
   (`apps/cloud/src/recommend.ts`) is `text.includes(keyword)` over five
   templates and **falls back to `saas`**. A business whose words aren't in the
   list silently gets a SaaS leadership team — the "agents doing jobs that don't
   match the business" symptom. `defaultCompany` also sets
   `dna.industry = the company name`, so the DNA is hollow on the fallback path.
3. **There is no direction or sequence.** `WorkItem`
   (`packages/shared/src/index.ts`) is a flat task with a `phase`
   (`mvp|phase2|phase3`). There is **no goal layer** above it: no north star, no
   acceptance criteria, no "the one thing next". You get a work queue, not a
   mission.
4. **Docs and code disagree.** `docs/roadmap.md` still lists shared state and a
   company view as "remaining" while `seedCompany`, `work_items` and the HQ tabs
   are shipped. Stale status is itself a source of confusion.

**Guardrail this doc adds:** *agents propose, the CEO disposes.* Nothing is
created until a direction is chosen and a quest is approved.

## 2. The loop

```
CHARTER     co-author the DNA (what / for whom / the 90-day win)
   │            → nothing is created yet
   ▼
DISCOVER    agents research the source + market
   │            → return 2–3 DIRECTION CARDS (thesis, roles, cost, risk)
   ▼
CHOOSE      the CEO picks ONE direction        ← the meaningful choice
   │
   ▼
ASSEMBLE    hire that direction's team (one batched approval) + DNA
   │
   ▼
QUEST       ONE objective, decomposed into a few work items
   │            with owners + acceptance criteria
   ▼
OPERATE     standup → pick the next quest → approve → done    ← repeats
   │
   ▼
GROW        completing a quest unlocks the next hire / expansion
```

Each stage is a gate. The CEO always sees **one active quest** as the north
star, not a backlog.

## 3. Data model

New types live in `packages/shared/src/index.ts`; records mirror them in
`apps/cloud/src/store/types.ts` (memory **and** postgres), per the repo rule.
Reuse `WorkspaceAutonomy` (`manual|supervised|autonomous`) and `WorkItem`.

### 3.1 `CompanyDirection` (the choice)

Produced by `analyzeSource` + `recommendTeam`, shown as a card, **never
persisted until chosen**.

```ts
export interface CompanyDirection {
  id: string;                 // stable, workspace-scoped: "dir_ship_mvp"
  title: string;              // "Ship the MVP in 30 days"
  thesis: string;             // why this, why now (1–2 sentences)
  stage: CompanyDNA["stage"]; // idea | mvp | launched | scaling
  objective: string;          // the 90-day win, in one line
  /** 1–5, for the tradeoff row on the card. Lower is cheaper/safer. */
  tradeoffs: { speed: number; quality: number; cost: number; risk: number };
  roles: string[];            // RoleDefinition ids to hire for this direction
  roadmap: Array<{ phase: WorkPhase; title: string }>; // proposed backlog
  estimatedTokens: number;    // rough budget, from the role/JD size
  rationale: string[];        // "why these roles" — shown to the CEO
}
```

### 3.2 `Quest` (the mission)

A thin goal layer above `WorkItem`. One active quest per workspace.

```ts
export type QuestStatus = "proposed" | "active" | "blocked" | "done" | "abandoned";

export interface Quest {
  id: string;
  workspaceId: string;
  directionId?: string;
  title: string;              // "Launch the cloud POS MVP"
  objective: string;          // what "done" delivers
  acceptance: string[];       // checklist the chair verifies against
  status: QuestStatus;
  stage: CompanyDNA["stage"];
  ownerRoleId?: string;       // the lead role (usually exec.ceo)
  trust: WorkspaceAutonomy;   // per-quest dial (default: workspace setting)
  budgetTokens?: number;      // per-quest cap; 0 = inherit workspace
  workItemIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

`WorkItem` gains an optional `questId?: string` so the board can group by quest
and the HQ can show progress. Existing rows keep working (`questId` unset).

### 3.3 `Workspace` additions

```ts
/** The chosen direction; set at ASSEMBLE. Absent = still deciding. */
directionId?: string;
/** The current mission; at most one `active` quest at a time. */
activeQuestId?: string;
```

All additive to `workspaces.data` (JSONB) — **no migration** for the fields.
Quests get their own table (below) because they're queried by status.

## 4. Schema

Idempotent, matching `apps/cloud/src/store/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS quests (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL,      -- Quest (§3.2)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quests_ws_idx ON quests (workspace_id, updated_at DESC);

-- Optional grouping (nullable, back-filled lazily).
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS quest_id TEXT;
CREATE INDEX IF NOT EXISTS work_items_quest_idx ON work_items (quest_id);
```

Store methods mirror the existing `work_items` group:

```ts
createQuest(record: QuestRecord): Promise<void>;
getQuest(id: string): Promise<QuestRecord | null>;
listQuests(workspaceId: string): Promise<QuestRecord[]>;
updateQuest(record: QuestRecord): Promise<void>;
```

## 5. API

### 5.1 `POST /v1/workspaces/plan` → **directions, not a committed org**

Today the planner returns a `CompanyPlan` with `members` ready to hire. Change it
to return the DNA + **2–3 `CompanyDirection`s** and create nothing:

```jsonc
{
  "name": "Chmaba",
  "dna": { /* CompanyDNA */ },
  "directions": [ /* CompanyDirection[] — 2–3 */ ],
  "notes": ["Read the website."]
}
```

Keep the old shape available behind a flag/field for back-compat while the UI
migrates (`?shape=plan` → legacy `CompanyPlan`).

**No silent fallback.** If `recommendTeam` matches no template keyword, do **not**
default to `saas`. Instead emit a direction with `rationale` saying the business
type was unclear, and (a) run one model pass to classify, or (b) ask the CEO to
pick from the catalog. `dna.industry` must come from analysis, never the company
name.

### 5.2 `POST /v1/workspaces` — create from a chosen direction

```jsonc
{
  "source": { "kind": "url", "value": "https://chmaba.com" },
  "directionId": "dir_ship_mvp",
  "dna": { /* edited DNA from CHARTER */ },
  "quest": { "title": "…", "objective": "…", "acceptance": ["…"] },
  "approved": true
}
```

The server hires `direction.roles`, seeds the wiki, sets
`Workspace.directionId`, and creates **one `Quest`** (status `active`) with its
roadmap as `WorkItem`s. `approved` must be true — this is the ASSEMBLE gate.

### 5.3 Quests

```
GET  /v1/workspaces/:id/quests            list (current first)
POST /v1/workspaces/:id/quests            propose a quest (approval)
POST /v1/workspaces/:id/quests/:qid/complete   mark done, check acceptance
```

### 5.4 Builder tools (`apps/cloud/src/create-company-tools.ts`)

Rename/extend the flow so it matches the loop, still approval-gated:

| Tool | Change |
| --- | --- |
| `analyze_source(source)` | unchanged — returns DNA + notes |
| `propose_directions(dna)` | **new** — returns 2–3 `CompanyDirection`s (no side effects) |
| `choose_direction(id)` | **new** — records the choice in the thread |
| `create_company(plan, directionId, quest)` | **approval** — hires + DNA + **one quest** |
| `hire_employee(...)` | **approval** — unchanged |
| `seed_backlog(...)` | replaced by the quest's roadmap; still **approval** |

## 6. Orchestration & the quest lifecycle

The chair (`Workspace.ceoBotId`) owns the quest:

- **`propose`** — the chair (or the CEO) drafts a quest with an objective and
  acceptance criteria; it appears in **Needs you** for approval.
- **`active`** — on approval the chair decomposes it into `WorkItem`s via the
  existing `delegate(role, task)` tool (company-workspace.md §6) and assigns
  owners. Only this quest's items are "current".
- **`blocked`** — anything needing money/publishing/deletion raises an
  `Approval`; blockers surface in **Needs you**.
- **`done`** — the chair checks `acceptance`, marks work items done, writes a
  `company_reports` row, and proposes the **next** quest (GROW).

**One active quest per workspace** keeps attention and cost bounded. Additional
work items are allowed but default to the `ongoing` phase, not a new mission.

## 7. Seeding changes (`company-seed.ts`)

Split today's `seedCompany` so creation respects the gates:

1. **`seedCompanyWiki`** — write `BRIEF.md` / `OKRS.md` / `BACKLOG.md` from the
   **chosen direction**, not generic features.
2. **`seedQuest`** — create the one `Quest` and its roadmap as work items.
   Nothing else gets auto-created.

Remove the unconditional `"Build the marketing website"` seed item and the
feature-per-task loop; the roadmap now comes from `CompanyDirection.roadmap`.

## 8. UI (one UI, two hosts)

`AGENTS.md` §7 applies — everything in `packages/ui`, hosts thin. The HQ already
has tabs (`need, team, board, budget, standup, plans, changes, office, wiki`);
this reshapes the front of it.

- **Charter** ✅ — the review step opens with the DNA as an editable brief
  (industry / goal / summary) plus the editable company name, so the CEO
  co-authors "what we are" before the directions and team.
- **Direction cards** — 2–3 side-by-side cards: title, thesis, a tradeoff row
  (speed / quality / cost / risk), the roles it hires, the estimated tokens, and
  "why these roles". One **Choose** action. This is the game's decision point.
- **Assemble** — the chosen direction's team as a single reviewable batch:
  **Hire the team** (one approval).
- **Quest banner** — pinned at the top of the HQ: title, progress
  (`3/5 work items`), acceptance checklist, trust dial, cost-to-date. This is
  the north star.
- **Needs you** — approvals + blockers + the proposed next quest. Always first.
- **Board** — work items grouped **by quest**, then phase.
- **Grow** — when a quest is done, a "What's next?" panel offers 1–3 next quest
  options (same card pattern).

Empty/stale states must never guess (per company-workspace.md §19): unknown
metrics show **unknown**.

## 9. Trust (autonomy) per quest

`Workspace.autonomy` (`WorkspaceAutonomy`) already exists. Surface it as a
**trust dial on the quest banner**, defaulting to the workspace setting:

| Trust | Behaviour on this quest |
| --- | --- |
| `manual` | every consequential action → approval |
| `supervised` | low-risk auto; consequential gated; budget enforced |
| `autonomous` | acts within granted capabilities + budget, no per-action approval |

Autonomy is always bounded by (a) capabilities, (b) budget, (c) approvals for
consequential actions, (d) audit — never uncapped.

## 10. Cost

- A direction card shows **`estimatedTokens`** before you pick it.
- A quest carries **`budgetTokens`**; the chair checks it with
  `isBudgetExhausted` (`company.ts`) and pauses on cap, notifying the CEO.
- One active quest bounds steady-state spend far better than "everyone has
  tasks" (company-workspace.md §9, docs/cost-controls.md).

### 10.1 Per-quest budget enforcement (Q5b — design)

**Problem.** `Quest.budgetTokens` is stored and editable but **unenforced** —
nothing attributes token spend to a quest.

**Attribution decision.** Stamp the active quest onto work as it starts, then
sum from there:

1. **`Task.questId?: string`** — set at task creation when the author bot's
   workspace has an `activeQuestId` (the message route + the scheduler).
2. **`usage_events.quest_id TEXT`** — written from the task's `questId` on every
   `addUsage`; add an index. (Needs a back-fill-free additive column.)
3. **`Quest.startedAt?: string`** — when it became active; a fallback window if
   attribution is missing.

**Enforcement (`runner.ts`).** Next to the existing workspace-budget check:

```
quest = active quest for the author's workspace
if quest && quest.budgetTokens > 0:
  used = usageTokensForQuest(quest.id)
  if used >= quest.budgetTokens: fail the task ("Quest budget reached …")
```

Fail only the task/quest — do **not** pause the whole workspace unless the
workspace cap is also hit. Surface the cap in **Needs you**.

**Store.** `usageTokensForQuest(questId): Promise<number>` in both stores
(memory: sum the usage records; postgres: `SELECT COALESCE(SUM(prompt_tokens +
completion_tokens),0) FROM usage_events WHERE quest_id = $1`).

**Watch-outs.** The workspace cap still short-circuits first. Tasks created
before a quest became active carry no `questId` (best-effort attribution) —
acceptable; `startedAt` covers the gap if we ever need it.

### 10.2 Trust semantics (Q5b)

`Quest.trust` is surfaced, stored, and now wired into the approval gate in
`runner.ts` (the effective `autoApprove` for a run):

- `manual` — every consequential tool → approval (today's default).
- `supervised` — **currently the same as `manual`**: the agent tool gate is a
  boolean `requiresApproval`, so "auto-allow `risk: none`" is not yet
  expressible. Wire it when per-tool risk reaches the gate.
- `autonomous` — skip per-action approval (`autoApprove`), still bounded by
  granted capabilities (denied tools are removed) and the quest/workspace budgets.

So the dial changes behaviour for `autonomous` today; `supervised` is a
stored-but-not-yet-distinct step between the two.

### 10.3 Grow panel (Q5)

When a quest is marked `done`, the HQ banner offers 1–3 next-quest options
(reuse the direction-card pattern) or a **"Ask the chair for the next quest"**
button (`company.propose`). Keeps the loop moving without a task dump.

## 11. Back-compat & migration

- `Workspace.directionId` / `activeQuestId` and `WorkItem.questId` are optional —
  existing companies keep working; they simply have no quest yet.
- When a legacy company opens the HQ, offer a one-click **"Turn current backlog
  into your first quest"** (wraps existing items under a new `Quest`, no data
  migration).
- The old `/v1/workspaces/plan` shape stays available during the UI transition.

## 12. Phasing

| Order | Deliverable | Status |
| --- | --- | --- |
| Q0 | `CompanyDirection` + `Quest` types in shared; store records + memory/postgres methods; `quests` table | ✅ |
| Q1 | `/v1/workspaces/plan` returns **directions**; no silent `saas` fallback; industry from analysis | ✅ |
| Q2 | Create-from-direction; `seedQuest`; **one** quest seeded | ✅ |
| Q3 | HQ: Charter → Direction cards → Assemble → Quest banner | ✅ |
| Q4 | Chair quest lifecycle (`propose`/`complete`/next) + **Needs you** | ✅ |
| Q5 | Per-quest trust dial + budget; Grow panel | ✅ |

Q0–Q1 are the smallest high-leverage slice: they change the experience from
"magic dump" to "choose your direction" with no UI work required to be useful.

## 13. Open questions

- **How many directions?** 2–3 is the sweet spot; more is homework, fewer is no
  choice. Start at 3.
- **Who writes the directions** — the recommender (deterministic) with a model
  pass to tailor copy, or the model with catalog validation? Prefer
  *catalog-first, model-tailors* (company-workspace.md §31).
- **Sequencing vs. parallelism** — exactly one active quest, or a small
  work-in-progress limit (e.g. ≤ 3 open quests)? Start with one.
- **Acceptance verification** — the chair self-checks acceptance; add a second
  employee as reviewer later (company-os.md §14).
- **Learned directions** — cache a direction that worked for an industry so the
  next company of that type starts smarter (like `LearnedSkill`).
