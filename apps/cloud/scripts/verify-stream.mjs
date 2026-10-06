/**
 * Verifies the live framebuffer stream (computer capability).
 *
 * Signs up, creates a computer-use task, waits until it pauses at the approval
 * gate (by which point the desktop container is up), reads the first chunk of
 * the MJPEG stream, then approves and waits for completion.
 *
 * Run with a computer-capable cloud (BOTIFYR_CAPABILITIES=computer).
 */

const base = process.env.CLOUD_URL ?? "http://localhost:8787";

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

await waitForHealth();

const signup = await fetch(`${base}/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: `stream+${Date.now()}@botifyr.test`, password: "stream-password-123" }),
});
const { token } = await signup.json();
const auth = { authorization: `Bearer ${token}` };

const session = await (await fetch(`${base}/v1/sessions`, { method: "POST", headers: auth })).json();

const socket = new WebSocket(`${base.replace(/^http/, "ws")}/v1/stream?token=${encodeURIComponent(token)}`);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let check = null;

const finished = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("timed out")), 120_000);

  socket.onmessage = async (message) => {
    const event = JSON.parse(message.data);

    if (event.type === "approval.requested") {
      try {
        const controller = new AbortController();
        const response = await fetch(`${base}/v1/tasks/${event.taskId}/stream`, {
          headers: auth,
          signal: controller.signal,
        });
        const contentType = response.headers.get("content-type") ?? "";
        const reader = response.body.getReader();
        const { value } = await reader.read();
        controller.abort();
        check = { contentType, bytes: value?.length ?? 0 };
        console.log(`[stream] content-type: ${contentType}`);
        console.log(`[stream] first chunk: ${value?.length ?? 0} bytes`);
      } catch (error) {
        check = { error: String(error?.message ?? error) };
        console.log(`[stream] error: ${check.error}`);
      }

      await fetch(`${base}/v1/tasks/${event.taskId}/approvals/${event.approval.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ decision: "allow" }),
      });
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

await fetch(`${base}/v1/sessions/${session.id}/tasks`, {
  method: "POST",
  headers: { "content-type": "application/json", ...auth },
  body: JSON.stringify({ goal: "Verify the live desktop stream" }),
});

await finished;
socket.close();

if (
  !check ||
  check.error ||
  !String(check.contentType).includes("multipart/x-mixed-replace") ||
  !check.bytes
) {
  console.error("[stream] FAILED");
  process.exit(1);
}

console.log("[stream] PASSED");
