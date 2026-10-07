import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

/**
 * Desktop sandbox service.
 *
 * Starts a virtual X desktop (Xvfb + openbox + an xterm) with a web browser,
 * then exposes:
 *
 *   GET  /health     -> "ok"
 *   GET  /stream     -> live MJPEG stream of the framebuffer
 *   GET  /recording  -> the latest screen recording (MP4), for teach-by-demo
 *   POST /action     -> { ok, output, screenshot? } for computer-use actions
 *        { action: "screenshot" | "move" | "click" | "type" | "key" | "scroll"
 *                  | "record_start" | "record_stop", args }
 *
 * Input is driven with xdotool; frames are grabbed with ffmpeg's x11grab.
 */

const execFileAsync = promisify(execFile);

const DISPLAY = process.env.DISPLAY ?? ":99";
const WIDTH = Number(process.env.SCREEN_WIDTH ?? 1280);
const HEIGHT = Number(process.env.SCREEN_HEIGHT ?? 800);
const SIZE = `${WIDTH}x${HEIGHT}`;
const PORT = Number(process.env.PORT ?? 8790);
const ENV = { ...process.env, DISPLAY };

const children = [];
let recorder = null;
let lastRecording = null;

function spawnBg(command, args) {
  const child = spawn(command, args, { env: ENV, stdio: "ignore" });
  child.on("error", () => {});
  children.push(child);
  return child;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stopAll() {
  for (const child of children) {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}
process.on("SIGTERM", () => {
  stopAll();
  process.exit(0);
});
process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});

async function startDesktop() {
  spawnBg("Xvfb", [DISPLAY, "-screen", "0", `${SIZE}x24`, "-nolisten", "tcp"]);

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await execFileAsync("xdpyinfo", [], { env: ENV });
      break;
    } catch {
      await sleep(250);
    }
    if (attempt === 79) throw new Error("X display did not become ready");
  }

  spawnBg("openbox", []);
  spawnBg("xterm", ["-geometry", "100x30+40+40", "-fa", "Monospace", "-fs", "12"]);
  // A browser so the user can drive sites (and teach a task) on the desktop.
  spawnBg("chromium", [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--start-maximized",
    "about:blank",
  ]);
  await sleep(1500); // let the windows map
}

async function xdotool(args) {
  await execFileAsync("xdotool", args, { env: ENV });
}

async function grab(format) {
  const codec = format === "jpeg" ? ["-vcodec", "mjpeg", "-q:v", "6"] : ["-vcodec", "png"];
  const { stdout } = await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "x11grab",
      "-draw_mouse",
      "1",
      "-video_size",
      SIZE,
      "-i",
      DISPLAY,
      "-frames:v",
      "1",
      "-f",
      "image2",
      ...codec,
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, env: ENV },
  );
  return stdout;
}

async function frame() {
  return (await grab("png")).toString("base64");
}

const actions = {
  async screenshot() {
    return { ok: true, output: "Captured a screenshot of the desktop.", screenshot: await frame() };
  },

  async move({ x, y }) {
    await xdotool(["mousemove", "--sync", String(Math.round(x)), String(Math.round(y))]);
    return {
      ok: true,
      output: `Moved the cursor to (${Math.round(x)}, ${Math.round(y)}).`,
      screenshot: await frame(),
    };
  },

  async click({ x, y, button = 1 }) {
    await xdotool([
      "mousemove",
      "--sync",
      String(Math.round(x)),
      String(Math.round(y)),
      "click",
      String(button),
    ]);
    await sleep(200);
    return { ok: true, output: `Clicked (${Math.round(x)}, ${Math.round(y)}).`, screenshot: await frame() };
  },

  async type({ text }) {
    await xdotool(["type", "--delay", "30", "--", String(text)]);
    await sleep(150);
    return { ok: true, output: `Typed: ${text}`, screenshot: await frame() };
  },

  async key({ key }) {
    await xdotool(["key", String(key)]);
    await sleep(150);
    return { ok: true, output: `Pressed key: ${key}`, screenshot: await frame() };
  },

  async scroll({ amount = 3 }) {
    const button = amount < 0 ? "4" : "5";
    for (let i = 0; i < Math.abs(amount); i += 1) {
      await xdotool(["click", button]);
    }
    return { ok: true, output: `Scrolled ${amount}.`, screenshot: await frame() };
  },

  async record_start() {
    if (recorder) return { ok: true, output: `Already recording → ${recorder.path}` };
    const path = `/tmp/recording-${Date.now()}.mp4`;
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "x11grab",
        "-framerate",
        "15",
        "-video_size",
        SIZE,
        "-i",
        DISPLAY,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        path,
      ],
      { env: ENV, stdio: "ignore" },
    );
    child.on("error", () => {});
    children.push(child);
    recorder = { child, path };
    return { ok: true, output: `Recording started → ${path}` };
  },

  async record_stop() {
    if (!recorder) return { ok: false, output: "Not recording." };
    const { child, path } = recorder;
    recorder = null;
    try {
      child.kill("SIGINT");
    } catch {
      // already gone
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null || child.signalCode) break;
      await sleep(100);
    }
    lastRecording = path;
    return { ok: true, output: `Recording saved → ${path}` };
  },
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}

function sendJson(response, payload) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function handleStream(response) {
  response.writeHead(200, {
    "content-type": "multipart/x-mixed-replace; boundary=frame",
    "cache-control": "no-store",
    connection: "close",
  });

  let closed = false;
  response.on("close", () => {
    closed = true;
  });

  while (!closed) {
    try {
      const jpeg = await grab("jpeg");
      response.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
      response.write(jpeg);
      response.write("\r\n");
    } catch {
      // keep the stream alive across a failed frame
    }
    await sleep(500);
  }
  response.end();
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  if (request.method === "GET" && request.url === "/stream") {
    await handleStream(response);
    return;
  }

  if (request.method === "GET" && request.url === "/recording") {
    const info = lastRecording ? await stat(lastRecording).catch(() => null) : null;
    if (!lastRecording || !info) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("no recording");
      return;
    }
    response.writeHead(200, { "content-type": "video/mp4", "content-length": info.size });
    createReadStream(lastRecording).pipe(response);
    return;
  }

  if (request.method === "POST" && request.url === "/action") {
    try {
      const body = JSON.parse((await readBody(request)) || "{}");
      const handler = actions[body.action];
      if (!handler) {
        sendJson(response, { ok: false, output: `Unknown action "${body.action}".` });
        return;
      }
      sendJson(response, await handler(body.args ?? {}));
    } catch (error) {
      sendJson(response, { ok: false, output: `Error: ${error?.message ?? error}` });
    }
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

await startDesktop();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`botifyr desktop sandbox listening on ${PORT} (${SIZE})`);
});
