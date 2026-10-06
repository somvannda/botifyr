/**
 * Milestone 4 smoke test.
 *
 * Signs up an account, stores an encrypted secret, creates a session, hands off
 * a task, approves the approval gate, verifies a screenshot and the audit log.
 *
 * Run with the cloud service running.
 */

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const email = `smoke+${Date.now()}@botifyr.test`;
const password = "smoke-password-123";

async function waitForHealth(retries = 30) {
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

async function post(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return response;
}

async function get(path, token) {
  return fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

await waitForHealth();
console.log(`[smoke] cloud reachable at ${base}`);

const signup = await post("/auth/signup", { email, password });
if (signup.status !== 201) throw new Error(`signup failed (${signup.status})`);
const auth = await signup.json();
const token = auth.token;
console.log(`[smoke] account ${auth.user.email}`);

// Unauthenticated access must be rejected.
const unauthed = await fetch(`${base}/v1/sessions`, { method: "POST" });
if (unauthed.status !== 401) throw new Error(`expected 401 without a token, got ${unauthed.status}`);
console.log("[smoke] unauthenticated request rejected (401)");

// Encrypted secret round-trip.
await post("/v1/secrets", { name: "SMOKE_KEY", value: "super-secret-value" }, token);
const secrets = await (await get("/v1/secrets", token)).json();
console.log(`[smoke] secrets: ${secrets.map((secret) => secret.name).join(", ")}`);
if (!secrets.some((secret) => secret.name === "SMOKE_KEY")) throw new Error("secret was not stored");

const session = await (await post("/v1/sessions", {}, token)).json();
console.log(`[smoke] session ${session.id}`);

const socket = new WebSocket(`${base.replace(/^http/, "ws")}/v1/stream?token=${encodeURIComponent(token)}`);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
console.log("[smoke] stream connected");

const seen = [];
const finished = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("timed out waiting for the task")), 120_000);
  socket.onmessage = async (message) => {
    const event = JSON.parse(message.data);
    seen.push(event.type);
    if (event.type === "approval.requested") {
      console.log(`[smoke] approval requested: "${event.approval.title}" (${event.approval.risk})`);
      await post(`/v1/tasks/${event.taskId}/approvals/${event.approval.id}`, { decision: "allow" }, token);
      console.log("[smoke] approved");
    }
    if (event.type === "task.completed") {
      clearTimeout(timeout);
      resolve(event.task);
    }
    if (event.type === "task.failed") {
      clearTimeout(timeout);
      reject(new Error(`task failed: ${event.task.error}`));
    }
  };
});

const created = await (
  await post(`/v1/sessions/${session.id}/tasks`, { goal: "Smoke test: verify the full loop" }, token)
).json();
console.log(`[smoke] task ${created.id} created (${created.status})`);

const task = await finished;
socket.close();

const screenshot = await get(`/v1/tasks/${task.id}/screenshot`, token);
const screenshotType = screenshot.headers.get("content-type") ?? "";
console.log(`[smoke] screenshot: ${screenshot.status} ${screenshotType}`);

const audit = await (await get(`/v1/tasks/${task.id}/audit`, token)).json();
console.log(`[smoke] audit events: ${audit.length}`);
console.log(`[smoke] status: ${task.status}`);
console.log(`[smoke] result: ${task.result}`);

if (
  task.status !== "completed" ||
  !screenshot.ok ||
  !screenshotType.includes("image/png") ||
  audit.length === 0
) {
  console.error("[smoke] FAILED");
  process.exit(1);
}

console.log("[smoke] PASSED");
