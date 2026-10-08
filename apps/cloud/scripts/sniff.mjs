#!/usr/bin/env node
/**
 * Deterministic media-URL sniffer.
 *
 * Runs the browser-sandbox image against a URL and prints the m3u8/mp4 network
 * requests it sees. No model, no cost — the tool for validating extraction on a
 * site yt-dlp doesn't support.
 *
 *   node apps/cloud/scripts/sniff.mjs https://www.goodshort.com/some-show
 *   node apps/cloud/scripts/sniff.mjs <url> --wait 6000
 *
 * Requires Docker. SPA players usually only fetch the stream after you press
 * play — for those, pass a larger --wait, or use the bot's `browser.sniff` tool
 * after driving the page.
 */
import { execFileSync } from "node:child_process";

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error("usage: node apps/cloud/scripts/sniff.mjs <http(s) url> [--wait <ms>]");
  process.exit(1);
}
const waitIndex = process.argv.indexOf("--wait");
const waitMs =
  waitIndex >= 0 ? Math.max(0, Math.min(30_000, Number(process.argv[waitIndex + 1]) || 3000)) : 3000;

const IMAGE = process.env.BOTIFYR_SANDBOX_IMAGE ?? "botifyr/browser-sandbox:1.63.0";
const PORT = 8799;
const NAME = "botifyr-sniff";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (args) => execFileSync("docker", args, { encoding: "utf8" });

const action = async (name, args) => {
  const response = await fetch(`http://localhost:${PORT}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: name, args }),
  });
  return response.json();
};

try {
  docker(["rm", "-f", NAME]);
} catch {
  // not running
}

console.log(`Starting ${IMAGE} …`);
docker(["run", "--rm", "-d", "--name", NAME, "-p", `${PORT}:8788`, IMAGE]);

try {
  let healthy = false;
  for (let attempt = 0; attempt < 40 && !healthy; attempt += 1) {
    try {
      healthy = (await fetch(`http://localhost:${PORT}/health`)).ok;
    } catch {
      // still booting
    }
    if (!healthy) await sleep(500);
  }
  if (!healthy) throw new Error("sandbox did not become healthy");

  const opened = await action("goto", { url });
  console.log(`goto: ${opened.output}`);

  const sniffed = await action("sniff", { waitMs });
  if (sniffed.ok) {
    console.log(`\nCaptured media URLs:\n${sniffed.output}`);
  } else {
    console.log(`\n${sniffed.output}`);
    console.log("(Tip: open the show and press play, then run sniff again — or use browser.sniff.)");
  }
} catch (error) {
  console.error(`sniff failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  try {
    docker(["rm", "-f", NAME]);
  } catch {
    // already gone
  }
}
