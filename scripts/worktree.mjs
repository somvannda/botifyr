#!/usr/bin/env node
// Local parallel-work helper: one branch + one git worktree per task.
// See AGENTS.md §9.
//
// This repo HAS a remote (`origin`) and CI (`.github/workflows/ci.yml`), so the
// default `finish` is: push the branch → open a PR → wait for CI → squash-merge
// → delete the branch. `main` only ever moves through a reviewed, green PR, so
// parallel work cannot silently overwrite other work. The local-merge path is
// only for the `--offline` case (no remote available).
//
// Branches are always cut from `origin/main` (fetched first) so every task
// starts from the single integration point.
//
// Usage:
//   npm run wt -- new <slug> [--base <ref>] [--no-install]
//   npm run wt -- sync <slug>
//   npm run wt -- finish <slug> [--message "type: summary"] [--offline] [--allow-dirty] [--skip-gate]
//   npm run wt -- remove <slug>
//   npm run wt -- list

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const BASE_BRANCH = "main";
const REMOTE = "origin";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const GH = process.platform === "win32" ? "gh.exe" : "gh";

function run(bin, args, { cwd, capture = false, allowFail = false } = {}) {
  // Node refuses to spawn `.cmd`/`.bat` (e.g. npm.cmd) without a shell on
  // Windows (EINVAL), and passing an args array with `shell: true` triggers
  // DEP0190. Run those through cmd.exe as a single command string — npm's args
  // are simple tokens, so joining them is safe and warning-free.
  const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  const res = viaShell
    ? spawnSync([bin, ...args].join(" "), {
        cwd,
        encoding: "utf8",
        stdio: capture ? "pipe" : "inherit",
        shell: true,
      })
    : spawnSync(bin, args, {
        cwd,
        encoding: "utf8",
        stdio: capture ? "pipe" : "inherit",
      });
  if (res.error) throw res.error;
  if (res.status !== 0 && !allowFail) {
    const detail = capture ? `\n${res.stdout ?? ""}${res.stderr ?? ""}` : "";
    throw new Error(`${bin} ${args.join(" ")} failed (exit ${res.status})${detail}`);
  }
  return res;
}

const git = (args, opts) => run("git", args, opts);
const gitOut = (args, cwd) => git(args, { cwd, capture: true }).stdout.trim();

function repoRoot() {
  const out = gitOut(["rev-parse", "--show-toplevel"], process.cwd());
  return out.replace(/\//g, path.sep);
}

const worktreeDir = (root, slug) => path.join(path.dirname(root), `${path.basename(root)}-wt-${slug}`);
const branchFor = (slug) => `agent/${slug}`;

function assertSlug(slug) {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    throw new Error(`invalid slug '${slug}' — use letters, digits and '-', e.g. feat-billing`);
  }
}

function hasRemote(cwd, remote = REMOTE) {
  const res = git(["remote"], { cwd, capture: true, allowFail: true });
  return res.stdout
    .split("\n")
    .map((s) => s.trim())
    .includes(remote);
}

// The single integration point: `origin/main` when a remote exists, else `main`.
function remoteBase(cwd) {
  if (!hasRemote(cwd)) return BASE_BRANCH;
  const ref = `refs/remotes/${REMOTE}/${BASE_BRANCH}`;
  const res = git(["rev-parse", "--verify", ref], { cwd, capture: true, allowFail: true });
  return res.status === 0 ? `${REMOTE}/${BASE_BRANCH}` : BASE_BRANCH;
}

function fetchRemote(cwd) {
  if (!hasRemote(cwd)) return;
  console.log(`\n▶ fetching ${REMOTE} …`);
  git(["fetch", REMOTE, "--prune"], { cwd });
}

function cmdNew(root, slug, flags) {
  assertSlug(slug);
  const dir = worktreeDir(root, slug);
  const branch = branchFor(slug);
  if (existsSync(dir)) throw new Error(`worktree path already exists: ${dir}`);

  fetchRemote(root);
  const base = flags.base ?? remoteBase(root);
  git(["rev-parse", "--verify", `${base}^{commit}`], { cwd: root });
  git(["show-ref", "--verify", `refs/heads/${branch}`], { cwd: root, capture: true, allowFail: true });
  git(["worktree", "add", "-b", branch, dir, base], { cwd: root });

  if (flags.install !== false) {
    const hasLock = existsSync(path.join(root, "package-lock.json"));
    console.log(`\n▶ provisioning dependencies (${hasLock ? "npm ci" : "npm install"}) …`);
    run(NPM, [hasLock ? "ci" : "install"], { cwd: dir });
  }

  console.log(`\n✓ worktree ready\n  dir:    ${dir}\n  branch: ${branch} (from ${base})`);
  console.log(`  sync:   npm run wt -- sync ${slug}`);
  console.log(`  finish: npm run wt -- finish ${slug} --message "feat: …"`);
}

function cmdSync(root, slug) {
  assertSlug(slug);
  const dir = worktreeDir(root, slug);
  const branch = branchFor(slug);
  if (!existsSync(dir)) throw new Error(`no worktree at ${dir}`);

  fetchRemote(root);
  const base = remoteBase(root);
  console.log(`\n▶ rebasing ${branch} onto ${base} …`);
  git(["rebase", base], { cwd: dir });

  // Keep the pushed branch in step, but only ever force-with-lease the agent's
  // own feature branch — never a shared branch like `main`.
  const upstream = git(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { cwd: dir, capture: true, allowFail: true },
  );
  if (upstream.status === 0) {
    console.log(`\n▶ updating remote ${branch} (--force-with-lease) …`);
    git(["push", "--force-with-lease", REMOTE, branch], { cwd: dir });
  }
  console.log(`\n✓ ${branch} is up to date with ${base}`);
}

function runGate(dir) {
  for (const script of ["typecheck", "lint", "test"]) {
    console.log(`\n▶ npm run ${script}`);
    run(NPM, ["run", script], { cwd: dir });
  }
}

// Default finish: land through a reviewed, CI-gated PR so `main` never moves by
// a hidden local merge. CI is the gate; never merge red.
function finishViaPr(root, dir, branch) {
  console.log(`\n▶ pushing ${branch} to ${REMOTE} …`);
  const pushed = git(["push", "-u", REMOTE, branch], { cwd: dir, capture: true, allowFail: true });
  if (pushed.status !== 0) {
    throw new Error(
      `push rejected — the branch is behind ${remoteBase(root)}. Run 'npm run wt -- sync <slug>', then retry.\n${pushed.stderr}`,
    );
  }

  const existing = run(GH, ["pr", "view", branch, "--json", "number"], {
    cwd: dir,
    capture: true,
    allowFail: true,
  });
  if (existing.status !== 0) {
    console.log(`\n▶ opening PR …`);
    run(GH, ["pr", "create", "--fill"], { cwd: dir });
  }

  console.log(`\n▶ waiting for CI …`);
  const checks = run(GH, ["pr", "checks", branch, "--watch"], {
    cwd: dir,
    capture: true,
    allowFail: true,
  });
  process.stdout.write(checks.stdout ?? "");
  const noChecks = /no checks reported/i.test(`${checks.stdout}${checks.stderr}`);
  if (checks.status !== 0 && !noChecks) {
    throw new Error(`CI is not green — not merging. Fix the PR and re-run finish.\n${checks.stderr}`);
  }

  console.log(`\n▶ squash-merging ${branch} …`);
  const merged = run(GH, ["pr", "merge", branch, "--squash", "--delete-branch"], {
    cwd: dir,
    capture: true,
    allowFail: true,
  });
  if (merged.status !== 0) {
    throw new Error(`merge failed (review or up-to-date required?). PR kept.\n${merged.stderr}`);
  }

  git(["worktree", "remove", "--force", dir], { cwd: root });
  git(["branch", "-D", branch], { cwd: root, capture: true, allowFail: true });
  updateLocalMain(root);
  console.log(`\n✓ merged ${branch} via PR; worktree + branch removed.`);
}

// Only ever fast-forward local `main`; never discard local commits. If local
// main has diverged, leave it alone and tell the operator what to do.
function updateLocalMain(root) {
  if (!hasRemote(root)) return;
  const remoteRef = `${REMOTE}/${BASE_BRANCH}`;
  const res = git(["branch", "-f", BASE_BRANCH, remoteRef], { cwd: root, capture: true, allowFail: true });
  if (res.status === 0) {
    console.log(`✓ local ${BASE_BRANCH} updated to ${remoteRef}`);
    return;
  }
  const ff = git(["merge-base", "--is-ancestor", BASE_BRANCH, remoteRef], {
    cwd: root,
    capture: true,
    allowFail: true,
  });
  if (ff.status !== 0) {
    console.log(
      `\nℹ local ${BASE_BRANCH} has diverged from ${remoteRef} — left untouched.\n` +
        `  Reconcile it deliberately (branch/PR), do not force it.`,
    );
  } else {
    console.log(
      `\nℹ local ${BASE_BRANCH} is checked out in another worktree — update it there:\n  git -C <worktree> pull --ff-only`,
    );
  }
}

function finishLocally(root, dir, branch, slug, flags) {
  const current = gitOut(["symbolic-ref", "--short", "HEAD"], root);
  if (current !== BASE_BRANCH) {
    throw new Error(`primary checkout is on '${current}'; switch to '${BASE_BRANCH}' to integrate`);
  }
  const rootDirty = gitOut(["status", "--porcelain"], root);
  if (rootDirty && !flags.allowDirty) {
    throw new Error(
      `primary checkout has uncommitted changes; commit/stash them first, or pass --allow-dirty`,
    );
  }

  console.log(`\n▶ merge ${branch} → ${BASE_BRANCH}`);
  const merge = git(["merge", "--no-ff", branch, "-m", `merge: ${branch}`], {
    cwd: root,
    capture: true,
    allowFail: true,
  });
  if (merge.status !== 0) {
    git(["merge", "--abort"], { cwd: root, allowFail: true });
    throw new Error(
      `merge conflict — aborted, nothing merged; worktree kept.\n${merge.stdout}\n${merge.stderr}\n` +
        `Rebase the worktree onto ${BASE_BRANCH} and retry, or 'npm run wt -- remove ${slug}'.`,
    );
  }

  git(["worktree", "remove", "--force", dir], { cwd: root });
  git(["branch", "-D", branch], { cwd: root });
  console.log(`\n✓ merged ${branch} into ${BASE_BRANCH}; worktree + branch removed. One source tree.`);
}

function cmdFinish(root, slug, flags) {
  assertSlug(slug);
  const dir = worktreeDir(root, slug);
  const branch = branchFor(slug);
  if (!existsSync(dir)) throw new Error(`no worktree at ${dir}`);

  const dirty = gitOut(["status", "--porcelain"], dir);
  if (dirty) {
    if (!flags.message) {
      throw new Error(`worktree has uncommitted changes; commit them or pass --message "type: summary"`);
    }
    git(["add", "-A"], { cwd: dir });
    git(["commit", "-m", flags.message], { cwd: dir });
  }

  if (!flags.skipGate) runGate(dir);

  const useRemote = hasRemote(root) && !flags.offline;
  if (useRemote) {
    finishViaPr(root, dir, branch);
  } else {
    finishLocally(root, dir, branch, slug, flags);
  }
}

function cmdRemove(root, slug) {
  assertSlug(slug);
  const dir = worktreeDir(root, slug);
  const branch = branchFor(slug);
  if (existsSync(dir)) git(["worktree", "remove", "--force", dir], { cwd: root });
  git(["branch", "-D", branch], { cwd: root, capture: true, allowFail: true });
  console.log(`✓ removed worktree + branch for '${slug}' (changes discarded).`);
}

function cmdList(root) {
  console.log(gitOut(["worktree", "list"], root));
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--no-install") flags.install = false;
    else if (a === "--skip-gate") flags.skipGate = true;
    else if (a === "--allow-dirty") flags.allowDirty = true;
    else if (a === "--offline") flags.offline = true;
    else if (a === "--base") flags.base = args[++i];
    else if (a === "--message" || a === "-m") flags.message = args[++i];
    else positional.push(a);
  }
  return { flags, positional };
}

function usage() {
  console.log(`worktree helper (AGENTS.md §9)

  npm run wt -- new <slug> [--base <ref>] [--no-install]
  npm run wt -- sync <slug>
  npm run wt -- finish <slug> [--message "type: summary"] [--offline] [--allow-dirty] [--skip-gate]
  npm run wt -- remove <slug>
  npm run wt -- list

  finish lands through a CI-gated PR by default; use --offline only when there
  is no remote to push to.`);
}

function main() {
  const root = repoRoot();
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const [cmd, slug] = positional;
  switch (cmd) {
    case "new":
      return cmdNew(root, slug, flags);
    case "sync":
      return cmdSync(root, slug);
    case "finish":
      return cmdFinish(root, slug, flags);
    case "remove":
      return cmdRemove(root, slug);
    case "list":
      return cmdList(root);
    default:
      usage();
      process.exitCode = 1;
  }
}

try {
  main();
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
}
