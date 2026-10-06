/**
 * Persistence check for the Postgres store.
 *
 *   PHASE=1 node scripts/verify-persistence.mjs   # create account + task + secret
 *   (restart the cloud)
 *   PHASE=2 node scripts/verify-persistence.mjs   # log in again, read it back
 *
 * State is handed between phases through .persistence.json.
 */

import { readFile, writeFile } from "node:fs/promises";

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const phase = process.env.PHASE ?? "1";
const statefile = new URL("../.persistence.json", import.meta.url);

const email = "persist@botifyr.test";
const password = "persist-password-123";

function auth(token) {
  return { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function waitForHealth(retries = 40) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`cloud not reachable at ${base}`);
}

await waitForHealth();

async function loginOrSignup() {
  const login = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ email, password }),
  });
  if (login.ok) return (await login.json()).token;
  const signup = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ email, password }),
  });
  if (!signup.ok) throw new Error(`signup failed (${signup.status})`);
  return (await signup.json()).token;
}

if (phase === "1") {
  const token = await loginOrSignup();

  // Secret (ignore conflict if it already exists).
  await fetch(`${base}/v1/secrets`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ name: "PERSIST_KEY", value: "persist-secret-value" }),
  });

  const session = await (
    await fetch(`${base}/v1/sessions`, { method: "POST", headers: auth(token), body: "{}" })
  ).json();

  const task = await (
    await fetch(`${base}/v1/sessions/${session.id}/tasks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ goal: "Persistence check: survive a restart" }),
    })
  ).json();

  let current = task;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (current.status === "completed" || current.status === "failed") break;
    if (current.approval?.status === "pending") {
      await fetch(`${base}/v1/tasks/${current.id}/approvals/${current.approval.id}`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ decision: "allow" }),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    current = await (await fetch(`${base}/v1/tasks/${current.id}`, { headers: auth(token) })).json();
  }

  await writeFile(statefile, JSON.stringify({ email, password, taskId: current.id }, null, 2));
  console.log(`[persist] phase 1: created task ${current.id} (${current.status})`);
  console.log("[persist] now restart the cloud, then run PHASE=2");
  process.exit(0);
}

// Phase 2
const saved = JSON.parse(await readFile(statefile, "utf8"));
const login = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: auth(),
  body: JSON.stringify({ email: saved.email, password: saved.password }),
});
if (!login.ok) throw new Error(`could not log in after restart (${login.status})`);
const { token } = await login.json();
console.log("[persist] logged in after restart");

const taskResponse = await fetch(`${base}/v1/tasks/${saved.taskId}`, { headers: auth(token) });
if (!taskResponse.ok) throw new Error(`task did not survive the restart (${taskResponse.status})`);
const task = await taskResponse.json();
console.log(`[persist] task survived: ${task.id} (${task.status})`);

const secrets = await (await fetch(`${base}/v1/secrets`, { headers: auth(token) })).json();
console.log(`[persist] secrets after restart: ${secrets.map((secret) => secret.name).join(", ")}`);

if (task.status !== "completed" || !secrets.some((secret) => secret.name === "PERSIST_KEY")) {
  console.error("[persist] FAILED");
  process.exit(1);
}
console.log("[persist] PASSED");
