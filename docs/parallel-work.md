# Parallel work without overwrites

How several agents (or humans) edit this repo at once, land every change through
review, and **never let one workstream's code overwrite another's**. This is the
operational detail behind [AGENTS.md §8](../AGENTS.md) and
[§9](../AGENTS.md). Read those first.

## Why code gets "overwritten" (the three real causes)

1. **More than one integration point.** If work lands on `main` *and* on a
   long-lived branch (e.g. `feat/*`), the two drift. The next agent starts from
   one, doesn't see the other's work, and re-does or replaces it. The visible
   symptom is "my code got overwritten".
2. **A local merge into a diverged `main`.** `git merge` into a `main` that is
   behind or ahead of `origin/main` silently keeps one side of each conflicting
   hunk and hides the other. Deleting the feature branch afterwards erases the
   evidence.
3. **Two branches rewriting the same shared file.** A merge then keeps one
   version of the file. Shared files (`styles.css`, `FeedView.tsx`,
   `server.ts`, …) are where this always happens.

The fix for all three is the same: **one integration point, short-lived
branches, PR + CI gate, rebase before finising, and a named owner per hot file.**

## The rules

- **`origin/main` is the only integration point.** Nobody commits or pushes to
  `main` directly; it moves only by merging a reviewed, green PR.
- **Local `main` never diverges.** It is only ever fast-forwarded from
  `origin/main`. A local-only commit on `main` is a bug to reconcile, not to
  merge.
- **One task = one short-lived branch** off `origin/main`, in its own worktree.
- **Rebase, don't merge.** Before finishing, `npm run wt -- sync <slug>` rebases
  your branch onto `origin/main`. Never merge `origin/main` into a feature
  branch.
- **One owner per hot file** (§8). Coordinate before editing a file someone else
  owns; `CODEOWNERS` makes that review mandatory.
- **Finish through the PR path.** `npm run wt -- finish <slug> --message "…"`
  pushes, opens the PR, waits for CI, and squash-merges. CI is the gate.

## Setup — make it enforced (one-time, repo admin)

The rules only hold if the platform enforces them. Turning this on takes a
minute and is the difference between "protocol" and "cannot happen".

> **Plan requirement.** Rulesets and classic branch protection are **not
> available on GitHub Free for private repositories** — the API returns
> `403 Upgrade to GitHub Pro or make this repository public`. This repo is
> currently private on Free, so the server-side steps below are unavailable.
> Until it is upgraded (or made public), use the free local guard in **§1b**,
> which is already wired into `npm install`.

### 1. Branch protection / ruleset for `main`

Via the GitHub UI: **Settings → Rules → Rulesets → New branch ruleset**, target
`main`, then enable:

- Restrict pushes — block direct pushes to `main`.
- Require a pull request before merging, with **at least one approval**.
- Require review from **Code Owners** (uses `.github/CODEOWNERS`).
- Require status checks to pass, adding **`Typecheck / Lint / Test`** and
  **`Cloud image`**.
- Require branches to be **up to date** before merging.
- Block force pushes and deletions.

Or with the `gh` CLI (needs admin on the repo):

```sh
gh api --method POST repos/{owner}/{repo}/rulesets \
  -f name=main-protection -f target=branch -f enforcement=active \
  -f 'conditions[branches][0][name]=~DEFAULT_BRANCH' \
  -F 'rules[][type]=deletion' \
  -F 'rules[][type]=non_fast_forward' \
  -F 'rules[][type]=required_linear_history' \
  -f 'rules[][type]=pull_request' \
  -f 'rules[][parameters][required_approving_review_count]=1' \
  -f 'rules[][parameters][require_code_owner_review]=true' \
  -f 'rules[][parameters][dismiss_stale_reviews_on_push]=true'
```

(Add the `required_status_checks` rule with the CI job names in the UI; the exact
JSON shape varies by GitHub version.)

### 1b. Free fallback — the local `pre-push` guard

When server-side protection is unavailable, a repo-tracked hook stops the single
most damaging local mistake: pushing `main` directly (which is how one
workstream's local merge silently replaces another's work).

- `.githooks/pre-push` rejects any push that updates `refs/heads/main`.
- `scripts/install-hooks.mjs` points Git at it (`core.hooksPath`). Every
  `npm run wt -- new` installs it for the whole repo; run it once by hand with
  `npm run hooks:install`.

This is a guardrail, not a wall: `git push --no-verify` bypasses it, so keep it
in place *and* upgrade to Pro for real enforcement. The hook is intentionally
narrow — it blocks `main` only, so `wt sync` can still force-with-lease a feature
branch.

### 2. Add the owners

Edit `.github/CODEOWNERS` and put real handles/teams on the workstreams you run
in parallel. The default `*` owner is the integration owner — the one person
responsible for merging, one PR at a time.

## Recovering from a diverged `main`

If `git log --oneline origin/main..main` is ever non-empty, local `main` has
commits that never went through review. **Do not force it and do not merge it.**
Preserve, then reconcile:

```sh
# 1. Preserve — push a safety branch/tag (never destructive).
git branch safety/main-local-$(date +%Y%m%d) main
git push -u origin safety/main-local-$(date +%Y%m%d)

# 2. See what is actually missing (patch-id aware).
git cherry -v origin/main main        # '+' = not on origin/main
git cherry -v main origin/main        # the other direction

# 3. Land the still-wanted commits through a PR, not a local merge.
git switch -c chore/reconcile-main origin/main
git cherry-pick <sha> …               # or merge the safety branch, then resolve
# open a PR, wait for CI, squash-merge

# 4. Only once origin/main contains everything you want:
git switch main && git pull --ff-only
# if it refuses because it diverged, reset it deliberately to origin/main
# (all preserved above) — with approval.
```

The worktree helper never does step 3/4 for you: `wt finish` only
**fast-forwards** local `main`, and leaves a diverged `main` untouched.

## Quick reference

```sh
npm run wt -- new <slug>                    # branch off origin/main, own worktree
npm run wt -- sync <slug>                   # rebase on origin/main
npm run wt -- finish <slug> --message "…"   # gate → push → PR → CI → squash-merge
npm run wt -- finish <slug> --offline …     # only when there is no remote
npm run wt -- remove <slug>                 # discard a worktree (destructive)
npm run wt -- list                          # active worktrees
```
