import { randomUUID } from "node:crypto";
import type { ToolDefinition, ToolResult } from "@botifyr/agent-core";

/**
 * Local-node registry.
 *
 * A node is a small process the user runs on their own machine (the desktop app
 * starts it automatically) that connects outbound to the cloud and exposes a
 * browser there. A user may briefly have more than one connection while
 * reconnecting, so we keep all of them and treat the user as "online" if any is
 * present, using the most recent for requests.
 */

interface NodeSocket {
  send(data: string): void;
  close?(): void;
}

interface NodeResult {
  ok: boolean;
  output: string;
  screenshot?: string;
}

interface Pending {
  resolve: (result: NodeResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Connection {
  id: string;
  userId: string;
  name: string;
  platform: string;
  socket: NodeSocket;
  pending: Map<string, Pending>;
  connectedAt: number;
}

const byId = new Map<string, Connection>();
const byUser = new Map<string, Set<string>>();

export function registerNode(
  userId: string,
  socket: NodeSocket,
  name: string,
  platform: string,
): { id: string; unregister: () => void } {
  const id = randomUUID();
  const connection: Connection = {
    id,
    userId,
    name,
    platform,
    socket,
    pending: new Map(),
    connectedAt: Date.now(),
  };
  byId.set(id, connection);
  const set = byUser.get(userId) ?? new Set<string>();
  set.add(id);
  byUser.set(userId, set);

  return {
    id,
    unregister: () => {
      for (const entry of connection.pending.values()) clearTimeout(entry.timer);
      connection.pending.clear();
      byId.delete(id);
      const current = byUser.get(userId);
      if (current) {
        current.delete(id);
        if (current.size === 0) byUser.delete(userId);
      }
    },
  };
}

function latestFor(userId: string): Connection | null {
  const ids = byUser.get(userId);
  if (!ids || ids.size === 0) return null;
  let latest: Connection | null = null;
  for (const id of ids) {
    const connection = byId.get(id);
    if (connection && (!latest || connection.connectedAt > latest.connectedAt)) latest = connection;
  }
  return latest;
}

export function nodeInfo(userId: string): { online: boolean; name?: string; platform?: string } {
  const connection = latestFor(userId);
  return connection
    ? { online: true, name: connection.name, platform: connection.platform }
    : { online: false };
}

export function handleNodeMessage(connectionId: string, message: unknown): void {
  const connection = byId.get(connectionId);
  if (!connection || typeof message !== "object" || message === null) return;
  const msg = message as Record<string, unknown>;

  if (msg.type === "node.hello") {
    if (typeof msg.name === "string") connection.name = msg.name;
    if (typeof msg.platform === "string") connection.platform = msg.platform;
    return;
  }

  if (msg.type === "node.result" && typeof msg.id === "string") {
    const entry = connection.pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    connection.pending.delete(msg.id);
    entry.resolve({
      ok: msg.ok === true,
      output: typeof msg.output === "string" ? msg.output : "",
      screenshot: typeof msg.screenshot === "string" ? msg.screenshot : undefined,
    });
  }
}

export function invokeNode(
  userId: string,
  action: string,
  args: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<NodeResult> {
  const connection = latestFor(userId);
  if (!connection) return Promise.reject(new Error("no local node is connected"));

  const id = randomUUID();
  return new Promise<NodeResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      connection.pending.delete(id);
      reject(new Error(`local node timed out on "${action}"`));
    }, timeoutMs);
    connection.pending.set(id, { resolve, timer });
    try {
      connection.socket.send(JSON.stringify({ type: "node.request", id, action, args }));
    } catch (error) {
      clearTimeout(timer);
      connection.pending.delete(id);
      reject(error as Error);
    }
  });
}

/** Tools that operate the user's own machine, available only when a node is online. */
export function createLocalBrowserTools(userId: string): ToolDefinition[] {
  const call = async (action: string, args: Record<string, unknown>): Promise<ToolResult> => {
    const result = await invokeNode(userId, action, args);
    return {
      ok: result.ok,
      output: result.output,
      screenshot: result.screenshot ? Buffer.from(result.screenshot, "base64") : undefined,
    };
  };

  return [
    {
      name: "local.browser.goto",
      description:
        "Open a URL in a browser on the USER'S OWN computer (they can see it). Use this when the user asks to do something on their machine.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      run: (args) => call("goto", { url: String(args.url) }),
    },
    {
      name: "local.browser.extract",
      description: "Read the text of an element in the user's local browser.",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
      run: (args) => call("extract", { selector: String(args.selector) }),
    },
    {
      name: "local.browser.type",
      description: "Type text into the user's local browser.",
      parameters: {
        type: "object",
        properties: { selector: { type: "string" }, text: { type: "string" } },
        required: ["selector", "text"],
      },
      run: (args) => call("type", { selector: String(args.selector), text: String(args.text) }),
    },
    {
      name: "local.browser.click",
      description: "Click an element in the user's local browser (consequential; requires approval).",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
      requiresApproval: true,
      run: (args) => call("click", { selector: String(args.selector) }),
    },
    {
      name: "local.browser.screenshot",
      description: "Capture a screenshot of the user's local browser.",
      parameters: { type: "object", properties: {} },
      run: () => call("screenshot", {}),
    },
  ];
}

/** Shell + file tools that run on the user's own machine. */
export function createLocalShellTools(userId: string): ToolDefinition[] {
  const call = async (action: string, args: Record<string, unknown>): Promise<ToolResult> => {
    const result = await invokeNode(userId, action, args);
    return { ok: result.ok, output: result.output };
  };

  return [
    {
      name: "local.shell.exec",
      description:
        "Run a shell command on the USER'S OWN computer (e.g. to list/launch installed apps). Read-only commands run immediately; anything else requires approval.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      requiresApproval: (args) => !isTrustedCommand(String(args.command ?? "")),
      run: (args) => call("exec", { command: String(args.command) }),
    },
    {
      name: "local.app.open",
      description: "Open an application on the user's computer by name (e.g. 'notepad', 'chrome', 'calc').",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      run: (args) => call("open", { name: String(args.name) }),
    },
    {
      name: "local.file.read",
      description: "Read a text file on the user's computer.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      run: (args) => call("read", { path: String(args.path) }),
    },
    {
      name: "local.file.write",
      description: "Write a text file on the user's computer.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      run: (args) => call("write", { path: String(args.path), content: String(args.content ?? "") }),
    },
    {
      name: "local.file.list",
      description: "List a directory on the user's computer.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      run: (args) => call("list", { path: String(args.path) }),
    },
  ];
}

/**
 * Read-only commands that run without an approval prompt. Deliberately strict:
 * any shell operator (pipes, redirects, chaining) forces approval.
 */
const TRUSTED_COMMANDS = new Set([
  "where",
  "dir",
  "echo",
  "type",
  "whoami",
  "ver",
  "tasklist",
  "hostname",
  "ipconfig",
  "tree",
  "find",
  "findstr",
  "systeminfo",
  "set",
  "ls",
  "pwd",
  "cat",
  "which",
  "uname",
  "who",
]);

function isTrustedCommand(command: string): boolean {
  const trimmed = command.trim();
  if (/[;&|<>`$(){}]/.test(trimmed)) return false;
  const first = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  return TRUSTED_COMMANDS.has(first);
}

/** All tools that operate the user's own machine. */
export function createLocalTools(userId: string): ToolDefinition[] {
  return [...createLocalBrowserTools(userId), ...createLocalShellTools(userId)];
}
