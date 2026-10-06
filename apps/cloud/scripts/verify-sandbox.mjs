/**
 * Verifies the containerized cloud can spawn and reach a sandbox over the
 * shared Docker network, using a real browser task.
 */

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const email = `sandbox+${Date.now()}@botifyr.test`;
const password = "sandbox-password-123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(retries = 40) {
  for (let i = 0; i < retries; i += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // not ready
    }
    await sleep(400);
  }
  throw new Error("cloud not reachable");
}

const post = (p, b, t) =>
  fetch(`${base}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(b ?? {}),
  });
const get = (p, t) => fetch(`${base}${p}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });

await waitForHealth();
const { token } = await (await post("/auth/signup", { email, password })).json();
const session = await (await post("/v1/sessions", {}, token)).json();

const goal =
  "Use the browser to open http://cloud:8787/demo and tell me the page's h1 text. Reply with only the h1 text.";
const { task } = await (await post(`/v1/sessions/${session.id}/messages`, { text: goal }, token)).json();
console.log(`[sandbox] task ${task.id}`);

const deadline = Date.now() + 120_000;
let current = task;
while (Date.now() < deadline) {
  if (current.status === "completed" || current.status === "failed") break;
  if (current.approval?.status === "pending") {
    console.log(`[sandbox] approving ${current.approval.title}`);
    await post(`/v1/tasks/${current.id}/approvals/${current.approval.id}`, { decision: "allow" }, token);
  }
  await sleep(800);
  current = await (await get(`/v1/tasks/${current.id}`, token)).json();
}

const steps = current.steps.map((s) => s.title);
console.log(`[sandbox] status: ${current.status}`);
console.log(`[sandbox] steps: ${steps.join(", ")}`);

const after0 = await (await get(`/v1/sessions/${session.id}`, token)).json();
let after = after0;
for (let i = 0; i < 20 && after.messages[after.messages.length - 1]?.role !== "assistant"; i += 1) {
  await sleep(500);
  after = await (await get(`/v1/sessions/${session.id}`, token)).json();
}
const reply = after.messages[after.messages.length - 1]?.content ?? "";
console.log(`[sandbox] reply: ${reply}`);

const shot = await get(`/v1/tasks/${current.id}/screenshot`, token);
console.log(`[sandbox] screenshot: ${shot.status} ${shot.headers.get("content-type")}`);

const usedBrowser = steps.some((t) => t.startsWith("browser."));
if (current.status !== "completed" || !usedBrowser || !/Botifyr Demo Page/i.test(reply) || !shot.ok) {
  console.error("[sandbox] FAILED");
  process.exit(1);
}
console.log("[sandbox] PASSED (containerized cloud reached the sandbox and browsed the page)");
