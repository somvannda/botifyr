# AGENTS.md — working on Botifyr efficiently

Guidance for **AI coding agents** (and humans) editing this repo. The goal is to
keep development fast and cheap: **fewer tokens, fewer commands, fewer rebuilds**.

> This file is about the **development process**. It does **not** change the
> shipped product. Product runtime limits are separate — see
> [`docs/cost-controls.md`](docs/cost-controls.md).

## 1. Context discipline (the biggest saving)
- **Never re-read a file that is already in context.** Ask before re-reading.
- **Search before reading.** Use `grep`/`glob` to find the exact lines, then read
  only that range (`offset`/`limit`). Do not dump whole large files.
- Don't echo large outputs back into the conversation; rely on truncation and
  summarise in a line or two.
- Prefer **one targeted command** over several broad ones.

## 2. Commands
- Typecheck only what changed: `npm run typecheck -w @botifyr/<pkg>`.
- Run the full gate **once, at the end**: `npm run typecheck && npm run lint && npm test`.
- Docker: the cloud image **bakes the sources**, so a source change needs
  `docker compose up -d --build cloud`. Do **not** rebuild for frontend-only edits.
- Keep the dev server running and rely on HMR. Do **not** restart `tauri dev`
  for frontend-only changes.
- Avoid long foreground waits; use background commands and keep working.

## 3. Editing
- Make **surgical** edits (`edit`) instead of rewriting whole files.
- One concern at a time; batch related edits in a single step.
- After editing, verify with a targeted `grep`/HTTP fetch — don't re-print the file.

## 4. Verification that costs money
- `apps/cloud/scripts/verify-*.mjs` and any "send a message" test hit the **real
  model** and spend credit. Use them sparingly; prefer the **mock** provider or an
  HTTP check that doesn't call the model for logic-only changes.
- When you must call the model, ask a **short** prompt (e.g. "reply with ok").

## 5. Two separate cost concerns — do not conflate
| Concern | What it limits | Where |
| --- | --- | --- |
| **Product runtime** | End-user model spend when the app runs tasks | `apps/cloud`, `packages/agent-core` → [`docs/cost-controls.md`](docs/cost-controls.md) |
| **Development** | The coding agent's spend while editing this repo | `opencode.jsonc`, `~/.config/opencode/opencode.jsonc` → [`docs/dev-cost-controls.md`](docs/dev-cost-controls.md) |

Changing `BOTIFYR_*` limits changes the **product**, not the coding agent. Don't
add runtime-limit code to solve a development-cost problem, and vice-versa.

The development ledger has two halves, and they point at the same goal:
- **Config knobs** — model, reasoning variant, `compaction`, `agents.build.steps`,
  provider settings, off-peak pricing → [`docs/dev-cost-controls.md`](docs/dev-cost-controls.md).
- **Behaviour** — context, command, and verification discipline → §1–§4 and §6.

## 6. Development keys & model
- Use a **separate API key for development** than for the product, so each side's
  spend is visible independently (the product uses `BOTIFYR_API_KEY`; the coding
  agent has its own provider key).
- Prefer the **cheapest model** that can do the job — for both the product default
  and the coding agent.
- Keep prompts short; avoid sending large diffs or files when a summary will do.

## 7. One UI, two hosts — never fork the UI
The desktop app and the web portal must be **pixel-identical**. There is exactly
**one** interface: `BotifyrApp` in `packages/ui/src/BotifyrApp.tsx`, plus the
shared styles in `packages/ui/src/styles.css`.

Rules:
- **Never build a second UI.** Do not write platform-specific screens, styles or
  copies of components in `apps/desktop` or `apps/portal`.
- **Hosts stay thin.** `apps/desktop/src/App.tsx` = `BotifyrApp` + a Tauri
  `BotBridge`; `apps/portal/src/App.tsx` = `BotifyrApp` + `webBridge`. Nothing
  else. Put host differences behind `BotBridge` (`packages/ui/src/bridge.ts`) —
  e.g. `openExternal`, `focusWindow`, `startLocalNode`/`stopLocalNode`.
- **Host-specific values** (like the desktop's 34px title bar) are CSS variables
  set by the host (`--titlebar`), never hard-coded in the shared app.
- **Fix the UI once** in `packages/ui`; both platforms get it.
- `pnpm`/`npm` guard: `packages/ui/src/parity.test.ts` asserts both hosts still
  render `BotifyrApp` and stay thin. A new bespoke UI file in a host should be
  treated as a bug.

## 8. Multi-agent ownership & integration protocol
When more than one agent (or human) edits this repo, follow this protocol. It
complements §1–§3, it does not replace them.

**Before implementation**
- Inspect the relevant code, `git status`, and existing diffs first. Never assume a
  file is clean, and never assume a symbol exists — locate the actual types, exports
  and dependencies you rely on.
- State a short plan before editing: goal, files you intend to change, shared
  dependencies, and how you will verify it.
- Do not build on, overwrite or revert uncommitted changes you did not make.

**One owner per file**
- Each shared file has **one active editing owner at a time**. Before touching a
  file, check whether another workstream already owns or is editing it.
- If agents share one working directory, they must **not edit overlapping files
  concurrently** — sequence the work or split ownership.
- Prefer isolated **git worktrees** and branches for parallel work, and integrate
  through review rather than shared live edits.
- **Enforced, not just advisory.** `origin/main` is the only integration point,
  and the only way it moves is a PR with green CI and the integration owner's
  review. `.github/CODEOWNERS` names the owner of the hot shared files, and a
  repo-tracked `pre-push` hook blocks direct pushes to `main`. (Server-side branch
  protection requires GitHub Pro on a private repo — see
  [`docs/parallel-work.md`](docs/parallel-work.md).)

**Shared contracts**
- Verify a shared interface or export before importing it, and coordinate before
  changing a shared contract. Do not invent types or exports just to make code compile.

**Reporting & status**
- Every agent reports: files changed, commands run, results, dependencies, and
  unresolved blockers.
- Track each workstream through **PLANNED → IMPLEMENTED → TESTED → INTEGRATED →
  VERIFIED**; do not claim a stage you have not reached.
- Only the **integration owner** reviews the diff, merges changes, and re-runs the
  relevant checks after integration. Never claim a change is merged or verified
  unless it actually is.
- **Every finished job must be merged.** An agent's task is not complete while its
  work sits on an unmerged branch, worktree, or PR — close it out through the
  integration owner before stopping.

**When something breaks**
- On conflict or a failed import: preserve existing work, stop, find the root cause,
  and coordinate a compatible fix before continuing. Never revert, overwrite or
  stage another agent's changes. Never run destructive git commands (`reset --hard`,
  `clean -fd`, force-push) without approval.

**Verification commands** — use the scripts that actually exist; do not assume.
- Affected package: `npm run typecheck -w @botifyr/<pkg>`.
- Repo gate (once, at the end): `npm run typecheck && npm run lint && npm test`.
- Browser flows: `npm run test:e2e`.

## 9. Parallel work: branch + worktree per task
Use **one branch per task** so parallel agents never collide, and **one worktree
per task** when you need real directory isolation. The helper in
`scripts/worktree.mjs` (aliased as `npm run wt`) automates the local path. CI
(`.github/workflows/ci.yml`) runs typecheck + lint + test + the cloud image build
on every PR.

**Start**
- One task = one `<type>/<slug>` branch off **`origin/main`** (fetched first) — the
  single integration point. `wt new` and `wt sync` do the fetch for you.
- For directory isolation: `npm run wt -- new <slug>` (branch `agent/<slug>` in a
  sibling worktree). Otherwise a plain `git switch -c <type>/<slug> origin/main`.
- Never work directly on `main`, and never edit the primary checkout while another
  task is in flight. From a worktree, never edit files in the primary repo directory.
- Do not run `npm install` inside a worktree — `wt new` provisions dependencies.

**Work**
- Commit small, focused changes with Conventional Commits. `wt finish` can commit
  leftovers with `--message`.
- Keep current by **rebasing**, not merging: `npm run wt -- sync <slug>` fetches and
  rebases the branch onto `origin/main` (and only force-with-leases that branch).
  Never merge `origin/main` into your branch, and never hand-resolve a shared-file
  conflict — coordinate with the file's owner in §8.

**Finish — one at a time; never merge concurrently**
- **Default (has remote):** `npm run wt -- finish <slug> --message "feat: …"`. The
  helper runs the gate, pushes, opens/uses the PR, waits for CI, squash-merges, and
  deletes the branch. CI is the gate; never merge red. (By hand: `git push -u origin
  <branch>` → `gh pr create --fill` → `gh pr checks --watch` → `gh pr merge --squash
  --delete-branch` → fast-forward `main` with `--ff-only`.)
- **Offline (no remote):** `npm run wt -- finish <slug> --offline --message "…"` runs
  the local gate and merges into `main`. Use only when there is genuinely no remote.
- On conflict: preserve work, rebase onto `main`, retry or abandon — never
  hand-resolve in the merge, never revert another agent's work.
- Never force-push, never commit directly to `main`, and never run destructive git
  (`reset --hard`, `clean -fd`) outside your own worktree. `npm run wt -- list`
  shows active worktrees.
- **`main` never diverges.** Local `main` is only ever fast-forwarded from
  `origin/main`; a local-only commit on `main` is a bug. Reconcile it through a
  branch + PR (see [`docs/parallel-work.md`](docs/parallel-work.md)) — never a local
  merge. The helper refuses to move a diverged `main`.

**Done means merged — never left dangling**
- A job is finished when it is **merged into `main`** (PR with green CI, or
  `wt finish`) — not when the code is written. The ladder in §8 is only satisfied
  at **INTEGRATED → VERIFIED**, so a green local test run is not "done".
- The **integration owner merges every agent's finished job**, **one at a time**,
  re-running `npm run typecheck && npm run lint && npm test` after each merge.
  Never stack several unmerged branches and merge them in a batch.
- No agent stops holding an open branch, worktree, or PR as a "handoff". After a
  merge, delete the branch/worktree (`--delete-branch`, or `wt finish` does it);
  `npm run wt -- list` should show no finished worktrees left behind.

## 10. One local dev environment — fixed ports, no ad-hoc copies
Local dev is **one topology**, not one per agent. Before starting anything, assume
the stack is **already running** and reuse it. Never stand up a second copy or
move it to a new port.

**Canonical stack (the only supported local dev shape):**

| Piece | How it runs | Address |
| --- | --- | --- |
| Postgres | Docker Compose (`postgres`) | `localhost:54329` |
| Cloud API | Docker Compose (`cloud`, baked from `apps/cloud/Dockerfile`) | `http://localhost:8787` |
| Web / portal (baked) | Docker Compose (`web`) | `http://localhost:4322` |
| Admin (baked) | Docker Compose (`admin`) | `http://localhost:4324` |
| Desktop UI (HMR) | `npm run dev:desktop` (Vite, `strictPort`) | `http://localhost:1420` |
| Portal UI (HMR) | `npm run dev -w @botifyr/portal` (Vite, `strictPort`) | `http://localhost:1421` |

Rules:
- **One instance per service.** Reuse the running stack; do not start a second
  cloud, Postgres, or Vite dev server. The cloud belongs in Docker — don't run
  `npm run dev:cloud` on the host while the `cloud` container is already on `8787`
  (that is "two clouds on one port").
- **Never invent a port.** These ports are the contract (`docker-compose.yml`,
  `apps/*/vite.config.ts`). If you need a different one, change it in those files
  **and** the docs — never just pass `--port`/`-p` locally. `strictPort` is
  deliberate: a busy port is a signal, not something to route around.
- **A busy port means find/stop the stale process**, not pick the next port.
  Reusing an existing instance is always preferred over starting a new one.
- **Front-end edits use the running Vite dev server (HMR).** Do not add a new
  preview server on a random port. The baked `:4322` web build is **not** a dev
  server — use it to verify the production bundle, not to iterate.
- **Report canonical URLs** in progress notes and verification output (e.g.
  "cloud `:8787`, desktop `:1420`"), never ad-hoc ports from a one-off run.
