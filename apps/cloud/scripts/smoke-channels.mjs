/**
 * Milestone 5 smoke test: talk to the agent over a channel.
 *
 * Signs up, sends a message to the authenticated local chat channel, waits for
 * the approval prompt, approves by replying "allow", and waits for the result.
 */

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const email = `channel+${Date.now()}@botifyr.test`;
const password = "channel-password-123";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(retries = 30) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // not ready
    }
    await sleep(300);
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
console.log(`[channels] cloud reachable at ${base}`);

const signup = await post("/auth/signup", { email, password });
if (signup.status !== 201) throw new Error(`signup failed (${signup.status})`);
const { token } = await signup.json();
console.log(`[channels] account ${email}`);

await post("/channels/local/messages", { text: "Channel smoke test: run the loop" }, token);
console.log("[channels] sent a goal over chat");

async function waitForOutbound(includes, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await (await get("/channels/local/messages", token)).json();
    const match = messages.find((message) => message.direction === "out" && message.text.includes(includes));
    if (match) return { messages, match };
    await sleep(400);
  }
  throw new Error(`did not receive an outbound message containing "${includes}"`);
}

const approval = await waitForOutbound("Approval needed");
console.log("[channels] agent asked for approval over chat:");
console.log(`           ${approval.match.text.split("\n")[0]}`);

await post("/channels/local/messages", { text: "allow" }, token);
console.log("[channels] replied: allow");

const done = await waitForOutbound("Done:");
console.log(`[channels] final reply: ${done.match.text}`);
console.log(`[channels] total messages: ${done.messages.length}`);

console.log("[channels] PASSED");
