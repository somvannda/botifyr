// Deploy the web/portal to the local Docker Compose stack.
//
// Merging a PR updates `origin/main` but does NOT change the baked local `web`
// image — this script does the actual deploy:
//   1. build the `botifyrxyz-web` image from `origin/main` (in a throwaway
//      worktree, so the primary checkout's branch doesn't matter),
//   2. recreate the Compose `web` service from that image,
//   3. smoke-check http://localhost:4322/portal/.
//
// Usage: npm run deploy:web

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLOUD_URL = process.env.VITE_CLOUD_URL ?? "http://localhost:8787";
const WEB_URL = process.env.WEB_URL ?? "http://localhost:4322/portal/";

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

let buildDir;
try {
  run("git", ["fetch", "origin", "--quiet"]);
  buildDir = mkdtempSync(join(tmpdir(), "botifyr-web-build-"));
  run("git", ["worktree", "add", "--detach", buildDir, "origin/main"]);
  run(
    "docker",
    [
      "build",
      "-f",
      "apps/web/Dockerfile",
      "-t",
      "botifyrxyz-web",
      "--build-arg",
      `VITE_CLOUD_URL=${CLOUD_URL}`,
      ".",
    ],
    {
      cwd: buildDir,
    },
  );
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

// Recreate the `web` service on the canonical project (the primary checkout),
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
    "web",
  ],
  { cwd: mainWorktree },
);
// Smoke check (retry: the container takes a moment to accept connections).
let ok = false;
let status = 0;
for (let i = 0; i < 20 && !ok; i += 1) {
  try {
    const res = await fetch(WEB_URL);
    status = res.status;
    ok = res.ok;
  } catch {
    // not ready yet
  }
  if (!ok) await new Promise((resolve) => setTimeout(resolve, 500));
}
if (ok) {
  console.log(`\n✅ web deployed — ${WEB_URL} → ${status}`);
  console.log("   (reload the page to pick up a change; the portal auto-updates via its service worker.)");
} else {
  console.error(`\n⚠️ web started but ${WEB_URL} did not respond (last status ${status}).`);
  process.exitCode = 1;
}
