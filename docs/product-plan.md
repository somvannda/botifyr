# Botifyr — Product Plan (control-layer turn)

> Status: **adopted — Phase A shipped; Phase B in progress.** Owner: product/eng.
> Phase A (Briefing landing, ranked Inbox, outcomes, agent `company.report`) and
> Phase B's core (per-capability trust ladder: types, agent-core gate hook,
> runner wiring, grants `state` + Postgres persistence) are live. Remaining:
> recording uses, the promotion review, and the UI. This is the plan that turns
> the company-quests work ([`company-quests.md`](company-quests.md)) and the
> competitive read ([`ai-company-platforms.md`](ai-company-platforms.md)) into a
> **positioning, a UX direction, and a sequenced build order.** It reuses the
> existing product — it does not rebuild it.

## 1. The turn (one paragraph)

Position Botifyr as **the AI company you actually control** — broad *real work*,
gated until proven, with a **decision inbox instead of a board**. Not "most
autonomous" (Polsia) or "most features" (AGEMS): the product is the **control
layer** that lets you earn autonomy across a broad capability set. The thing
that unlocks *both* autonomy and breadth is a trustworthy control layer — and
that is the category's clearest unmet need and Botifyr's natural strength.

## 2. Principles (non-negotiable)

1. **Human-approved first.** Anything consequential (send / publish / spend /
   deploy / delete) is gated until explicitly trusted.
2. **Autonomy is earned per capability, not declared per product.** The unit is
   the *action*, not the company.
3. **Provenance everywhere.** Every agent action shows what it used (tools,
   sources, cost, who approved). Trust through transparency.
4. **One UI, two hosts.** Everything in `packages/ui`; hosts stay thin
   (`AGENTS.md` §7).
5. **Never guess.** Unknown metrics show **unknown**; empty states say so.

## 3. The autonomy ladder (the core mechanic)

Today autonomy is coarse: `Quest.trust` (`manual|supervised|autonomous`) and
`Bot.autoApprove`. Make it **per-capability**, with a record:

```
capability: email.send
  state:      gated | probation | trusted
  successes:  12        (recent window)
  failures:   0
  lastUsed:   …
  grantedBy:  role:Head of Sales   (capability_grants)
```

- **gated** — every use needs an approval (today's default for consequential).
- **probation** — auto-allowed, but every use is surfaced in the briefing.
- **trusted** — auto-allowed, sampled/audited.

Rules:
- Promotion `gated → probation → trusted` requires **N successful uses** and a
  one-click CEO confirmation (a "promotion review" in the inbox).
- Any failure **demotes** the capability one step and files an incident.
- A **company/quest ceiling** (`manual|supervised|autonomous`) caps the ladder:
  `manual` forces everything to `gated`; `autonomous` allows elevated caps.
- Budgets are the hard bound: `Workspace.budget…` + `Quest.budgetTokens`.

This turns "most autonomous" into a **trajectory** the CEO watches, not a boast.

## 4. What changes in the existing product

### Keep (do not rebuild)
The agent engine, group orchestration, tools (media/browser/computer/code),
connections, billing/wallet, `AuditEvent`, the one-UI architecture, and the
Company OS entities (`Workspace`, `BotRole`/DNA, catalog, `Quest`, `WorkItem`,
`WorkspaceBudget`, `CapabilityGrant`).

### Change
1. **HQ landing = Briefing, not Board.** The default HQ view becomes:
   current quest + progress, **"since you were last here"** delta (items done,
   artifacts produced, approvals resolved, spend), and a **ranked Needs you**.
   `Board` is demoted to a tab.
2. **Decision inbox as the spine.** Approvals + blockers + proposed quests +
   promotion reviews + budget warnings, ranked, one-click. (`hqNeeds` +
   `hqPendingQuests` already exist — extend to a single ranked inbox.)
3. **Outcomes, not tasks.** `WorkItem` gains a `result` (artifact / file / PR /
   report); the briefing shows **what shipped**, not just done/total.
4. **Per-capability trust** replaces the boolean gate as the primary control
   (§3), surfaced on the employee card and in the briefing.
5. **The "one question" CEO input.** A single input — *"What should change?"* —
   routes to the chair and returns a **plan/diff for approval** (reuses
   `company.propose` + approvals).

### Cut / defer (don't spend here)
- More company *theater* (the 3D office stays, but gets no further investment).
- New model-dependent features until model access is restored (see §8).
- New connectors before the ladder works.

## 5. UX / UI, concretely (`packages/ui/src/BotifyrApp.tsx`)

- **Sidebar:** keep bots + companies; add a top-level **Inbox** entry with a
  "needs you" count (the single badge that matters).
- **HQ tabs, reordered:** `Briefing · Inbox · Team · Quests · Board · Office ·
  Wiki · Budget · Settings`. Landing = **Briefing**.
- **Briefing panel (new):** quest card (objective, progress, trust ceiling,
  budget, "what moved"), a delta list, and the ranked inbox below it.
- **Employee card:** role, **capability trust badges**, current work, recent
  outcomes.
- **Approval card:** already inline in AGEMS-style; adopt the same pattern
  (what / why / cost / tool) with **Allow once · Always for this role · Deny**.
- **Empty states** never guess; show the file/briefing the agent will produce.

## 6. Map existing tools to the ladder (first pass)

| Capability | Today | Ladder target |
| --- | --- | --- |
| `research.web`, `files.read` | safe | **trusted** (no gate) |
| media/search/download (deterministic) | safe | **trusted** |
| `files.write` (wiki) | safe | **trusted** |
| `email.send` | gated | **gated → probation** after drafts prove out |
| `social.publish` / `social.reply` | gated | **gated → probation** |
| `ads.manage` | gated + budget | **gated** (money; slow to promote) |
| `payments.charge` | gated | **gated** (money) |
| `repo.write` / `deploy.production` | gated | **gated → probation** |
| `code.run` / `browser.use` | sandbox | **probation** (sandboxed) |

## 7. Sequencing

### Phase A — the CEO experience (deterministic; no model needed)
Ship the **Briefing landing** + **single ranked inbox** + **outcomes on work
items** + **provenance**. All computed from existing quests/tasks/approvals/
usage; verify with the mock provider. *This directly fixes "it feels like
watching a board."*

### Phase B — the autonomy ladder (code, model-light)
Add per-capability trust state + success/failure counters + **promotion
reviews**; wire the runner to consult the ladder instead of a boolean. Tests
with `MemoryStore`.

### Phase C — the running company (needs model access)
Chair **auto-decomposes + assigns** an active quest; scheduled standups;
the **"one question"** loop. Requires a funded provider (see §8).

### Phase D — real-hands promotion
Turn the ladder loose on the real tools (email, social, ads, code/deploy) as
each proves out, with budgets as the hard bound.

## 8. Constraints & risks (be honest)

- **Model access is the gate for Phase C.** As of 2026-10-08 the DeepSeek
  account returns **402 Insufficient Balance**; the flow currently runs on the
  deterministic fallback. Phases A–B do not need the model; plan accordingly.
- **Verification is tests-only so far.** Every phase should end with a short
  realistic run, not just `vitest`.
- **Small team → sequence, don't parallelize.** A–B are one track; C–D follow.
- **Commoditization:** the org-chart visual is easy to copy; the moat is the
  ladder + provenance + real hands, not the chart.

## 9. Definition of done

- A CEO opens Botifyr and sees **what needs a decision and what moved** — not a
  board — within 10 seconds.
- **Zero** consequential actions run untrusted.
- Each capability shows its **trust state and record**; promotions are one click.
- Every quest has an objective, acceptance, budget, and visible outcomes.
- Cost per quest is visible before it's spent.

## 10. Metrics

- **Approvals resolved per session** (should rise as the inbox improves).
- **% consequential capabilities at `probation`+** (the autonomy trajectory).
- **Untrusted consequential actions = 0** (hard safety metric).
- **Time-to-first-decision** after opening the app.
- **Cost per quest** vs. the quest budget.

## 11. Open questions

- **Storage:** **decided — extend `capability_grants`.** Add `state`
  (`gated|probation|trusted`), `successes`, `failures`, `lastUsedAt` to
  `CapabilityGrant` (`packages/shared/src/index.ts`). It's already JSONB in both
  stores, so no migration.
- **Promotion thresholds:** **decided — 5 successful uses for low-risk
  capabilities, 10 for `money`.** A single failure demotes one step and files an
  incident (reuses `AuditEvent`).
- **Ceiling:** **decided — the workspace/quest autonomy is a ceiling.** A
  `manual` company forces every capability to `gated` regardless of its stored
  state; `autonomous` allows `trusted`.
- **Company metaphor:** **decided — keep it, but the Inbox/Briefing is the
  front door, not the org chart.**

### 11.1 The one engine change Phase B needs

The agent gate is currently boolean (`requiresApproval` + a run-level
`autoApprove` in `packages/agent-core/src/agent.ts`). Per-capability trust needs
a **per-tool decision**, so add an optional hook to `AgentOptions`:

```ts
/** Return true to auto-approve this tool call (trust ladder); default false. */
shouldAutoApprove?: (toolName: string, args: Record<string, unknown>) => boolean;
```

The gate becomes:

```ts
if (needsApproval && !options.autoApprove && !options.shouldAutoApprove?.(tool.name, call.arguments)) {
  // request approval
}
```

The runner supplies `shouldAutoApprove` from the ladder: `trusted` →
`true`; `probation` → `true` (and the use is recorded/surfaced); `gated` →
`false`. This keeps `agent-core` generic (it only asks a question) and puts the
policy in `apps/cloud` where the grants live. **This is the only change to
`agent-core`; everything else is cloud-side.**

