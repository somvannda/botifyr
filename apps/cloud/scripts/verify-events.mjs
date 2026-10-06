/**
 * Verifies the client receives a `session.updated` event (with the assistant
 * reply) over the websocket — i.e. replies appear without sending again.
 */

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const email = `events+${Date.now()}@botifyr.test`;
const password = "events-password-123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = (p, b, t) =>
  fetch(`${base}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(b ?? {}),
  });

for (let i = 0; i < 40; i += 1) {
  try {
    if ((await fetch(`${base}/health`)).ok) break;
  } catch {
    /* wait */
  }
  await sleep(300);
}

const { token } = await (await post("/auth/signup", { email, password })).json();
const session = await (await post("/v1/sessions", {}, token)).json();

const socket = new WebSocket(`${base.replace(/^http/, "ws")}/v1/stream?token=${encodeURIComponent(token)}`);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let sessionUpdates = 0;
let assistantSeen = false;
socket.onmessage = (message) => {
  const event = JSON.parse(message.data);
  if (event.type === "session.updated") {
    sessionUpdates += 1;
    if (event.session.messages.some((m) => m.role === "assistant")) assistantSeen = true;
  }
};

await post(`/v1/sessions/${session.id}/messages`, { text: "hello" }, token);

const deadline = Date.now() + 60_000;
while (Date.now() < deadline && !assistantSeen) await sleep(300);
socket.close();

console.log(`[events] session.updated received: ${sessionUpdates}`);
console.log(`[events] assistant reply delivered live: ${assistantSeen}`);

if (!assistantSeen) {
  console.error("[events] FAILED (assistant reply was not pushed over the websocket)");
  process.exit(1);
}
console.log("[events] PASSED");
