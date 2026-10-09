#!/usr/bin/env node
// Point Git at the repo-tracked hooks in `.githooks` (AGENTS.md §9).
//
// Runs automatically on `npm install` / `npm ci` via package.json "prepare",
// or manually with `npm run hooks:install`. Resolves the hook directory against
// the *primary* working tree (via the common git dir) so the setting is stable
// across worktrees — a branch's worktree can come and go without dangling the
// path. Never fails the install: if Git is unavailable we warn and carry on.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function gitOut(args) {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (res.error || res.status !== 0) return null;
  return res.stdout.trim();
}

// The common git dir lives in the primary checkout; its parent holds `.githooks`.
const commonDir = gitOut(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
const stableRoot = commonDir ? path.dirname(commonDir) : root;

let hooks = path.join(stableRoot, ".githooks");
if (!existsSync(hooks)) hooks = path.join(root, ".githooks");
if (!existsSync(hooks)) {
  console.warn(`install-hooks: no .githooks directory found (looked in ${stableRoot}); skipping`);
  process.exit(0);
}

const res = spawnSync("git", ["config", "core.hooksPath", hooks], {
  cwd: root,
  stdio: "inherit",
});
if (res.error || res.status !== 0) {
  console.warn(`install-hooks: could not set core.hooksPath (${res.error?.message ?? res.status})`);
  process.exit(0);
}
console.log(`install-hooks: core.hooksPath -> ${hooks}`);
