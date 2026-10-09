#!/usr/bin/env node
// Apply the AGENTS.md §9 branch protection for `main` (see docs/parallel-work.md).
//
// Requires GitHub Pro (or a public repo): rulesets and classic branch protection
// are not available on GitHub Free for private repositories. After upgrading,
// this is the one command that closes the gap:
//
//   npm run protect:main                                  # apply / update
//   npm run protect:main -- --dry-run                     # print the payload only
//   npm run protect:main -- --approvals 1 --code-owner-review
//
// Idempotent: it updates the ruleset named "main-protection" if one exists, and
// creates it otherwise. The only way `main` can move is a PR with green CI and an
// up-to-date branch, so a local merge can never silently overwrite other work.

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const val = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const dryRun = has("--dry-run");
const approvals = Number(val("--approvals", "0"));
const codeOwnerReview = has("--code-owner-review");
const name = val("--name", "main-protection");
const GH = process.platform === "win32" ? "gh.exe" : "gh";

function ghRaw(argsIn, { input } = {}) {
  const res = spawnSync(GH, argsIn, {
    encoding: "utf8",
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return res;
}

const gh = (apiArgs, opts) => ghRaw(["api", ...apiArgs], opts);

const isPlanError = (msg = "") => /GitHub Pro|make this repository public/i.test(msg);

// 1. Resolve the repository through gh (also validates auth).
const repoRes = ghRaw(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
if (repoRes.status !== 0) {
  const last = (repoRes.stderr || "").trim().split("\n").pop();
  console.error(`✗ could not read the repository via gh${last ? `: ${last}` : ""}`);
  console.error("  Is the GitHub CLI installed and authenticated? Run: gh auth status");
  process.exit(1);
}
const repo = repoRes.stdout.trim();

// 2. The policy. Review requirements are configurable so a solo owner is never
//    locked out: the default needs no approval, only the CI gate + linear PRs.
const ruleset = {
  name,
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "required_linear_history" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: approvals,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: codeOwnerReview,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [
          { context: "Typecheck / Lint / Test" },
          { context: "Cloud image" },
        ],
      },
    },
  ],
};

if (dryRun) {
  console.log(`repo: ${repo}\n`);
  console.log(JSON.stringify(ruleset, null, 2));
  process.exit(0);
}

// 3. Find an existing ruleset by name so the command is idempotent.
const listRes = gh([`repos/${repo}/rulesets`]);
if (listRes.status !== 0) {
  const msg = (listRes.stderr || "").trim();
  if (isPlanError(msg)) {
    console.error(
      "✗ Branch protection needs GitHub Pro (or a public repo).\n" +
        "  This repo is private on GitHub Free. Upgrade, then re-run: npm run protect:main",
    );
    process.exit(1);
  }
  console.error(`✗ could not list rulesets:\n${msg}`);
  process.exit(1);
}

let existingId = null;
try {
  existingId = JSON.parse(listRes.stdout || "[]").find((r) => r.name === name)?.id ?? null;
} catch {
  existingId = null;
}

// 4. Create or update.
const payload = JSON.stringify(ruleset);
const res = existingId
  ? gh([`repos/${repo}/rulesets/${existingId}`, "-X", "PUT", "--input", "-"], { input: payload })
  : gh([`repos/${repo}/rulesets`, "-X", "POST", "--input", "-"], { input: payload });

if (res.status !== 0) {
  const msg = (res.stderr || "").trim();
  if (isPlanError(msg)) {
    console.error(
      "✗ Branch protection needs GitHub Pro (or a public repo). Upgrade, then re-run: npm run protect:main",
    );
  } else {
    console.error(`✗ failed to apply the ruleset:\n${msg}`);
  }
  process.exit(1);
}

console.log(`✓ ${existingId ? "updated" : "created"} ruleset '${name}' on ${repo}`);
console.log("  main now requires: a PR, green CI, an up-to-date branch; no force-push, no deletion.");
