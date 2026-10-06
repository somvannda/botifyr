/**
 * Launch Chrome with remote debugging on the user's real profile, so Botifyr's
 * node can attach over CDP and drive the tabs you already have.
 *
 *   node scripts/chrome-debug.mjs
 *
 * IMPORTANT: quit Chrome first (all windows and the background process) so this
 * starts the browser with debugging enabled. Your session/tabs are restored from
 * the profile.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const candidates = [
  process.env.BOTIFYR_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);

const chrome = candidates.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error("Chrome not found. Set BOTIFYR_CHROME_PATH to the Chrome executable.");
  process.exit(1);
}

const profile =
  process.env.BOTIFYR_NODE_CHROME_PROFILE ??
  (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Google", "Chrome", "User Data")
    : path.join(os.homedir(), ".config", "google-chrome"));

const port = process.env.BOTIFYR_CDP_PORT ?? "9222";

spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
  detached: true,
  stdio: "ignore",
}).unref();

console.log(`Launched Chrome with remote debugging on ${port}.`);
console.log(`Profile: ${profile}`);
console.log("If Chrome was already running, quit it fully first so debugging starts.");
console.log("The Botifyr node will attach automatically on the next browser step.");
