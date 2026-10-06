/**
 * Verifies the local node: a node connects, and the agent uses `local.browser.*`
 * to operate the browser on this machine.
 *
 *   node scripts/verify-local.mjs
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const email = `local+${Date.now()}@botifyr.test`;
const password = "local-password-123";
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

// Start the local node (headless for CI).
const node = spawn("npx", ["tsx", "apps/node/src/index.ts"], {
  cwd: repoRoot,
  shell: true,
  env: {
    ...process.env,
    BOTIFYR_CLOUD_URL: base,
    BOTIFYR_TOKEN: token,
    BOTIFYR_NODE_HEADLESS: "1",
    BOTIFYR_NODE_NAME: "test-node",
  },
});
node.stdout.on("data", (d) => process.stdout.write(`[node] ${d}`));
node.stderr.on("data", (d) => process.stderr.write(`[node] ${d}`));

// Wait until the cloud sees the node.
let online = false;
for (let i = 0; i < 40; i += 1) {
  const config = await (await get("/v1/config", token)).json();
  if (config.nodeOnline) {
    online = true;
    break;
  }
  await sleep(500);
}
console.log(`[local] node online: ${online}`);
if (!online) {
  node.kill();
  console.error("[local] FAILED (node did not connect)");
  process.exit(1);
}

const session = await (await post("/v1/sessions", {}, token)).json();
const goal =
  "Open http://localhost:8787/demo in MY computer's browser and tell me the h1 text. Reply with only the h1 text.";
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

let after = await (await get(`/v1/sessions/${session.id}`, token)).json();
for (let i = 0; i < 20 && after.messages[after.messages.length - 1]?.role !== "assistant"; i += 1) {
  await sleep(500);
  after = await (await get(`/v1/sessions/${session.id}`, token)).json();
}

node.kill();

const steps = current.steps.map((s) => s.title);
const reply = after.messages[after.messages.length - 1]?.content ?? "";
console.log(`[local] steps:`);
for (const s of current.steps) console.log(`  ${s.title}: ${(s.detail ?? "").slice(0, 110)}`);
console.log(`[local] reply: ${reply}`);

const usedLocal = steps.some((s) => s.startsWith("local.browser."));
const readPage = current.steps.some(
  (s) => s.title.includes("extract") && /Botifyr Demo Page/i.test(s.detail ?? ""),
);
if (current.status !== "completed" || !usedLocal || !readPage) {
  console.error("[local] FAILED");
  process.exit(1);
}
console.log("[local] PASSED (agent operated the browser on this machine)");
process.exit(0);
