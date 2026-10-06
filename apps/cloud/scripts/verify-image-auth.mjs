/**
 * Verifies the image-auth fix: `<img>` tags can load protected images by passing
 * the token as a query parameter, and requests with no token are still rejected.
 */

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const email = `img+${Date.now()}@botifyr.test`;
const password = "image-password-123";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(retries = 30) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
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
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
}

async function get(path, token) {
  return fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

await waitForHealth();
console.log(`[img] cloud reachable at ${base}`);

const { token } = await (await post("/auth/signup", { email, password })).json();

const config = await (await get("/v1/config", token)).json();
console.log(`[img] config: ${JSON.stringify(config)}`);

const session = await (await post("/v1/sessions", {}, token)).json();
let current = await (
  await post(`/v1/sessions/${session.id}/tasks`, { goal: "image auth test" }, token)
).json();

for (let attempt = 0; attempt < 120; attempt += 1) {
  if (current.status === "completed" || current.status === "failed") break;
  if (current.approval?.status === "pending") {
    await post(`/v1/tasks/${current.id}/approvals/${current.approval.id}`, { decision: "allow" }, token);
  }
  await sleep(500);
  current = await (await get(`/v1/tasks/${current.id}`, token)).json();
}
console.log(`[img] task ${current.id} (${current.status})`);

const withToken = await fetch(`${base}/v1/tasks/${current.id}/screenshot?token=${encodeURIComponent(token)}`);
const contentType = withToken.headers.get("content-type") ?? "";
console.log(`[img] screenshot with ?token= -> ${withToken.status} ${contentType}`);

const noAuth = await fetch(`${base}/v1/tasks/${current.id}/screenshot`);
console.log(`[img] screenshot with no token -> ${noAuth.status}`);

if (withToken.status !== 200 || !contentType.includes("image/png") || noAuth.status !== 401) {
  console.error("[img] FAILED");
  process.exit(1);
}

console.log("[img] PASSED");
