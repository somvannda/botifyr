# Startup Workspace (shipped) — the founder's home

> Status: **shipped.** This is the UI that turns Botifyr's company engine into
> the experience the founder asked for: *"Tell us what you want to build. Your
> AI company figures out the plan, does the work, and brings you the decisions
> that matter."*
>
> Code: `packages/ui/src/CompanyWorkspace.tsx` (view), wired in
> `packages/ui/src/BotifyrApp.tsx`. Related: [`company-workspace.md`](company-workspace.md),
> [`company-quests.md`](company-quests.md), [`product-plan.md`](product-plan.md),
> [`ai-company-platforms.md`](ai-company-platforms.md).

## 1. Where it lives

The sidebar is **Chat · Feed · Startup Workspace**. Selecting **Startup
Workspace** (`activeWorkspaceFilter === "startups"`) renders `CompanyWorkspace`
in the main pane — a full-pane view, a sibling of `FeedView`, **not a modal**.
The chat side panels are hidden while it is open, so it uses the full width.

## 2. The loop

1. **Idea** — one inline input: *"What do you want to build?"* (+ optional
   website URL).
2. **AI rewrite** — **Refine with AI** (top-right of the description row) calls
   `POST /v1/workspaces/rewrite` with an optional *"What should the company
   optimise for?"* guidance, and drops a sharper brief back into the box.
3. **AI plan** — `POST /v1/workspaces/plan` returns the DNA, 2–3 direction
   cards, a rationale, an editable recommended team, and the first mission.
4. **Create** — `POST /v1/workspaces` creates the company; it is activated at
   **Delegated (supervised)** by default.
5. **Founder home** — mission + progress, **Today's priorities** (tagged *AI can
   execute* / *Founder decision*), **Needs you**, **"What would you like to
   do?"**, **"What the company is doing"** (live runs), and **"Since you were
   last here"**.

## 3. Sections

`Home · Inbox · Team · Board · Office · Budget · Standup · Changes · Wiki`.

- **Inbox** — the ranked decision queue: approvals, promotion reviews, proposed
  quests.
- **Team** — employees with per-capability trust chips (gated / probation /
  trusted).
- **Board** — work items with status.
- **Office** — opens the 3D office docked beside the pane (same data).
- **Budget / Standup / Changes / Wiki** — token cap, reports, staged diffs,
  company docs.

## 4. Autonomy

A selector in the topbar: **Assisted** (`manual`), **Delegated** (`supervised`,
the recommended default), and **Autonomous** (`autonomous`). Maps to
`WorkspaceAutonomy`; the engine gates consequential actions by the capability
ladder + budget.

## 5. Honesty

- **`GET /v1/workspaces/:id/activity`** exposes recent agent runs. Home shows a
  **"⚠ N run(s) failed"** card with the error (e.g. a provider 402) — the
  workspace never implies work happened when it didn't.
- Live refresh: a **Refresh** button plus a 20-second auto-refresh (paused while
  a mutation is in flight). Visit tracking is separate, so refresh does not wipe
  the "since you were last here" delta.

## 6. Removed

The legacy **create-company 3-step modal** and the **Company HQ overlay** (10
tabs) were deleted (~1.3k lines); the workspace supersedes them. Dead symbols
left behind were removed via an AST pass.

## 7. Tests

`packages/ui/src/companyWorkspace.dom.test.tsx` — onboarding, founder home,
autonomy levels, AI rewrite, honest failures. The full gate
(`typecheck && lint && test`) is green.

## 8. Remaining / optional

- Embed the 3D office **inside** the pane (currently docked beside it).
- Richer verification signals per work item ("result verified").
- Per-quest budget/trust controls in the workspace (present in the engine).
