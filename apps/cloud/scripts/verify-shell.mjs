/**
 * Verifies local shell: with the node connected, the agent runs a command on
 * this machine via `local.shell.exec`.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const email = `shell+${Date.now()}@botifyr.test`;
const password = "shell-password-123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = (p, b, t) =>
  fetch(`${base}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(b ?? {}),
  });
const get = (p, t) => fetch(`${base}${p}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });

for (let i = 0; i < 40; i += 1) {
  try {
    if ((await fetch(`${base}/health`)).ok) break;
  } catch {
    /* wait */
  }
  await sleep(300);
}

const { token } = await (await post("/auth/signup", { email, password })).json();

const node = spawn("npx", ["tsx", "apps/node/src/index.ts"], {
  cwd: repoRoot,
  shell: true,
  env: {
    ...process.env,
    BOTIFYR_CLOUD_URL: base,
    BOTIFYR_TOKEN: token,
    BOTIFYR_NODE_HEADLESS: "1",
    BOTIFYR_NODE_FRESH: "1",
    BOTIFYR_NODE_NAME: "shell-node",
  },
});
node.stdout.on("data", (d) => process.stdout.write(`[node] ${d}`));
node.stderr.on("data", (d) => process.stderr.write(`[node] ${d}`));

let online = false;
for (let i = 0; i < 40; i += 1) {
  if ((await (await get("/v1/config", token)).json()).nodeOnline) {
    online = true;
    break;
  }
  await sleep(500);
}
console.log(`[shell] node online: ${online}`);
if (!online) {
  node.kill();
  console.error("[shell] FAILED (node did not connect)");
  process.exit(1);
}

const session = await (await post("/v1/sessions", {}, token)).json();
const goal = "Run the shell command `echo botifyr-local-shell` on my computer and reply with the output.";
const { task } = await (
  await post(`/v1/sessions/${session.id}/messages`, { text: goal, local: true }, token)
).json();

const deadline = Date.now() + 120_000;
let current = task;
while (Date.now() < deadline) {
  if (current.status === "completed" || current.status === "failed") break;
  if (current.approval?.status === "pending") {
    await post(`/v1/tasks/${current.id}/approvals/${current.approval.id}`, { decision: "allow" }, token);
  }
  await sleep(700);
  current = await (await get(`/v1/tasks/${current.id}`, token)).json();
}

node.kill();

console.log(`[shell] steps:`);
for (const s of current.steps) console.log(`  ${s.title}: ${(s.detail ?? "").slice(0, 110)}`);

const ran = current.steps.some(
  (s) => s.title.startsWith("local.shell") && /botifyr-local-shell/i.test(s.detail ?? ""),
);
if (current.status !== "completed" || !ran) {
  console.error("[shell] FAILED");
  process.exit(1);
}
console.log("[shell] PASSED (ran a command on this machine)");
process.exit(0);
