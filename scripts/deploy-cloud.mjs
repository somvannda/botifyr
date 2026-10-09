// Deploy the cloud API to the local Docker Compose stack.
//
// Merging a PR updates `origin/main` but does NOT change the baked local `cloud`
// image — and `docker compose up --build cloud` bakes whatever branch the
// primary checkout happens to be on (so parallel work can deploy the wrong
// code). This script always deploys `origin/main`:
//   1. build the `botifyrxyz-cloud` image from `origin/main` (in a throwaway
//      worktree, so the primary checkout's branch doesn't matter),
//   2. recreate the Compose `cloud` service from that image,
//   3. smoke-check http://localhost:8787/health.
//
// Usage: npm run deploy:cloud

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HEALTH_URL = process.env.CLOUD_HEALTH_URL ?? "http://localhost:8787/health";

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

let buildDir;
try {
  run("git", ["fetch", "origin", "--quiet"]);
  buildDir = mkdtempSync(join(tmpdir(), "botifyr-cloud-build-"));
  run("git", ["worktree", "add", "--detach", buildDir, "origin/main"]);
  run("docker", ["build", "-f", "apps/cloud/Dockerfile", "-t", "botifyrxyz-cloud", "."], {
    cwd: buildDir,
  });
} finally {
  if (buildDir) {
    try {
      run("git", ["worktree", "remove", "--force", buildDir]);
    } catch {
      // Best-effort cleanup; the temp dir is outside the repo.
    }
    try {
      rmSync(buildDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

// Recreate the `cloud` service on the canonical project (the primary checkout),
// regardless of which worktree this script runs from.
const mainWorktree = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" })
  .split("\n")
  .find((line) => line.startsWith("worktree "))
  ?.slice("worktree ".length)
  .trim();
run(
  "docker",
  [
    "compose",
    "-f",
    join(mainWorktree, "docker-compose.yml"),
    "--project-name",
    "botifyrxyz",
    "up",
    "-d",
    "--no-build",
    "cloud",
  ],
  { cwd: mainWorktree },
);

// Smoke check (retry: the container takes a moment to accept connections).
let ok = false;
let body = "";
for (let i = 0; i < 20 && !ok; i += 1) {
  try {
    const res = await fetch(HEALTH_URL);
    ok = res.ok;
    body = (await res.text()).trim();
  } catch {
    // not ready yet
  }
  if (!ok) await new Promise((resolve) => setTimeout(resolve, 500));
}
if (ok) {
  console.log(`\n✅ cloud deployed — ${HEALTH_URL} → ${body}`);
} else {
  console.error(`\n⚠️ cloud started but ${HEALTH_URL} did not respond.`);
  process.exitCode = 1;
}
