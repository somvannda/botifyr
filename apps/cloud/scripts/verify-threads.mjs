/**
 * Verifies conversation threads: messages append to one conversation and the
 * model remembers earlier turns.
 */

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const email = `thread+${Date.now()}@botifyr.test`;
const password = "thread-password-123";

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
console.log(`[thread] session ${session.id} (${session.messages.length} messages)`);

async function say(sessionId, text) {
  const { task } = await (await post(`/v1/sessions/${sessionId}/messages`, { text }, token)).json();
  const deadline = Date.now() + 90_000;
  let current = task;
  while (Date.now() < deadline) {
    if (current.status === "completed" || current.status === "failed") break;
    if (current.approval?.status === "pending") {
      await post(`/v1/tasks/${current.id}/approvals/${current.approval.id}`, { decision: "allow" }, token);
    }
    await sleep(700);
    current = await (await get(`/v1/tasks/${current.id}`, token)).json();
  }
  return current;
}

await say(session.id, "My name is Duke and my favourite colour is teal.");
await say(session.id, "What is my name and favourite colour? Reply in one short sentence.");

const after = await (await get(`/v1/sessions/${session.id}`, token)).json();
console.log(`[thread] messages after 2 turns: ${after.messages.length}`);
for (const m of after.messages) console.log(`  ${m.role}: ${m.content.slice(0, 80)}`);

const last = after.messages[after.messages.length - 1];
const remembered = /duke/i.test(last?.content ?? "") && /teal/i.test(last?.content ?? "");

if (after.messages.length !== 4 || last?.role !== "assistant" || !remembered) {
  console.error("[thread] FAILED (no memory across turns)");
  process.exit(1);
}
console.log("[thread] PASSED (conversation persisted and the model remembered)");
