/**
 * Confirms the signup -> login flow against the running cloud.
 *   node scripts/verify-login.mjs
 */

const base = process.env.CLOUD_URL ?? "http://localhost:8787";
const email = `login+${Date.now()}@botifyr.test`;
const password = "login-password-123";

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const signup = await post("/auth/signup", { email, password });
console.log(`[login] signup -> ${signup.status}`);

const login = await post("/auth/login", { email, password });
const body = await login.json();
console.log(`[login] login (correct password) -> ${login.status} token=${body.token ? "yes" : "no"}`);

const wrong = await post("/auth/login", { email, password: "definitely-wrong" });
console.log(`[login] login (wrong password) -> ${wrong.status}`);

if (signup.status !== 201 || login.status !== 200 || !body.token || wrong.status !== 401) {
  console.error("[login] FAILED");
  process.exit(1);
}
console.log("[login] PASSED");
