/**
 * Verifies a real model is reasoning instead of the scripted demo.
 * Sends "hello" and checks we get a conversational reply (not the mock script).
 */

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const email = `model+${Date.now()}@botifyr.test`;
const password = "model-password-123";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(retries = 30) {
  for (let i = 0; i < retries; i += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // not ready
    }
    await sleep(300);
  }
  throw new Error("cloud not reachable");
}

const post = (path, body, token) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
const get = (path, token) =>
  fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

await waitForHealth();

const { token } = await (await post("/auth/signup", { email, password })).json();
const config = await (await get("/v1/config", token)).json();
console.log(`[model] config: ${JSON.stringify(config)}`);

const session = await (await post("/v1/sessions", {}, token)).json();
let task = await (await post(`/v1/sessions/${session.id}/tasks`, { goal: "hello" }, token)).json();

const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  if (task.status === "completed" || task.status === "failed") break;
  if (task.approval?.status === "pending") {
    await post(`/v1/tasks/${task.id}/approvals/${task.approval.id}`, { decision: "allow" }, token);
  }
  await sleep(800);
  task = await (await get(`/v1/tasks/${task.id}`, token)).json();
}

console.log(`[model] status: ${task.status}`);
console.log(`[model] steps: ${task.steps.map((s) => s.title).join(", ") || "(none)"}`);
console.log(`[model] result: ${task.result ?? task.error}`);

const mockString = "Finished. I opened the demo page";
const usedTools = task.steps.some((s) => s.title.includes("."));

if (task.status !== "completed") {
  console.error("[model] FAILED — task did not complete");
  process.exit(1);
}
if ((task.result ?? "").includes(mockString)) {
  console.error("[model] FAILED — still using the mock script");
  process.exit(1);
}
console.log(
  usedTools
    ? "[model] PASSED (model chose to use a tool)"
    : "[model] PASSED (conversational reply, no tools)",
);
