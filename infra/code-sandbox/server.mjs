import http from "node:http";
import nodePath from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

/**
 * Code sandbox service.
 *
 * Runs inside the per-task container. Exposes:
 *
 *   GET  /health   -> "ok"
 *   POST /action   -> { ok, output }
 *        { action: "exec" | "read" | "write" | "list", args }
 *
 * Commands run with `sh -c` in /workspace; file paths are confined to it.
 */

const execFileAsync = promisify(execFile);
const WORKSPACE = nodePath.resolve(process.env.WORKSPACE ?? "/workspace");
const PORT = Number(process.env.PORT ?? 8792);
const MAX_OUTPUT = 200_000;

function resolveSafe(relative) {
  const target = nodePath.resolve(WORKSPACE, relative ?? ".");
  if (target !== WORKSPACE && !target.startsWith(WORKSPACE + nodePath.sep)) {
    throw new Error("path escapes the workspace");
  }
  return target;
}

const actions = {
  async exec({ command }) {
    const cmd = String(command ?? "");
    try {
      const { stdout, stderr } = await execFileAsync("sh", ["-c", cmd], {
        cwd: WORKSPACE,
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const output = `$ ${cmd}\n${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trimEnd();
      return { ok: true, output: output.slice(0, MAX_OUTPUT) };
    } catch (error) {
      const output = `$ ${cmd}\n${error?.stdout ?? ""}${error?.stderr ?? error?.message ?? error}`.trimEnd();
      return { ok: false, output: output.slice(0, MAX_OUTPUT) };
    }
  },

  async read({ path }) {
    const target = resolveSafe(path);
    const content = await readFile(target, "utf8");
    return { ok: true, output: content.slice(0, MAX_OUTPUT) };
  },

  async write({ path, content }) {
    const target = resolveSafe(path);
    await mkdir(nodePath.dirname(target), { recursive: true });
    const body = String(content ?? "");
    await writeFile(target, body, "utf8");
    return { ok: true, output: `Wrote ${Buffer.byteLength(body)} bytes to ${path}` };
  },

  async list({ path }) {
    const target = resolveSafe(path ?? ".");
    const entries = await readdir(target, { withFileTypes: true });
    const lines = entries.map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`);
    return { ok: true, output: lines.join("\n") || "(empty)" };
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

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`botifyr code sandbox listening on ${PORT} (workspace ${WORKSPACE})`);
});
