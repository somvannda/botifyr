# Botifyr — Launch Plan (Bot + Virtual Workspace)

> Status: **proposal — awaiting owner approval.** Owner: product/eng.
> Two launch products, one engine. This is the working feature list to **tackle
> one item at a time**. It complements [`launch-cut.md`](launch-cut.md) (what we
> ship vs. defer) and [`virtual-workspace-implementation-plan.md`](virtual-workspace-implementation-plan.md)
> (the Phase-0/role work). Nothing here rebuilds what exists.

Status legend: **✅ shipped** · **🟡 partial** · **⬜ new**

## How to use this doc

- Pick **one row**, move it `⬜ → 🟡 → ✅`, and keep the change surgical
  (`AGENTS.md` §3). Don't start a second row in the same file.
- Ship the **wedge** first (see §3). Everything else is polish until one
  end-to-end job runs on a **real model** and produces a finished artifact.
- **Blocker B0/ W0 applies to both:** the DeepSeek key is out of credit (402).
  Fund a provider before any model-backed row is verifiable.

---

## 1. Bot — the agent (24 features)

| # | Feature | Status | Why it matters for launch | Where |
| --- | --- | --- | --- | --- |
| B1 | Browser use (goto · extract · type · click · screenshot · sniff) | ✅ | The core "hands"; most tasks start here | `agent-core/src/tools/browser.ts` |
| B2 | Desktop computer use + live remote-desktop modal | ✅ | Apps with no API; the showcase capability | `tools/computer.ts`, `/v1/sessions/:id/computer` |
| B3 | Teach-by-demonstration (record → learn task → replay) | ✅ | A differentiator: the bot learns what you show it | `/computer/{trace,learn,replay,record}` |
| B4 | Code/shell sandbox (tree · search · read · apply · test) | ✅ | "Glue" work, data tasks, real engineering tasks | `code-tools.ts` |
| B5 | Media download: YouTube + **browser sniff** (HLS master, no per-site code) | ✅ | The wedge's front door — works on short-drama sites | `agent-core/src/tools/media.ts`, `media.sniff` |
| B6 | Media search / info / batch + subtitle tracks | ✅ | Discovery + captions for translation | `youtube.search`, `youtube.info` |
| B7 | Transcription (Whisper) | ✅ | Captions/notes; feeds the translation pipeline | `/v1/transcribe` |
| B8 | Video translation — subtitles | 🟡 | Clear, demoable outcome for content teams | `/v1/translate` |
| B9 | Video **dub + lip-sync** (role-based model router, GPU worker) | ⬜ | The headline wedge deliverable | [`video-translation.md`](video-translation.md) P0–P4 |
| B10 | Publishing to owned channels (Telegram, email, social) | 🟡 | Turns "made a thing" into "shipped a thing" | `social-tools.ts`, `email-tools.ts`, `social-telegram.ts` |
| B11 | Declarative skills (built-in packs) | ✅ | Capability without training | `/v1/skills` |
| B12 | Learned skills (self-learning recipe) | ✅ | The bot gets better; reuse next time | `/v1/learned-skills`, `media.learn_recipe` |
| B13 | Messaging channels (Telegram + local API) | ✅ | Reach the bot where you already are | `packages/channels` |
| B14 | Connections (Google · GitHub · Slack · Notion · Telegram) | 🟡 | Structured tools beat clicking | `/v1/connections`, `connections-tools.ts` |
| B15 | Approval gates + audit trail (per action) | ✅ | Safety is the moat — keep it visible | `approvals.ts`, `audit_events` |
| B16 | Cost controls (daily cap · per-task token cap · rate limit · cache) | ✅ | Price predictably; protect margin | `BOTIFYR_*` ([`cost-controls.md`](cost-controls.md)) |
| B17 | Scheduling & triggers (cron · webhook · heartbeat) | 🟡 | "Work while you're away" — pro-plan value | `/v1/workspaces/:id/triggers` |
| B18 | Memory — working context + summarisation | ✅ | Keeps long chats coherent under token caps | `maxHistoryTurns`, `summarizeEnabled` |
| B19 | Memory — long-term / episodic / vector | ⬜ | "Do it like last time"; real assistant feel | new store + pgvector |
| B20 | Group bots (parallel · autonomous · handoff) | ✅ | Multi-step jobs without babysitting | `agent-core`, groups |
| B21 | Files workspace + artifacts + downloads library | ✅ | Where results land; player + Save/Send | `files-tools.ts`, Library UI |
| B22 | Local node (run browser/shell on your machine) | ✅ | Privacy + real local files | `apps/node`, `/v1/node` |
| B23 | Notifications (in-app + OS) | ✅ | "Come back when it's done" | `notifications` |
| B24 | Model router — per-task model + BYO key | 🟡 | Cost/quality control; no lock-in | `BOTIFYR_PROVIDER/MODEL` |

### Bot backlog (nice-to-have, after launch)
- B25 Prompt-injection defense / Sentinel reviewer — ⬜ (untrusted web content).
- B26 MCP connectors — ⬜.
- B27 Mobile use (Android/ADB) — ⬜.
- B28 Voice realtime in/out — ⬜.

---

## 2. Virtual Workspace — the AI company (24 features)

| # | Feature | Status | Why it matters for launch | Where |
| --- | --- | --- | --- | --- |
| W1 | Workspace + roles (23 roles / 13 departments, real catalog) | ✅ | The org is the product's frame | `catalog.ts`, `workspaces` |
| W2 | Onboarding planner (from a website or an idea) | ✅ | Zero-to-company in one step | `/v1/workspaces/plan` |
| W3 | **Role-driven authorization** (capabilities from catalog; grants add/remove) | ✅ | Security: who can do what is enforced | `capability-tools.ts` (0.1) |
| W4 | Capability grants + **trust ladder** (gated → probation → trusted) | ✅ | "Autonomy earned per action" — the moat | `capability-ladder.ts` |
| W5 | Directed quests (Charter → Directions → Assemble → Quest → Operate) | ✅ | A clear, bounded objective per cycle | `/v1/workspaces/:id/quests` (Q0–Q5) |
| W6 | **Decision inbox** — ranked, unified "Needs you" | ✅ | The strongest unmet need in the category | `inbox.ts`, `/v1/workspaces/:id/inbox` (0.3) |
| W7 | Briefing landing ("since you were last here") | ✅ | Answers "what moved?" in 10 seconds | `product-plan.md` Phase A |
| W8 | Outcomes on work items (artifact/file/PR/report) | ✅ | Shows what **shipped**, not done/total | `WorkItem.result` |
| W9 | Scheduled runs (ticker, level-aware prompts) | ✅ | The company works while you're away | `server.ts` scheduler, `schedule-prompts.ts` |
| W10 | Manager pull loop (delegate + review department) | ✅ | Managers actually manage | `company.delegate`, `company.review_department` (0.4) |
| W11 | Escalation to the chair | ✅ | ICs can raise blockers | `company.escalate` |
| W12 | Budgets (workspace + per-quest; hard stop) | ✅ | Cost is bounded before it's spent | `workspace_budget`, `Quest.budgetTokens` |
| W13 | Shared wiki + task board | ✅ | Where the company thinks and tracks work | `/v1/workspaces/:id/wiki`, `/work` |
| W14 | Decision log (DECISIONS.md) | ✅ | Companies remember *why* | `company.decide` (0.5) |
| W15 | Owned channels wired (Telegram · email) | ✅ | A default company can actually ship | `company-seed.ts` (0.2) |
| W16 | Standups + reports | ✅ | Rhythmic, reviewable progress | `/standup`, `company.report` |
| W17 | Quest proposals (agents propose, CEO disposes) | ✅ | Keeps the human in charge | `company.propose` |
| W18 | Role playbooks (instructions per role) | 🟡 | Roles produce good work, not generic text | `role-instructions.ts` (Phase 1: 11 roles) |
| W19 | CRM tool (`crm.log_activity`) | ✅ | Sales roles have a memory of interactions | `crm-tools.ts` (Phase 2) |
| W20 | Finance ledger (`finance.ledger`) | ✅ | Honest spend reporting | `finance-tools.ts` (Phase 2) |
| W21 | Design poster (`design.poster`) | ✅ | On-brand visuals without a designer | `design-tools.ts` (Phase 2) |
| W22 | Engineering hands (`code.pr`, Phase-4 repo/deploy) | 🟡 | Engineering roles can ship code | `code.pr` exists; `repo.commit`/`deploy.trigger` ⬜ |
| W23 | Ads (insights + manage) | 🟡 | Growth roles; needs Meta creds | `ads-tools.ts`, `ads-meta.ts` |
| W24 | Social publishing via Postiz (FB/IG/LinkedIn/X) | 🟡 | The channels teams already use | `social-tools.ts` (Phase 3) |

### Workspace backlog (after launch)
- W25 Per-role authorization **fully** enforced everywhere — 🟡 (finish coverage).
- W26 Chair instructed to log a decision on every pivot — ⬜ (small).
- W27 CEO "one question" input → plan/diff for approval — 🟡.
- W28 Market & competitor research inside planning — ⬜.
- W29 Content calendar (schedule future posts) — ⬜ (open question).
- W30 Multiple channels per company (Marketing vs Support) — ⬜ (open question).
- W31 Promotion-review UX polish (one-click promote) — 🟡.

---

## 3. Recommended launch slice (what actually ships)

The full lists are the backlog; **this** is the minimum that delivers a clear,
demoable product on each side.

**Bot — one flagship job:** *media → translate/dub → publish.*
B5 + B6 + B7 + B8/B9 + B10, wrapped by B1/B2 (hands) and B15/B16 (safety/cost).
Demo: paste a video link → the bot downloads it, translates/dubs it, and
publishes to Telegram — paused for your approval, with cost shown.

**Virtual Workspace — one complete cycle:** *create → one quest → outcomes →
publish.*
W2 + W5 + W6/W7 + W8 + W9/W10 + W12 + W15.
Demo: point at a site → it proposes a direction → you pick one quest → employees
delegate, work, and report → one approval ships a post/email → the Inbox shows
what moved and what it cost.

---

## 4. Suggested tackle order

**P0 — unblock (do first, both products)**
1. **Fund the model provider** (DeepSeek 402). Nothing verifiable until this.
2. **One realistic end-to-end run** of the wedge on the real model — not `vitest`.
3. W18 role playbooks: finish Phase 1 roles (11) so quests produce good output.

**P1 — the wedge (Bot)**
4. B8 subtitles → B9 dub/lip-sync (P0 provider registry → P1 GPU worker → P2 subs
   → P3 dub → P4 lip-sync, per [`video-translation.md`](video-translation.md)).
5. B10 confirm publish per channel; B17 scheduling for "away" work.

**P2 — the company (Workspace)**
6. W25 finish auth coverage; W26 decision-log wiring; W24 social connector.
7. W23 ads credentials; W22 engineering hands (repo/deploy, Phase 4).

**P3 — depth (after launch)**
8. B19 long-term memory; B24 model router; B25 prompt-injection defense.

---

## 5. Definition of done (launch)

- **Bot:** one job runs end-to-end on a real model, produces a finished artifact,
  publishes to a channel after approval, and shows its cost — with a full audit
  trail and zero untrusted consequential actions.
- **Workspace:** a new company can be created, run one quest to completion across
  several employees, and surface every decision in the Inbox — within budget.
- Both are reachable from the **one** product UI (`AGENTS.md` §7); the Feed stays
  off ([`launch-cut.md`](launch-cut.md)).
