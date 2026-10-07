# Codebase access for developer agents

Status: **partly implemented**. See the phase status at the end. Part of the AI
Virtual Company OS (see [`company-workspace.md`](company-workspace.md),
[`company-os.md`](company-os.md)).

## 1. Goal

Engineering employees should be able to *analyse the real codebase* — read code,
search it, understand features and functions — so their plans and tasks reflect
what actually needs building, not guesses.

> "Our AI dev team should know what to work on by analysing the codebase,
> features and functionalities."

The CEO hires a **CTO** (a founding leader, see the lean-hiring change); the CTO
can then hire engineers, and every engineering employee gets **code tools** scoped
to the company's connected repositories.

## 2. Non-goals (for the first cut)

- No autonomous commits/PRs without owner approval (consequential).
- No arbitrary internet repo cloning on the shared host without a connection entry.
- No secrets (tokens) ever exposed to the model.

## 3. Concepts

### 3.1 Repository connection (workspace-scoped)

A company can connect one or more repositories. Like the other "hands", a
connection is **workspace-scoped**, not personal.

```ts
export interface CodeConnection {
  id: string;
  workspaceId: string;
  kind: "github" | "gitlab" | "local";
  /** HTTPS clone URL, or an absolute path for `local`. */
  url: string;
  branch?: string;            // default branch to track
  /** Secret name in the shared vault holding the token (never the token itself). */
  tokenSecret?: string;
  /** Local checkout directory (server-local, e.g. under BOTIFYR_REPOS_DIR). */
  path?: string;
  createdAt: string;
}
```

Credentials live in the existing **shared vault** (`secrets`), resolved
workspace-first (the same path the media-cookie code already uses). The model
only ever sees the checkout path.

### 3.2 Checkout

On connect (or before a run), the cloud clones/pulls the repo into a per-workspace
directory:

```
${BOTIFYR_REPOS_DIR:-/repos}/<workspaceId>/<connectionId>/
```

Clone/pull runs on the host (like the browser profiles), using the token from the
vault, with `--depth` and a size cap. The path is stored on the connection.

## 4. Tools (engineering department only)

Granted only when the author's role department is `engineering` **and** the
company has at least one code connection.

| Tool | Purpose | Approval |
| --- | --- | --- |
| `code.tree` | List the tree (bounded depth, ignored dirs). | no |
| `code.search` | Text/regex search; returns file:line hits. | no |
| `code.read` | Read a file or a line range. | no |
| `code.git_log` | Recent git history (read-only). | no |
| `code.map` | Summarise the repo → `CODEBASE.md` in the wiki. | no |
| `code.apply` | Stage a file's new contents under `/work` for review. | yes |
| `code.test` | Run the repo's tests in a `docker run --network none` sandbox. | yes |

Read tools are cheap (no model calls; deterministic output, bounded size). Write
tools are approval-gated and produce a diff the CEO reviews — matching the
"consequential actions need approval" rule.

### 4.1 Sandbox execution

Running the project's tests/build should happen in the existing **code sandbox**
(`infra/code-sandbox`, `createDockerComputerBackend`), not on the cloud host.
A `code.test` tool could invoke the sandbox's test runner and return the summary.

## 5. Wiring into the org

- The **CTO** is the founder who owns engineering. Its standing instructions tell
  it to: read the codebase, map features → modules, and write a technical plan
  (`company.plan`) before delegating (`company.delegate`).
- Engineering tasks land on the board; when an engineer's scheduled run fires, it
  uses `code.search`/`code.read` to do the work and reports back.
- The **PLAN.md** + **BACKLOG.md** in the workspace wiki become the shared,
  code-grounded strategy.

## 6. Capability gating

Reuse the capability-grant system: a `repo` capability per connection, subject
`role:CTO`, `role:Lead Engineer`, etc. Revoking it removes the code tools
(`tool-capabilities.ts` already maps tools → capabilities).

## 7. Security

- Path jail: every tool resolves paths under the connection's checkout; reject
  `..` escapes and symlink escapes.
- Size limits per `code.read`/`code.search` (e.g. 200 KB, 200 hits).
- Tokens: from the vault only; never logged, never in prompts.
- Read-only by default; `code.apply`/`code.commit` are approval-gated and produce
  a reviewable diff. No force-push, no protected-branch writes.
- One checkout per workspace; clean on company delete (cascade) or disconnect.

## 8. Phased plan

1. **Phase 1 — read-only:** ✅ implemented. Repos live on the workspace record
   (`Workspace.repos`), `code.tree`/`code.search`/`code.read`/`code.git_log` are
   path-jailed and granted to engineering roles; the HQ Office tab connects a
   repo; docker-compose mounts a read-only `/repos`.
2. **Phase 2 — propose changes:** ✅ implemented. `code.apply` (approval-gated)
   stages a file under `/work/<workspaceId>/<repo>`; `GET
   /v1/workspaces/:id/proposals` returns a unified diff and the HQ **Changes**
   tab renders it. Managed cloning: `POST /v1/workspaces/:id/repos` clones a URL
   into `/managed` using a token from the shared vault.
3. **Phase 3 — verify:** ✅ implemented. `code.test` (approval-gated) runs the
   repo's tests in a `docker run --network none` sandbox; `sandboxMount()` maps
   `/repos` and `/managed` to host/Docker mounts and fails safe when unmapped.

**Still open:** open a PR from a staged change (branch + push); install/restore
step before `code.test` for repos without vendored deps; per-tenant checkout
isolation and quotas.

## 9. Open questions

- GitHub App vs. PAT for auth (App is nicer, PAT is simpler for self-host).
- Multi-repo companies: one connection per service, a `repo` arg on each tool.
- Monorepo size: sparse checkout / partial clone.
- Where checkouts live vs. the browser-profile volume (separate volume recommended).
