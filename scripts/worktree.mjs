#!/usr/bin/env node
// Local parallel-work helper: one branch + one git worktree per task.
// See AGENTS.md §9. This repo has no remote and no CI, so `finish` runs the
// local gate (typecheck/lint/test), merges into `main`, then deletes the
// worktree and branch — leaving exactly one source tree on `main`.
//
// Usage:
//   npm run wt -- new <slug> [--base <ref>] [--no-install]
//   npm run wt -- finish <slug> [--message "type: summary"] [--allow-dirty] [--skip-gate]
//   npm run wt -- remove <slug>
//   npm run wt -- list

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const BASE_BRANCH = "main";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

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

function cmdNew(root, slug, flags) {
  assertSlug(slug);
  const dir = worktreeDir(root, slug);
  const branch = branchFor(slug);
  const base = flags.base ?? BASE_BRANCH;
  if (existsSync(dir)) throw new Error(`worktree path already exists: ${dir}`);

  git(["rev-parse", "--verify", `${base}^{commit}`], { cwd: root });
  git(["show-ref", "--verify", `refs/heads/${branch}`], { cwd: root, capture: true, allowFail: true });
  git(["worktree", "add", "-b", branch, dir, base], { cwd: root });

  if (flags.install !== false) {
    const hasLock = existsSync(path.join(root, "package-lock.json"));
    console.log(`\n▶ provisioning dependencies (${hasLock ? "npm ci" : "npm install"}) …`);
    run(NPM, [hasLock ? "ci" : "install"], { cwd: dir });
  }

  console.log(`\n✓ worktree ready\n  dir:    ${dir}\n  branch: ${branch} (from ${base})`);
  console.log(`  finish: npm run wt -- finish ${slug} --message "feat: …"`);
}

function runGate(dir) {
  for (const script of ["typecheck", "lint", "test"]) {
    console.log(`\n▶ npm run ${script}`);
    run(NPM, ["run", script], { cwd: dir });
  }
}

function cmdFinish(root, slug, flags) {
  assertSlug(slug);
  const dir = worktreeDir(root, slug);
  const branch = branchFor(slug);
  if (!existsSync(dir)) throw new Error(`no worktree at ${dir}`);

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

  const dirty = gitOut(["status", "--porcelain"], dir);
  if (dirty) {
    if (!flags.message) {
      throw new Error(`worktree has uncommitted changes; commit them or pass --message "type: summary"`);
    }
    git(["add", "-A"], { cwd: dir });
    git(["commit", "-m", flags.message], { cwd: dir });
  }

  if (!flags.skipGate) runGate(dir);

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
    else if (a === "--base") flags.base = args[++i];
    else if (a === "--message" || a === "-m") flags.message = args[++i];
    else positional.push(a);
  }
  return { flags, positional };
}

function usage() {
  console.log(`worktree helper (AGENTS.md §9)

  npm run wt -- new <slug> [--base <ref>] [--no-install]
  npm run wt -- finish <slug> [--message "type: summary"] [--allow-dirty] [--skip-gate]
  npm run wt -- remove <slug>
  npm run wt -- list`);
}

function main() {
  const root = repoRoot();
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const [cmd, slug] = positional;
  switch (cmd) {
    case "new":
      return cmdNew(root, slug, flags);
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
