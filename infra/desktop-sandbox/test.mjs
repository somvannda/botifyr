/**
 * Container-level test of the desktop sandbox (no agent involved).
 *
 * Assumes a desktop container is reachable at DESKTOP_URL (default
 * http://127.0.0.1:8790). Captures a "before" screenshot, focuses the terminal,
 * types a command, runs it, and captures an "after" screenshot.
 */

import { writeFile } from "node:fs/promises";

const base = (process.env.DESKTOP_URL ?? "http://127.0.0.1:8790").replace(/\/$/, "");

async function action(name, args = {}) {
  const response = await fetch(`${base}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: name, args }),
  });
  return response.json();
}

async function waitForReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`desktop sandbox not reachable at ${base}`);
}

await waitForReady();
console.log("[desktop] sandbox ready");

const before = await action("screenshot");
await writeFile("../../docs/assets/desktop-before.png", Buffer.from(before.screenshot, "base64"));
console.log(`[desktop] before: ${before.output}`);

await action("click", { x: 300, y: 150 });
await action("type", { text: "echo hello from botifyr" });
await action("key", { key: "Return" });
await new Promise((resolve) => setTimeout(resolve, 500));

const after = await action("screenshot");
await writeFile("../../docs/assets/desktop-after.png", Buffer.from(after.screenshot, "base64"));
console.log(`[desktop] after: ${after.output}`);

console.log("[desktop] PASSED");
