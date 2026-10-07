#!/usr/bin/env node
/**
 * Deterministic end-to-end check of the media download pipeline — NO model calls.
 *
 *   node apps/cloud/scripts/verify-media.mjs [media-url-or-page]
 *
 * Signs up (or logs in to) a throwaway account, creates a session, sends
 * "download <url>", approves the tool call, waits for the task and prints the
 * files it produced. Because the media request is planned deterministically
 * (see `planMedia`), the model is never consulted and no tokens are spent.
 *
 * Requires the cloud to be running (default http://localhost:8787).
 *
 * Env:
 *   BOTIFYR_CLOUD_URL  cloud base URL            (default http://localhost:8787)
 *   VERIFY_EMAIL       account email             (default verify-media@example.com)
 *   VERIFY_PASSWORD    account password (8+ chars)
 *   VERIFY_MEDIA_URL   URL to download           (default a small sample MP4)
 *
 * Exit code is 0 only when the task completed and at least one file was saved.
 */
const base = (process.env.BOTIFYR_CLOUD_URL ?? "http://localhost:8787").replace(/\/$/, "");
const email = process.env.VERIFY_EMAIL ?? "verify-media@example.com";
const password = process.env.VERIFY_PASSWORD ?? "password12345";
const mediaUrl =
  process.argv[2] ?? process.env.VERIFY_MEDIA_URL ?? "https://download.samplelib.com/mp4/sample-5s.mp4";

async function call(method, path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function authenticate() {
  try {
    return await call("POST", "/auth/login", { email, password });
  } catch {
    return await call("POST", "/auth/signup", { email, password });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { token } = await authenticate();
  const session = await call("POST", "/v1/sessions", {}, token);
  console.log(`session ${session.id}`);

  const { task } = await call(
    "POST",
    `/v1/sessions/${session.id}/messages`,
    { text: `download ${mediaUrl}` },
    token,
  );
  console.log(`task ${task.id}  target ${mediaUrl}`);

  for (let attempt = 0; attempt < 150; attempt += 1) {
    const current = await call("GET", `/v1/tasks/${task.id}`, undefined, token);
    const pending = current.approval?.status === "pending" ? current.approval : null;
    if (pending) {
      await call("POST", `/v1/tasks/${task.id}/approvals/${pending.id}`, { decision: "allow" }, token);
      console.log(`approved ${pending.id}`);
    }
    if (["completed", "failed", "cancelled"].includes(current.status)) {
      const steps = (current.steps ?? []).map((step) => `${step.title}:${step.status}`).join(" ");
      console.log(`status=${current.status} steps=[${steps}]`);
      if (current.error) console.log(`error: ${current.error}`);
      const downloads = await call("GET", `/v1/tasks/${task.id}/downloads`, undefined, token);
      console.log(`downloads: ${JSON.stringify(downloads)}`);
      const ok = current.status === "completed" && Array.isArray(downloads) && downloads.length > 0;
      process.exit(ok ? 0 : 1);
    }
    await sleep(2000);
  }

  console.error("timed out waiting for the task");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
