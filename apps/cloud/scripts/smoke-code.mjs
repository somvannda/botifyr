/**
 * Milestone 6 smoke test: code/shell use in an isolated sandbox.
 *
 * Signs up, hands off a task, approves the shell step, and asserts that a real
 * command ran inside the container (the step output contains "sandbox math: 42").
 */

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const email = `code+${Date.now()}@botifyr.test`;
const password = "code-password-123";

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
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

async function get(path, token) {
  return fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

await waitForHealth();
console.log(`[code] cloud reachable at ${base}`);

const signup = await post("/auth/signup", { email, password });
if (signup.status !== 201) throw new Error(`signup failed (${signup.status})`);
const { token } = await signup.json();

const session = await (await post("/v1/sessions", {}, token)).json();
console.log(`[code] session ${session.id}`);

const socket = new WebSocket(`${base.replace(/^http/, "ws")}/v1/stream?token=${encodeURIComponent(token)}`);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

const seen = [];
const finished = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("timed out")), 120_000);
  socket.onmessage = async (message) => {
    const event = JSON.parse(message.data);
    seen.push(event.type);
    if (event.type === "approval.requested") {
      console.log(`[code] approval requested: "${event.approval.title}"`);
      await post(`/v1/tasks/${event.taskId}/approvals/${event.approval.id}`, { decision: "allow" }, token);
      console.log("[code] approved");
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
  await post(`/v1/sessions/${session.id}/tasks`, { goal: "Code smoke test" }, token)
).json();
console.log(`[code] task ${created.id} created`);

const task = await finished;
socket.close();

const execStep = task.steps.find((step) => step.title === "shell.exec");
console.log(`[code] shell.exec output: ${(execStep?.detail ?? "").split("\n").slice(0, 2).join(" | ")}`);

const files = task.steps.filter((step) => step.title.startsWith("file.")).map((step) => step.title);
console.log(`[code] file steps: ${files.join(", ")}`);

const audit = await (await get(`/v1/tasks/${task.id}/audit`, token)).json();
console.log(`[code] audit events: ${audit.length}`);
console.log(`[code] status: ${task.status}`);

const ranRealCommand = (execStep?.detail ?? "").includes("sandbox math: 42");
if (task.status !== "completed" || !ranRealCommand || audit.length === 0) {
  console.error("[code] FAILED");
  process.exit(1);
}

console.log("[code] PASSED");
