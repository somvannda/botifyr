# Virtual Workspace Implementation Plan

> **Owner:** Product/Engineering  
> **Created:** 2026-10-13  
> **Status:** Draft — awaiting owner approval  
> **Goal:** Make the AI company real — turn well-designed roles into working employees that can execute end-to-end through owned channels, with correct authorization, real management flow, and a CEO inbox that surfaces what needs decisions.

---

## Executive summary

The Virtual Workspace foundation is well-architected but under-executed. We have:
- ✅ 23 roles across 13 departments with catalog-defined capabilities
- ✅ Approval gates, trust ladder, budgets, quest flow, wiki, board
- ✅ Scheduled runs (every 30s ticker in `server.ts`)
- ✅ Tools for browser, code, shell, media, social, email, ads, design

**But:**
- ❌ Authorization is department-driven, not role-driven (grants are decorative)
- ❌ Default companies can't publish/email (tools exist, no credentials wired)
- ❌ Managers don't actually manage (delegation is write-only)
- ❌ "Needs you" is scattered (approvals/quests/escalations not unified)
- ❌ No decision log (companies forget why they chose X)

**This plan:** Fix the 5 foundation gaps (Phase 0, ~2 weeks), then enable roles one-by-one with instructions + verification (Phases 1–4, ~4 weeks). Total: 6 weeks to a working AI company.

---

## Guiding principles

1. **Foundation before features.** Fix auth + Hands + inbox before adding role instructions.
2. **Owned channels first.** Telegram/email/Feed work without external approvals; Meta/LinkedIn come later.
3. **One role at a time.** Write instructions, verify with mock provider, test with real model, enable for all companies.
4. **Depth over breadth.** Make 5 roles work end-to-end before adding 20 half-working roles.
5. **Safety never regresses.** Every change preserves approvals, budgets, audit, sandboxing.

---

## Phase 0: Foundation fixes (do these first)

**Timeline:** Weeks 1–2 (10 working days)  
**Gate:** No role work until these 5 items ship.

---

### 0.1 Fix authorization to be role-driven, not department-driven

> **Status: ✅ IMPLEMENTED** (branch `agent/phase0-fix-authorization`).
> Files: `apps/cloud/src/capability-tools.ts` (new), `apps/cloud/src/runner.ts`,
> `packages/shared/src/catalog.ts`, `apps/cloud/src/capability-tools.test.ts` (new).
> See "Design decision" below — the implemented model differs slightly from the
> first sketch (grants are the override, not merely a subtract-only set).

**Problem:**  
`apps/cloud/src/runner.ts` `buildTools` decides tools by `bot.department` string. Capability grants (in `capability_grants` table) only *remove* tools; they never add them. A bot's `BotRole.capabilities` from the catalog is decorative — it's not the enforcement point.

**Impact:**  
- A CTO can never be granted `ads.manage` (not in `engineering` department's tools)
- A Marketing bot denied `social.publish` can still get `feed.post` (mapped to same capability, but grants check tool name, not capability ID)
- Trust ladder demotions block tools, but promotions don't restore them (asymmetric)

**Design decision (implemented):**
- **Catalog = default.** A role's capabilities come from its `ROLE_CATALOG` entry (matched by title; unknown/custom titles fall back to the *intersection* of the department's catalog capabilities, so an unplaceable role gets only the safe baseline).
- **Grants = override, both directions.** A grant with `granted: true` **adds** a capability the role doesn't declare; `granted: false` **removes** one. (`CapabilityTrust` has no `blocked` state — denial is `granted: false`.)
- **Safety unchanged.** Consequential tools stay `requiresApproval`, so an added capability is never executed silently; the workspace's trust ladder still controls auto-approve.

**Fix:**
1. **Change `buildTools` logic** (`runner.ts`, ~line 150–250):
   - **Before:** `if (department === "marketing") tools.push(...socialTools, ...emailTools)`
   - **After:**
     ```ts
     // Start with zero tools
     const grantedTools = new Set<ToolDefinition>();
     
     // Get the role's declared capabilities from the catalog
     const role = ROLE_BY_ID.get(botRole.roleId); // from recommend.ts
     const declaredCapabilities = role?.capabilities ?? [];
     
     // Get the bot's actual grants from the store
     const grants = await store.listCapabilityGrants(workspaceId, botId);
     const grantsMap = new Map(grants.map(g => [g.capability, g]));
     
     // For each declared capability:
     for (const capabilityId of declaredCapabilities) {
       const grant = grantsMap.get(capabilityId);
       
       // If blocked, skip
       if (grant?.state === "blocked") continue;
       
       // Map capability → tools (via tool-capabilities.ts)
       const tools = getToolsForCapability(capabilityId, allAvailableTools);
       for (const tool of tools) {
         grantedTools.add(tool);
       }
     }
     
     return Array.from(grantedTools);
     ```

2. **Add `getToolsForCapability` helper** (new file `apps/cloud/src/capability-tools-map.ts`):
   ```ts
   import { createSocialTools } from "./social-tools.js";
   import { createEmailTools } from "./email-tools.js";
   // ... other tool factories
   
   export function getToolsForCapability(
     capabilityId: string,
     context: { socialClient, emailSender, store, ... }
   ): ToolDefinition[] {
     switch (capabilityId) {
       case "social.read_insights":
       case "social.publish":
       case "social.reply":
         return createSocialTools(context.socialClient);
       case "email.send":
         return createEmailTools(context.emailSender);
       case "research.web":
         return [browserTools.goto, browserTools.extract, browserTools.screenshot];
       // ... map every capability from catalog.ts to its tools
       default:
         return [];
     }
   }
   ```

3. **Update `tool-capabilities.ts`** to be the canonical map (merge with the new helper if it duplicates).

4. **Preserve chair/founder exceptions** (they get extra tools like `company.hire`, `company.fire`).

**Files changed:**
- `apps/cloud/src/runner.ts` (buildTools refactor)
- `apps/cloud/src/capability-tools-map.ts` (new)
- `apps/cloud/src/tool-capabilities.ts` (verify/merge)

**Verification (implemented in `capability-tools.test.ts`):**
- Unit test: a known role resolves to its catalog capabilities (e.g. Social Media Manager → `social.publish`/`social.reply`)
- Unit test: a custom title falls back to the department baseline (no role-specific extras leak)
- Unit test: `granted: false` removes a capability and records it as blocked
- Unit test: `granted: true` **adds** a capability beyond the role's defaults (the old subtract-only hole)
- Unit test: a grant for another subject is ignored
- Unit test: a later deny beats an earlier add
- Unit test: the catalog declares the hands we depend on (guards silent data regressions)

**Acceptance:**
- Catalog `capabilities` = the role's default set ("what this role should have")
- Grants = per-employee override (add / remove) + trust-ladder state for auto-approve
- Department string = organizational only, not a tool gate
- Consequential tools stay approval-gated (no silent execution of an added capability)

**Estimated effort:** 2–3 days (implemented in ~1 day)

---

### 0.2 Make Hands real for owned channels (Telegram + Email + Feed)

> **Status: ✅ SHIPPED (0.2a + 0.2b).**
> **0.2a:** Botifyr's **Feed** is an owned channel gated by social *capabilities*
> (`runner.ts`) instead of the `"feed"` skill that no company employee ever
> received — so a brand-new company can publish with zero external setup.
> Personal/founder bots keep the opt-in `"feed"` skill path.
> **0.2b:** Telegram now prefers a **workspace** channel (workspace secrets
> `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`) over the process env + the owner's
> personal link, via `resolveTelegramChannel` (`social-telegram.ts`). Setup is in
> [`setup-channels.md`](setup-channels.md). Email already works once
> `RESEND_API_KEY` + `MAIL_FROM` are set.
> Files: `apps/cloud/src/runner.ts`, `apps/cloud/src/social-telegram.ts`,
> `apps/cloud/src/capability-tools.test.ts`, `apps/cloud/src/social-telegram.test.ts`,
> `docs/setup-channels.md`.

**Problem:**  
Tools exist (`social-tools.ts`, `email-tools.ts`, `feed-tools.ts`), but default companies have no credentials wired. A Marketing bot can draft a post but can't publish it. Scheduled runs produce plans, not shipped artifacts.

**Fix — 3 owned channels (no external approvals needed):**

#### **A. Telegram (social publishing)**

1. **Setup instructions** (new doc: `docs/setup-telegram-channel.md`):
   - Create a Telegram channel via the app
   - Create a bot via @BotFather, get `TELEGRAM_BOT_TOKEN`
   - Add the bot as an admin to the channel, get channel ID
   - Store in env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`

2. **Wire into company seed** (`apps/cloud/src/company-seed.ts`):
   - When a company is created, if `TELEGRAM_BOT_TOKEN` exists, create a `SocialClient` via `createTelegramSocial` (already in `social-telegram.ts`)
   - Store the connection in the workspace (new field: `workspace.connectedChannels`?)
   - Marketing/Sales/Design bots automatically get `social.*` tools pointing to this client

3. **Default company "Acme Marketing Agency"** uses Telegram as its social channel (example in docs).

**Files changed:**
- `docs/setup-telegram-channel.md` (new)
- `apps/cloud/src/company-seed.ts` (wire Telegram client if env exists)
- `apps/cloud/src/runner.ts` (pass the workspace's Telegram client to `createSocialTools`)

---

#### **B. Email (outreach/support)**

1. **Setup instructions** (new doc: `docs/setup-email.md`):
   - Sign up for Resend (free tier: 100 emails/day)
   - Get API key, set `RESEND_API_KEY` + `MAIL_FROM` (e.g., `bot@yourcompany.com`)

2. **Wire into company seed:**
   - If `RESEND_API_KEY` exists, create an `EmailSender` via `resendSender` (already in `email-tools.ts`)
   - Sales/Support/Success bots automatically get `email.send` tool

**Files changed:**
- `docs/setup-email.md` (new)
- `apps/cloud/src/company-seed.ts` (wire Resend if env exists)
- `apps/cloud/src/runner.ts` (pass the email sender to `createEmailTools`)

---

#### **C. Botifyr Feed (internal social surface)**

1. **Already works** (`feed-tools.ts` exists).

2. **Default company setup:**
   - When a company is created, automatically create a **Page** owned by the company (via `store.createPage`)
   - Marketing/Design bots get `feed.post` tool, pre-configured to post as this Page

3. **Document usage** (`docs/setup-feed.md`):
   - "Your company has a Page on Botifyr's Feed. Bots can publish posts (with approval) visible to all users."

**Files changed:**
- `docs/setup-feed.md` (new)
- `apps/cloud/src/company-seed.ts` (create a company Page on workspace creation)
- `apps/cloud/src/runner.ts` (pass the Page ID to `createFeedTools`)

---

**Deliverable after 0.2:**  
A default company activated to "supervised" can:
- Publish to **Telegram** (Marketing Manager drafts → `social.publish` → approval → post appears in your channel)
- Send **email** (Sales Rep drafts → `email.send` → approval → email sent via Resend)
- Post to **Feed** (Marketing Manager drafts → `feed.post` → approval → post on company Page)

**Verification:**
- Create "Acme Marketing Agency" company
- Activate to "supervised"
- Delegate task: "Post about our new service on Telegram"
- Wait for Marketing Manager's scheduled run (or trigger manually)
- Approve the `social.publish` call
- Verify post appears in your Telegram channel

**Estimated effort:** 3–5 days (setup + docs + wiring + testing)

---

### 0.3 Turn "Needs you" into the real inbox

**Problem:**  
Approvals appear in a modal, proposed quests appear in the HQ, escalations are tasks, trust demotions are events, blocked work items are on the board. No unified, ranked "here's what needs you, prioritized by urgency."

**Fix:**

1. **New API endpoint** (`apps/cloud/src/server.ts`):
   ```ts
   app.get<{ Params: { id: string } }>(
     "/v1/workspaces/:id/needs-you",
     { preHandler: requireAuth },
     async (request, reply) => {
       const userId = request.userId as string;
       const workspace = await store.getWorkspace(request.params.id);
       if (!workspace || workspace.ownerId !== userId) {
         return reply.code(404).send({ error: "workspace not found" });
       }
       
       const items: NeedsYouItem[] = [];
       
       // 1. Pending approvals (high-risk first)
       const approvals = await store.listApprovals(userId);
       for (const approval of approvals.filter(a => a.status === "pending")) {
         items.push({
           type: "approval",
           urgency: approval.risk === "high" ? 3 : approval.risk === "medium" ? 2 : 1,
           taskId: approval.taskId,
           goal: approval.context.goal,
           reason: approval.reason,
           risk: approval.risk,
           createdAt: approval.createdAt,
         });
       }
       
       // 2. Trust demotions (capability blocked/probation)
       const grants = await store.listCapabilityGrants(workspace.id);
       for (const grant of grants.filter(g => g.state === "blocked" || g.state === "probation")) {
         items.push({
           type: "trust_demotion",
           urgency: 2,
           botId: grant.subjectBotId,
           capability: grant.capability,
           reason: `${grant.failures} failure(s), state: ${grant.state}`,
           demotedAt: grant.updatedAt,
         });
       }
       
       // 3. Proposed quests
       const quests = await store.listQuests(workspace.id);
       for (const quest of quests.filter(q => q.status === "proposed")) {
         items.push({
           type: "quest_proposed",
           urgency: 1,
           questId: quest.id,
           title: quest.title,
           objective: quest.objective,
           proposedAt: quest.createdAt,
         });
       }
       
       // 4. Escalations (from company.escalate tool)
       const tasks = await store.listTasks(userId);
       for (const task of tasks.filter(t => t.status === "awaiting_approval")) {
         const lastStep = task.steps[task.steps.length - 1];
         if (lastStep?.detail?.includes("Escalated")) {
           items.push({
             type: "escalation",
             urgency: 2,
             taskId: task.id,
             botId: task.botId,
             reason: lastStep.detail,
             escalatedAt: lastStep.startedAt,
           });
         }
       }
       
       // 5. Blocked work items
       const workItems = await store.listWorkItems(workspace.id);
       const now = Date.now();
       for (const item of workItems.filter(w => w.status === "blocked")) {
         const blockedMs = now - new Date(item.updatedAt).getTime();
         items.push({
           type: "blocked_work_item",
           urgency: blockedMs > 86400000 ? 2 : 1, // >24h = urgent
           workItemId: item.id,
           title: item.title,
           assignee: item.assigneeBotId,
           blockedSince: item.updatedAt,
         });
       }
       
       // Sort by urgency desc, then by time asc
       items.sort((a, b) => b.urgency - a.urgency || 
                            new Date(a.createdAt || a.demotedAt || a.proposedAt || a.escalatedAt || a.blockedSince).getTime() -
                            new Date(b.createdAt || b.demotedAt || b.proposedAt || b.escalatedAt || b.blockedSince).getTime());
       
       return { urgent: items.filter(i => i.urgency >= 2).length, items };
     }
   );
   ```

2. **Update HQ UI** (`packages/ui/src/HQView.tsx` or wherever "Needs you" tab is):
   - Replace current tab with a fetch to `/v1/workspaces/:id/needs-you`
   - Render each item with:
     - Icon (⚠️ approval, 🔻 demotion, 💡 quest, 🆘 escalation, 🚧 blocked)
     - Title/reason
     - Action button (Approve/Deny, Restore trust, Start quest, Unblock, View task)
   - Badge count = `urgent` count

3. **Types** (`packages/shared/src/index.ts`):
   ```ts
   export type NeedsYouItemType = 
     | "approval" 
     | "trust_demotion" 
     | "quest_proposed" 
     | "escalation" 
     | "blocked_work_item";
   
   export interface NeedsYouItem {
     type: NeedsYouItemType;
     urgency: 1 | 2 | 3; // 1=low, 2=medium, 3=high
     // ... variant fields per type
   }
   ```

**Files changed:**
- `apps/cloud/src/server.ts` (new endpoint)
- `packages/shared/src/index.ts` (types)
- `packages/ui/src/HQView.tsx` (UI refactor)
- `packages/client/src/index.ts` (new method: `client.getNeedsYou(workspaceId)`)

**Verification:**
- Block a work item → appears in list with urgency 1
- Demote a capability → appears with urgency 2
- Submit a high-risk approval → appears with urgency 3
- List is sorted correctly (high-risk approval first)

**Estimated effort:** 2–3 days

---

### 0.4 Give managers an actual pull loop (scheduled delegation)

**Problem:**  
`company.delegate` creates work items, but managers don't actually *assign* work during their scheduled runs. Every bot self-polls its own board tasks. The org chart (manager→IC reporting) is decorative in execution.

**Fix:**

1. **New tool for head-level bots** (`apps/cloud/src/delegation-tools.ts`, add to exports):
   ```ts
   {
     name: "company.review_department",
     description: "Review your department's board: open tasks, blockers, and who's assigned what. Use this to decide what to delegate next.",
     parameters: { type: "object", properties: {} },
     run: async () => {
       const workspace = await store.getWorkspaceBotBelongsTo(botId);
       if (!workspace) return { ok: false, output: "No workspace found." };
       
       const myRole = await store.getBotRole(workspace.id, botId);
       if (!myRole || myRole.level !== "head") {
         return { ok: false, output: "Only department heads can review their department." };
       }
       
       const allItems = await store.listWorkItems(workspace.id);
       const roles = await store.listBotRoles(workspace.id);
       const myDeptBots = roles.filter(r => r.department === myRole.department);
       const myDeptBotIds = new Set(myDeptBots.map(r => r.botId));
       
       const deptItems = allItems.filter(item => 
         item.assigneeBotId && myDeptBotIds.has(item.assigneeBotId)
       );
       
       const open = deptItems.filter(w => w.status === "todo" || w.status === "in_progress");
       const blocked = deptItems.filter(w => w.status === "blocked");
       
       const byAssignee = new Map<string, typeof deptItems>();
       for (const item of open) {
         const list = byAssignee.get(item.assigneeBotId!) ?? [];
         list.push(item);
         byAssignee.set(item.assigneeBotId!, list);
       }
       
       let report = `Department: ${myRole.department}\n\n`;
       report += `Open: ${open.length}, Blocked: ${blocked.length}\n\n`;
       
       if (blocked.length > 0) {
         report += "**Blocked tasks:**\n";
         for (const item of blocked) {
           const assignee = myDeptBots.find(r => r.botId === item.assigneeBotId);
           report += `- ${item.title} (${assignee?.title ?? "unassigned"})\n`;
         }
         report += "\n";
       }
       
       report += "**By assignee:**\n";
       for (const [botId, items] of byAssignee) {
         const role = myDeptBots.find(r => r.botId === botId);
         report += `- ${role?.title ?? "unknown"}: ${items.length} task(s)\n`;
       }
       
       return { ok: true, output: report };
     }
   }
   ```

2. **Update scheduled prompt for heads** (`apps/cloud/src/server.ts`, line ~3357 where schedules are set):
   - **Before:** `"Review your board tasks and do the next one..."`
   - **After (for heads only):**
     ```ts
     const isHead = role.level === "head";
     const prompt = isHead
       ? "Review your department (company.review_department), unblock stalled work, and delegate the next priority task to the right IC. Report progress to your manager."
       : "Check your assigned board tasks (company.board), pick the highest-priority one, do it, and report the result (company.report).";
     ```

3. **Ensure `company.delegate` is available to heads** (already is, but verify in `runner.ts` that heads get delegation tools).

**Files changed:**
- `apps/cloud/src/delegation-tools.ts` (add `company.review_department`)
- `apps/cloud/src/server.ts` (scheduled prompt split by level)

**Verification:**
- Create a company with Head of Product + Product Manager (IC)
- Delegate a task to "Product" department (unassigned, or assigned to Head)
- Head's scheduled run → calls `company.review_department` → delegates to IC via `company.delegate`
- IC's scheduled run → calls `company.board` → completes the task via `company.report`

**Estimated effort:** 3–5 days

---

### 0.5 Add a decision log (DECISIONS.md)

**Problem:**  
Long-lived companies make choices (hire X, switch direction Y, pause quest Z), but there's no durable record of *why*. The wiki has plans and backlogs, but not a decision trail.

**Fix:**

1. **New tool** (`apps/cloud/src/decision-tools.ts`, new file):
   ```ts
   import { randomUUID } from "node:crypto";
   import type { ToolDefinition } from "@botifyr/agent-core";
   import type { Store } from "./store/index.js";
   
   export function createDecisionTools(store: Store, userId: string, botId: string): ToolDefinition[] {
     return [
       {
         name: "company.decide",
         description: "Record a significant decision for the company log (who, what, why). Use this when you change direction, hire a key role, or make a strategic choice the team should remember.",
         parameters: {
           type: "object",
           properties: {
             decision: { type: "string", description: "What was decided (1 sentence)." },
             reasoning: { type: "string", description: "Why this choice (1–2 sentences)." },
             owner: { type: "string", description: "Who decided (your role title or 'CEO')." },
           },
           required: ["decision", "reasoning"],
         },
         run: async (args) => {
           const decision = String(args.decision ?? "").trim().slice(0, 200);
           const reasoning = String(args.reasoning ?? "").trim().slice(0, 500);
           const owner = String(args.owner ?? "").trim().slice(0, 60) || "CEO";
           
           if (!decision || !reasoning) {
             return { ok: false, output: "Decision and reasoning are required." };
           }
           
           const workspace = await store.getWorkspaceBotBelongsTo(botId);
           if (!workspace) return { ok: false, output: "No workspace found." };
           
           const now = new Date().toISOString();
           const date = now.split("T")[0]; // YYYY-MM-DD
           const existing = (await store.listWorkspaceFiles(workspace.id)).find(
             (file) => file.name === "DECISIONS.md"
           );
           
           const entry = `## ${date} — ${decision}\n**Owner:** ${owner}  \n**Reasoning:** ${reasoning}\n\n`;
           const content = existing
             ? `${existing.content}\n${entry}`
             : `# Company Decisions\n\n${entry}`;
           
           await store.upsertFile({
             id: existing?.id ?? randomUUID(),
             botId: existing?.botId ?? botId,
             userId,
             workspaceId: workspace.id,
             name: "DECISIONS.md",
             content: content.slice(0, 50_000), // cap at 50k chars
             createdAt: existing?.createdAt ?? now,
             updatedAt: now,
           });
           
           return { ok: true, output: `Recorded decision: "${decision}" to DECISIONS.md.` };
         },
       },
     ];
   }
   ```

2. **Wire into chair bot** (`apps/cloud/src/runner.ts`):
   - Add `createDecisionTools(store, userId, botId)` to the chair's tool list

3. **Update chair's instructions** (in `company-seed.ts` or wherever chair JD is set):
   - Add: "Record significant decisions with company.decide (e.g., when you propose a quest, hire a key role, or pivot direction)."

**Files changed:**
- `apps/cloud/src/decision-tools.ts` (new)
- `apps/cloud/src/runner.ts` (wire to chair)
- `apps/cloud/src/company-seed.ts` (chair instructions)

**Verification:**
- Chair proposes a quest → calls `company.decide({decision: "Proposed quest: Ship MVP", reasoning: "No active quest; MVP is the priority", owner: "CEO"})`
- Check wiki → `DECISIONS.md` exists with the entry
- Make a second decision → entry is appended, not overwritten

**Estimated effort:** 1 day

---

## Phase 0 summary

**Total estimated effort:** 10–12 days (2 weeks)

**Deliverables:**
- ✅ Authorization is role-driven (catalog = source of truth)
- ✅ Default companies can publish to Telegram + send email + post to Feed
- ✅ "Needs you" is a unified, ranked inbox
- ✅ Managers review their department and delegate; ICs execute
- ✅ Decisions are logged to DECISIONS.md

**Gate before Phase 1:** Create a test company, activate to "supervised", verify:
1. Marketing Manager has `social.*` tools (check via task run, not just catalog)
2. Scheduled run publishes to Telegram (with approval)
3. "Needs you" shows the pending approval
4. Chair logs the decision

---

## Phase 1: Roles that work today (instructions only)

**Timeline:** Week 3 (5 days)  
**Roles:** CEO, Head of Product, Business Analyst, Product Researcher, Content Manager, SEO Specialist, Lead Researcher, Data Analyst, Head of Operations, Compliance Officer, Recruiter

**Why these first:** They only need `research.web` + `files.read/write` + `code.run` (for Data Analyst) — all of which exist and are wired. No new tools. Focus: **instructions + verification**.

---

### 1.1 Write role-specific instructions

For each role, create a **baked-in instruction template** that gets added to `bot.instructions` when hired.

**Location:** Store in `apps/cloud/src/role-instructions/` (new directory), one `.md` per role, e.g. `ceo.md`, `product-manager.md`, etc.

**Format:**
```markdown
# {Role Title} — Instructions

You {one-line summary from catalog}.

## Your workflow
1. Step one (what tool to use)
2. Step two
3. Report to your manager with company.report

## Example: "{Typical task}"
- Substep (concrete tool call)
- Substep
- Outcome (what artifact you produce)

## Quality bar
- Standard 1
- Standard 2
```

**Example: Business Analyst** (`business-analyst.md`):
```markdown
# Business Analyst — Instructions

You analyze the market and turn findings into structured requirements.

## Your workflow
1. Research the market/competitors (browser.goto, browser.extract, research.web)
2. Write a requirements doc: REQUIREMENTS-{topic}.md (library.write)
3. Report to your manager: company.report

## Example: "Research project management SaaS competitors"
1. Use browser.goto to visit top 3 (Asana, Monday.com, ClickUp)
2. Extract: pricing, key features, target audience (browser.extract)
3. Write REQUIREMENTS-pm-saas.md with:
   - Market size estimate
   - Competitor feature matrix
   - Gaps we could fill
   - Must-haves for our product
4. Report: "Researched 3 competitors; requirements in wiki"

## Quality bar
- Requirements are specific (not "good UX" — say "drag-and-drop task reordering")
- Cite sources (URLs)
- Keep it under 2000 words
- Identify 1–3 clear opportunities
```

**Other examples (abbreviated):**

**CEO (chair):**
```markdown
# CEO — Instructions

You set direction, plan the work, delegate to department heads, unblock them, and report to the human owner.

## Your daily standup workflow
1. Read the company wiki (BRIEF.md, OKRS.md, BACKLOG.md, PLAN.md)
2. Check the active quest and board (company.board)
3. Review your department heads' progress
4. Summarize: what shipped, what's blocked, what needs the owner
5. If no PLAN.md exists, write one now (company.plan)
6. If the quest is stalled or done, propose the next one (company.propose)
7. Write the standup to STANDUP-{date}.md (library.write)
8. Log significant decisions (company.decide)
9. Report to the owner: "Standup ready. Blockers: {X}. Needs you: {Y}."

## Decision-making
- Every strategic choice (hire, pivot, quest) → company.decide
- Delegate execution to heads; you own the outcome, not the tasks
- Unblock before escalating to the owner

## Quality bar
- Standups are concise (<500 words)
- Decisions are recorded with reasoning
- You delegate clearly (who, what, why, when)
```

**Head of Product:**
```markdown
# Head of Product — Instructions

You own the product roadmap and turn goals into clear, small tasks.

## Your workflow
1. Review your department's board (company.review_department)
2. Break big goals into small tasks (1–3 days each)
3. Delegate to Product Managers / Analysts / Researchers (company.delegate)
4. Write specs for unclear features (SPEC-{feature}.md via library.write)
5. Report to the CEO with progress + blockers

## Example: "Plan the MVP features"
1. Read the company BRIEF and OKRS
2. Research competitors (browser or delegate to Product Researcher)
3. Write SPEC-mvp.md: 5–8 must-have features, each with a 1-paragraph description
4. Break into tasks: "Research payment providers", "Design signup flow", "Spec dashboard"
5. Delegate each task to the right IC (company.delegate)
6. Report: "MVP spec ready; 8 tasks delegated"

## Quality bar
- Tasks are <3 days each
- Every task has an owner
- Specs are concrete (not vague)
```

**Content Manager:**
```markdown
# Content Manager — Instructions

You plan and draft content (blog posts, guides, case studies).

## Your workflow
1. Research the topic (browser.goto, browser.extract)
2. Draft the content (library.write to DRAFT-{topic}.md)
3. Keep drafts under 2000 words
4. Report to your manager: "Draft ready for review"

## Example: "Write a blog post about our new feature"
1. Research the feature (read BRIEF/SPEC or ask Product)
2. Research 2 competitor posts on similar features
3. Draft BLOG-new-feature.md:
   - Hook (problem we solve)
   - How it works (3–5 paragraphs)
   - CTA (sign up / try it)
4. Report: "Blog draft ready in wiki"

## Quality bar
- Every post has a clear hook (question, stat, story)
- Tone matches the brand (check BRIEF.md)
- No jargon; explain like you're talking to a smart friend
```

**Remaining roles:** Follow the same pattern. Keep each under ~300 words; focus on workflow + one example + quality bar.

---

### 1.2 Bake instructions into hired bots

**Change `hire-tools.ts` or `company-seed.ts`** to load the instruction template when a bot is created:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadRoleInstructions(roleId: string): string {
  const path = join(__dirname, "role-instructions", `${roleId}.md`);
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return ""; // fallback if no template exists yet
  }
}

// In hire-tools.ts, when creating the bot:
const bot: Bot = {
  id: randomUUID(),
  userId,
  name,
  emoji: "🤖",
  scheme: 0,
  instructions: loadRoleInstructions(roleId) || instructions, // template overrides default
  workspace: workspace.name,
  sessionId: session.id,
  createdAt: now,
};
```

---

### 1.3 Verify each role (mock provider)

For each role, write a **verification script** (`apps/cloud/scripts/verify-role-{roleId}.mjs`):

```js
import { runTask } from "../src/runner.js";
import { createMockProvider } from "@botifyr/agent-core";

// 1. Create a test company
// 2. Hire the role (e.g., Business Analyst)
// 3. Delegate a task: "Research project management SaaS competitors"
// 4. Run the task with mock provider
// 5. Assert:
//    - Bot called browser.goto (at least once)
//    - Bot called library.write (saved REQUIREMENTS-*.md)
//    - Bot called company.report
//    - No errors

console.log("✅ Business Analyst verification passed");
```

Run with: `node apps/cloud/scripts/verify-role-business-analyst.mjs`

---

### 1.4 Verify with real model (optional, costs tokens)

Same flow, but use `BOTIFYR_PROVIDER=deepseek` (cheapest). Measure:
- Token usage (should be <5k tokens per task)
- Output quality (is the requirements doc useful?)
- Time (should finish in <2 minutes)

---

### 1.5 Enable for all companies

Once verified, the role is "production-ready." Every new company that hires this role automatically gets the instructions + correct tools (via the fixed authorization from Phase 0.1).

---

### Phase 1 roles checklist

| # | Role | Instructions written | Mock verified | Real verified | Enabled |
|---|---|---|---|---|---|
| 1 | CEO (chair) | ⬜ | ⬜ | ⬜ | ⬜ |
| 2 | Head of Product | ⬜ | ⬜ | ⬜ | ⬜ |
| 3 | Business Analyst | ⬜ | ⬜ | ⬜ | ⬜ |
| 4 | Product Researcher | ⬜ | ⬜ | ⬜ | ⬜ |
| 5 | Content Manager | ⬜ | ⬜ | ⬜ | ⬜ |
| 6 | SEO Specialist | ⬜ | ⬜ | ⬜ | ⬜ |
| 7 | Lead Researcher (sales) | ⬜ | ⬜ | ⬜ | ⬜ |
| 8 | Data Analyst | ⬜ | ⬜ | ⬜ | ⬜ |
| 9 | Head of Operations | ⬜ | ⬜ | ⬜ | ⬜ |
| 10 | Compliance Officer | ⬜ | ⬜ | ⬜ | ⬜ |
| 11 | Recruiter | ⬜ | ⬜ | ⬜ | ⬜ |

**Estimated effort:** 5 days (11 roles × ~4 hours each: write instructions, verify, document)

---

## Phase 2: Roles needing small, self-contained new tools

**Timeline:** Week 4 (5 days)  
**Roles:** Head of Sales, Sales Rep, Customer Success Manager, Finance Analyst, Visual Designer

**Why these next:** They need 1–2 new tools each, but **no external API credentials**. Tools are self-contained and owned-channel.

---

### 2.1 New tool: `crm.log_activity`

**Purpose:** Sales/Success bots log interactions (calls, emails, meetings) to a CRM file in the wiki.

**Tool definition** (`apps/cloud/src/crm-tools.ts`, new file):
```ts
import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";

export function createCRMTools(store: Store, userId: string, botId: string): ToolDefinition[] {
  return [
    {
      name: "crm.log_activity",
      description: "Log a sales/success interaction (call, email, meeting) to the CRM file.",
      parameters: {
        type: "object",
        properties: {
          lead: { type: "string", description: "Lead/customer name (e.g., 'Acme Corp')." },
          activity: { type: "string", description: "What you did (e.g., 'sent intro email')." },
          outcome: { type: "string", description: "Result (e.g., 'awaiting reply')." },
          nextStep: { type: "string", description: "Optional next action (e.g., 'follow up in 3 days')." },
        },
        required: ["lead", "activity", "outcome"],
      },
      run: async (args) => {
        const lead = String(args.lead ?? "").trim().slice(0, 100);
        const activity = String(args.activity ?? "").trim().slice(0, 300);
        const outcome = String(args.outcome ?? "").trim().slice(0, 300);
        const nextStep = String(args.nextStep ?? "").trim().slice(0, 200);
        
        if (!lead || !activity || !outcome) {
          return { ok: false, output: "Lead, activity, and outcome are required." };
        }
        
        const workspace = await store.getWorkspaceBotBelongsTo(botId);
        if (!workspace) return { ok: false, output: "No workspace found." };
        
        const now = new Date().toISOString();
        const date = now.split("T")[0];
        const fileName = `CRM-${lead.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
        
        const existing = (await store.listWorkspaceFiles(workspace.id)).find(
          (file) => file.name === fileName
        );
        
        const entry = `## ${date}\n**Activity:** ${activity}  \n**Outcome:** ${outcome}  \n${nextStep ? `**Next step:** ${nextStep}\n` : ""}\n`;
        const content = existing
          ? `${existing.content}\n${entry}`
          : `# ${lead}\n\n${entry}`;
        
        await store.upsertFile({
          id: existing?.id ?? randomUUID(),
          botId: existing?.botId ?? botId,
          userId,
          workspaceId: workspace.id,
          name: fileName,
          content: content.slice(0, 20_000),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        
        return { ok: true, output: `Logged activity for ${lead} to ${fileName}.` };
      },
    },
  ];
}
```

**Wire into runner** (`apps/cloud/src/runner.ts`):
- Add to Sales/Success roles (when `department === "sales"` or `department === "success"`)

**Instructions for Sales Rep:**
```markdown
## Logging interactions
After every outreach/call/meeting, log it:
crm.log_activity({
  lead: "Acme Corp",
  activity: "sent intro email",
  outcome: "awaiting reply",
  nextStep: "follow up in 3 days"
})

Check CRM files in the wiki to see past interactions before reaching out.
```

**Estimated effort:** 1 day (tool + instructions + verification)

---

### 2.2 New tool: `finance.query_ledger`

**Purpose:** Finance Analyst queries wallet transactions, usage events, and invoices.

**Tool definition** (`apps/cloud/src/finance-tools.ts`, new file):
```ts
import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";

export function createFinanceTools(store: Store, userId: string): ToolDefinition[] {
  return [
    {
      name: "finance.ledger",
      description: "Query the company's spending ledger: wallet transactions, usage events, and invoices over a period.",
      parameters: {
        type: "object",
        properties: {
          period: { 
            type: "string", 
            enum: ["last_7_days", "last_30_days", "this_month", "all_time"],
            description: "Time period to query."
          },
        },
        required: ["period"],
      },
      run: async (args) => {
        const period = args.period === "last_30_days" ? 30 : 
                      args.period === "this_month" ? 30 : 
                      args.period === "last_7_days" ? 7 : 
                      365; // all_time = rough 1 year
        
        const since = new Date(Date.now() - period * 86400_000).toISOString();
        
        const transactions = await store.listWalletTransactions(userId, since);
        const usage = await store.listUsageEvents(userId, since);
        const invoices = await store.listInvoices(userId);
        
        const totalSpent = transactions
          .filter(t => t.type === "debit")
          .reduce((sum, t) => sum + t.amountCents, 0);
        
        const totalTokens = usage.reduce((sum, e) => sum + e.promptTokens + e.completionTokens, 0);
        
        let report = `**Ledger (${args.period})**\n\n`;
        report += `- Total spent: $${(totalSpent / 100).toFixed(2)}\n`;
        report += `- Total tokens: ${totalTokens.toLocaleString()}\n`;
        report += `- Transactions: ${transactions.length}\n`;
        report += `- Usage events: ${usage.length}\n`;
        report += `- Open invoices: ${invoices.filter(i => i.status === "open").length}\n`;
        
        return { ok: true, output: report };
      },
    },
  ];
}
```

**Wire into runner:**
- Add to Finance role (when `department === "finance"`)

**Instructions for Finance Analyst:**
```markdown
## Reporting spend
1. Query the ledger: finance.ledger({period: "last_30_days"})
2. Summarize in FINANCE-report-{month}.md:
   - Total spend
   - Top 3 spending categories (model usage, ads, etc.)
   - Recommendations (if spend is high, flag it)
3. Report to your manager
```

**Estimated effort:** 1 day

---

### 2.3 Verify Visual Designer already has `design.poster`

No new code needed — just verify the tool is wired for `design` department in `runner.ts`.

**Instructions for Visual Designer:**
```markdown
## Creating visuals
Use design.poster to create simple SVG posters:
design.poster({
  title: "New Feature Launch",
  subtitle: "Ship faster with AI",
  colors: ["#1a73e8", "#ffffff", "#fbbc04"]
})

The poster is saved to the Library. Attach it to social posts.
```

---

### Phase 2 roles checklist

| # | Role | New tool | Instructions | Mock verified | Enabled |
|---|---|---|---|---|---|
| 12 | Head of Sales | `crm.log_activity` | ⬜ | ⬜ | ⬜ |
| 13 | Sales Rep | (reuse) | ⬜ | ⬜ | ⬜ |
| 14 | Customer Success Manager | (reuse) | ⬜ | ⬜ | ⬜ |
| 15 | Finance Analyst | `finance.ledger` | ⬜ | ⬜ | ⬜ |
| 16 | Visual Designer | (verify existing) | ⬜ | ⬜ | ⬜ |

**Estimated effort:** 5 days (2 new tools + 5 roles' instructions + verification)

---

## Phase 3: Roles needing external connectors (owned setup)

**Timeline:** Week 5 (5 days)  
**Roles:** Head of Marketing, Social Media Manager, Support Agent

**Why these next:** They need Postiz/Telegram/email credentials, but **you control the accounts** (no third-party approval process). Setup is one-time per deployment.

---

### 3.1 Document connector setup

Create setup guides (these already started in Phase 0.2, now complete them):

**`docs/setup-telegram-channel.md`:**
```markdown
# Setting Up Telegram for Social Publishing

1. Create a Telegram channel (public or private)
2. Create a bot via @BotFather: `/newbot` → get `TELEGRAM_BOT_TOKEN`
3. Add the bot as an admin to your channel
4. Get the channel ID:
   - Send a message to the channel
   - Visit `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Find `"chat":{"id":-1001234567890}` → that's your channel ID
5. Set environment variables:
   - `TELEGRAM_BOT_TOKEN=...`
   - `TELEGRAM_CHANNEL_ID=-1001234567890`
6. Restart the cloud service
7. Marketing/Social roles now have `social.publish` pointing to Telegram
```

**`docs/setup-postiz.md`:**
```markdown
# Setting Up Postiz for Multi-Platform Publishing

Postiz is a social media aggregator (like Buffer/Hootsuite) that connects to Meta/LinkedIn/X/IG.

## Option A: Postiz Cloud (easiest)
1. Sign up at postiz.com
2. Connect your social accounts (Meta Page, LinkedIn Page, X)
3. Get your API key from Settings → API
4. Get the integration ID for each platform (Settings → Integrations)
5. Set environment variables:
   - `POSTIZ_API_KEY=...`
   - `POSTIZ_INTEGRATION_ID=...` (or per-platform: `POSTIZ_META_ID`, `POSTIZ_LINKEDIN_ID`)
6. Restart the cloud service

## Option B: Self-hosted Postiz
1. Deploy Postiz (Docker): [link to their docs]
2. Connect your social accounts
3. Use your instance URL as `POSTIZ_API_BASE`
4. Same API key + integration ID setup

## Verification
Create a test company, hire Marketing Manager, delegate "Post about X", approve the `social.publish` call → post appears on your connected platform.
```

---

### 3.2 Instructions for Marketing/Social roles

**Head of Marketing:**
```markdown
# Head of Marketing — Instructions

You plan campaigns, review analytics, and delegate content/ads/social work.

## Your workflow
1. Review department board (company.review_department)
2. Check social insights (social.read_insights)
3. Delegate content drafting to Content Manager or Social Media Manager
4. Approve posts before they publish (you don't publish directly unless urgent)
5. Report progress to the CEO

## Example: "Launch a campaign for our new feature"
1. Delegate to Content Manager: "Draft a blog post about feature X"
2. Delegate to Social Manager: "Create 3 social posts about feature X"
3. Review drafts when they report back
4. Approve publishing via company.delegate (or publish yourself if urgent)
5. Check insights after 48h (social.read_insights)
6. Report: "Campaign live; blog + 3 posts published; 500 impressions so far"

## Quality bar
- Every campaign has a clear goal (signups, awareness, etc.)
- You delegate execution; you own the outcome
- Track metrics (impressions, clicks, conversions)
```

**Social Media Manager:**
```markdown
# Social Media Manager — Instructions

You draft and publish social posts, reply to comments, and track engagement.

## Your workflow
1. Check insights (social.read_insights)
2. Draft posts in the Library (SOCIAL-{topic}.md) — 2–3 variants per platform
3. Publish via social.publish (needs approval)
4. Reply to comments via social.reply (needs approval)
5. Report engagement metrics to your manager

## Platform rules
- **X/Twitter:** 280 chars max, 2–5 hashtags, casual tone
- **LinkedIn:** 150–200 words, professional, storytelling hook
- **Instagram:** 100–150 words, 10–15 hashtags, visual-first
- **Telegram:** 200–500 words, conversational, link to full post

## Example: "Post about our new pricing"
1. Research the pricing (read BRIEF/SPEC or ask Product)
2. Draft SOCIAL-pricing.md:
   - X: "New pricing live! Pro at $10/mo, Business at $50/mo. What we built: [3 bullet points]. Try it: [link]"
   - LinkedIn: "We're excited to announce transparent pricing for [product]. Here's why we chose this model: [2 paragraphs]. [CTA]"
   - Telegram: "Pricing update: [full details + FAQ]. Questions? Reply here."
3. Publish one at a time: social.publish({text: "...", platform: "x"})
4. Wait for approval → post goes live
5. Check replies the next day (social.read_insights), respond if needed
6. Report: "3 posts live; 50 likes, 5 comments, 2 questions answered"

## Quality bar
- Every post has a hook (question, stat, story)
- Tone matches the brand (check BRIEF.md)
- No jargon; explain benefits, not features
- Hashtags are relevant (no spam)
```

**Support Agent:**
```markdown
# Support Agent — Instructions

You handle customer questions and issues via social replies and email.

## Your workflow
1. Check for new questions (social.read_insights for social, or manual check for email — no inbox tool yet)
2. Draft a helpful reply (research the answer if needed: browser, BRIEF, SPEC)
3. Reply via social.reply or email.send (needs approval)
4. Log the interaction if significant (optional: crm.log_activity)
5. Escalate if you're blocked (company.escalate)

## Example: "Customer asks 'Does it work on mobile?'"
1. Research: check BRIEF.md or ask Product
2. Draft reply: "Yes! We support iOS and Android. Download the app: [link]. Let me know if you need help setting it up."
3. Reply via social.reply or email.send
4. Wait for approval → reply sent
5. Report: "Answered 5 questions today; 1 escalated (billing issue)"

## Quality bar
- Every reply is helpful (not defensive)
- Tone is friendly, not robotic
- Escalate edge cases (refunds, bugs, account issues)
- Log recurring questions (they become FAQ items)
```

---

### 3.3 Wire connectors into runner

Already done in Phase 0.2, but verify:
- Marketing/Social bots get `createSocialTools(postizClient)` or `createSocialTools(telegramClient)`
- Support bots get `createEmailTools(resendSender)`

---

### 3.4 End-to-end verification

**Test case: Marketing Manager publishes to Telegram**
1. Create a company "Acme Marketing"
2. Hire Marketing Manager
3. Set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHANNEL_ID` in env
4. Restart cloud
5. Delegate: "Post about our service on social media"
6. Marketing Manager's run:
   - Calls `social.read_insights` (reads Telegram channel)
   - Calls `library.write` (drafts SOCIAL-acme-service.md)
   - Calls `social.publish({text: "...", platform: "telegram"})`
7. Approval appears in "Needs you"
8. Approve → post appears in Telegram channel
9. ✅ Pass

---

### Phase 3 roles checklist

| # | Role | Connector | Setup doc | Instructions | E2E verified | Enabled |
|---|---|---|---|---|---|---|
| 17 | Head of Marketing | Postiz/Telegram | ⬜ | ⬜ | ⬜ | ⬜ |
| 18 | Social Media Manager | (reuse) | ⬜ | ⬜ | ⬜ | ⬜ |
| 19 | Support Agent | Email + social.reply | ⬜ | ⬜ | ⬜ | ⬜ |

**Estimated effort:** 5 days (setup docs + instructions + 3 E2E tests)

---

## Phase 4: Roles needing GitHub/deploy (high-risk, careful)

**Timeline:** Week 6+ (10+ days)  
**Roles:** CTO, Backend/Frontend/AI Engineer, DevOps, QA Engineer

**Why last:** These touch production code/infrastructure. High-risk. Need:
- GitHub/GitLab API integration
- Deployment webhooks
- Mandatory approval + budget caps
- Trust ladder must be "trusted" (10+ successes) before auto-approval

**Not included in this 6-week plan.** Defer until Phases 0–3 are proven in production.

**Sketch only (for future):**

### 4.1 New tools: `repo.commit`, `repo.pr`

**Depends on:**
- GitHub App or Personal Access Token with repo write access
- Git binary in the sandbox (or a GitHub API-only approach)

**Tool definition:**
```ts
{
  name: "repo.commit",
  description: "Commit code changes to a new branch.",
  parameters: {
    branch: string,
    message: string,
    files: { path: string; content: string }[]
  },
  requiresApproval: true, // always
  run: async (args) => {
    // 1. Clone repo (or use GitHub API)
    // 2. Create branch
    // 3. Write files
    // 4. Commit
    // 5. Push
    // 6. Return branch URL
  }
}
```

### 4.2 New tool: `deploy.trigger`

**Depends on:**
- Deployment webhook (Vercel/Netlify/Railway/custom CD)
- Staging environment (never deploy to prod without human review)

**Tool definition:**
```ts
{
  name: "deploy.trigger",
  description: "Trigger a deployment to staging. NEVER use for production.",
  parameters: { environment: "staging" },
  requiresApproval: true,
  run: async (args) => {
    // Call webhook
    // Return deploy URL
  }
}
```

---

## Measurement & success criteria

After Phase 0 + Phases 1–3 (6 weeks), a default company should:

**Day 1 (creation):**
- CEO, Head of Product, Business Analyst, Marketing Manager, Social Media Manager, Sales Rep hired
- Tools wired, instructions loaded, schedules set
- "Needs you" inbox empty (no blockers yet)

**Day 2 (first scheduled runs):**
- CEO runs daily standup → writes STANDUP-{date}.md, proposes first quest
- Marketing Manager drafts a social post → SOCIAL-intro.md in wiki, calls `social.publish` → approval appears
- Business Analyst researches competitors → REQUIREMENTS-competitors.md in wiki

**Day 3 (human approves):**
- CEO approves Marketing's post → post appears in Telegram
- CEO approves the proposed quest → quest becomes active
- Head of Product reviews department board, delegates "Write spec for feature X" to Business Analyst

**Day 7 (one week in):**
- 5+ posts published (Telegram/Feed)
- 3+ email outreach sent (Sales Rep)
- 10+ wiki files (BRIEF, OKRS, BACKLOG, PLAN, DECISIONS, standups, specs, requirements, drafts)
- "Needs you" shows 2–3 pending approvals (normal flow)
- No critical bugs, no blocked bots

**Metrics to track:**
- **Autonomy level adoption:** % of companies activated to "supervised" or "autonomous"
- **Hands utilization:** % of Marketing/Sales bots that successfully publish/email at least once
- **Approval flow:** median time from approval request → human decision
- **Cost per outcome:** $ spent per post published, per email sent, per spec written
- **Trust ladder movement:** how many bots promoted from "gated" → "probation" → "trusted"

---

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Phase 0 takes longer than 2 weeks (scope creep) | Delays role work | Timebox each item to 2–3 days; cut scope if blocked (e.g., skip manager pull loop if complex) |
| Real model cost for verification | $50–$100 for 20 roles × 2 tasks | Use mock provider for 80% of tests; only use real model for final acceptance |
| Instructions are too vague (bots don't follow them) | Low output quality | Test with GPT-4o-mini first (better instruction-following than DeepSeek); iterate on prompts |
| Telegram/Postiz credentials not set up | Phase 3 blocked | Document setup in Phase 0.2; owner sets up credentials before Week 5 |
| Authorization refactor breaks existing companies | Production regression | Add feature flag (`BOTIFYR_NEW_AUTH=1`); run both code paths in parallel for 1 week; verify metrics match |
| "Needs you" inbox overwhelms the CEO | Too many approvals | Add auto-approve for low-risk tools (read-only) once trust = "trusted"; keep publishing gated |

---

## Alternatives considered & rejected

**Alternative 1: Build all tools first, then add roles**  
❌ Rejected: bottleneck at tool development; roles sit idle

**Alternative 2: External connectors (Meta/LinkedIn) first**  
❌ Rejected: external approval delays block progress; owned channels (Telegram/email) deliver faster

**Alternative 3: Skip instructions, rely on catalog JD only**  
❌ Rejected: catalog JD is high-level; bots need concrete workflow examples to execute consistently

**Alternative 4: Build engineering roles (GitHub/deploy) in Phase 1**  
❌ Rejected: too risky without proven trust ladder; defer until Phases 0–3 are stable

---

## Open questions (need owner decision)

1. **Should Phase 0.2 support multiple Telegram channels per company** (one for Marketing, one for Support), or just one shared channel?  
   Recommendation: one shared channel for v1; multi-channel in v2.

2. **Should `company.decide` be approval-gated** (consequential) or approval-free (informational)?  
   Recommendation: approval-free (it's append-only, informational, low-risk).

3. **Should Finance Analyst have read-only access to all users' ledgers** (admin-like), or only the company's aggregated spend?  
   Recommendation: company-aggregated only (no PII leakage).

4. **Should we build a "content calendar" tool in Phase 3** (schedules posts for future dates), or keep it manual (delegate + `scheduledAt`)?  
   Recommendation: manual for v1 (via `feed.post({scheduledAt})`); tool in v2 if demand exists.

5. **Should QA Engineer be Phase 1 or Phase 4?** (It needs browser use, which exists, but also repo access for filing issues.)  
   Recommendation: Phase 1 (browser-only testing, no repo write); file issues manually or via a simple `qa.report` tool.

---

## Next steps (awaiting approval)

1. **Owner reviews this plan** → approves/modifies scope
2. **Assign Phase 0 work** → 1 engineer, 2 weeks
3. **Create a branch** (`feature/virtual-workspace-foundation`) per AGENTS.md worktree rules
4. **Daily standup** → track progress against the 5 Phase 0 items
5. **Gate Phase 1** → no role work until Phase 0 ships + is verified
6. **Repeat** for Phases 1–3

**First commit target:** Phase 0.1 (fix authorization) + 0.2 (Telegram wiring) + verification script → ~5 days.

---

## Appendix: Role catalog summary (reference)

| # | Role | Department | Level | Tools needed | Phase |
|---|---|---|---|---|---|
| 1 | CEO | exec | exec | research, files, company.* | 1 |
| 2 | Head of Product | product | head | research, files, delegation | 1 |
| 3 | Business Analyst | product | ic | research, files | 1 |
| 4 | Product Researcher | product | ic | research, files | 1 |
| 5 | CTO | engineering | head | code, files, repo (later) | 4 |
| 6 | Backend Engineer | engineering | ic | code, files, repo (later) | 4 |
| 7 | Frontend Engineer | engineering | ic | code, files, repo (later) | 4 |
| 8 | AI Engineer | ai | ic | code, files, repo (later) | 4 |
| 9 | DevOps | ops | ic | code, files, deploy (later) | 4 |
| 10 | QA Engineer | engineering | ic | browser, code, files | 1 |
| 11 | UX Designer | design | ic | browser, files | 1 (future) |
| 12 | Visual Designer | design | ic | files, design.poster | 2 |
| 13 | Data Analyst | data | ic | research, code, files | 1 |
| 14 | Head of Marketing | marketing | head | research, files, social, email | 3 |
| 15 | Content Manager | marketing | ic | research, files | 1 |
| 16 | Social Media Manager | marketing | ic | research, files, social | 3 |
| 17 | SEO Specialist | marketing | ic | research, files | 1 |
| 18 | Head of Sales | sales | head | research, files, email, crm | 2 |
| 19 | Sales Rep | sales | ic | research, files, email, crm | 2 |
| 20 | Lead Researcher | sales | ic | research, files | 1 |
| 21 | Support Agent | support | ic | files, social.reply, email | 3 |
| 22 | Customer Success Manager | success | ic | files, email, crm | 2 |
| 23 | Head of Operations | ops | head | files | 1 |
| 24 | Finance Analyst | finance | ic | files, finance.ledger | 2 |
| 25 | Compliance Officer | legal | ic | research, files | 1 |
| 26 | Recruiter | people | ic | files | 1 |
| 27 | Logistics Coordinator | logistics | ic | research, files | 1 (future) |

**Total:** 27 roles  
**Phase 1:** 11 roles (work today, instructions only)  
**Phase 2:** 5 roles (small new tools)  
**Phase 3:** 3 roles (external connectors)  
**Phase 4:** 5 roles (high-risk, defer)  
**Future:** 3 roles (UX Designer, Logistics, others)

---

**End of plan. Ready for review.**
