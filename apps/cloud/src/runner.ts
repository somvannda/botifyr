import { randomUUID } from "node:crypto";
import type { ServerEvent, Task } from "@botifyr/shared";
import {
  createBrowserBackend,
  createBrowserTools,
  createComputerTools,
  createDockerComputerBackend,
  createDockerShellBackend,
  createMediaTools,
  createProvider,
  createShellTools,
  runAgent,
  withResponseCache,
  type ModelProvider,
  type StepUpdate,
  type ToolDefinition,
} from "@botifyr/agent-core";
import { emit } from "./events.js";
import { clearComputerSandbox, setComputerSandbox, setScreenshot, waitForApproval } from "./runtime.js";
import { createConnectionTools } from "./connections-tools.js";
import { createFileTools } from "./files-tools.js";
import { createGithubTools } from "./github-tools.js";
import { createNotionTools, createSlackTools, createTelegramTools } from "./token-apps-tools.js";
import { decryptSecret } from "./vault.js";
import { createLocalTools, nodeInfo } from "./nodes.js";
import type { Store } from "./store/index.js";

export interface RunnerDeps {
  store: Store;
  userId: string;
  /** Prior conversation turns for context. */
  history?: { role: "user" | "assistant"; content: string }[];
  /** When true, run on the user's own computer (local node) with local tools only. */
  local?: boolean;
  /** Standing instructions for the bot that owns this conversation. */
  instructions?: string;
  /** Rolling summary of older turns (memory for long chats). */
  summary?: string;
  /** Identity of the bot authoring this reply (used to attribute group messages). */
  author?: { id: string };
  /** Vault key, so connected-app tools can read stored OAuth tokens. */
  vaultKey?: Buffer;
  /** If this returns true for the reply, do not append it (autonomous group skip). */
  suppressIf?: (reply: string) => boolean;
}

type Capability = "browser" | "computer" | "code";

function sandboxMode(): "local" | "docker" {
  return process.env.BOTIFYR_SANDBOX === "docker" ? "docker" : "local";
}

function capabilities(): Capability[] {
  const raw = process.env.BOTIFYR_CAPABILITIES ?? "browser";
  const list = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const valid = list.filter(
    (entry): entry is Capability => entry === "browser" || entry === "computer" || entry === "code",
  );
  return valid.length > 0 ? valid : ["browser"];
}

let provider: ModelProvider | null = null;

function getProvider(): ModelProvider {
  if (!provider) {
    const port = process.env.PORT ?? 8787;
    const hostForBrowser = sandboxMode() === "docker" ? "host.docker.internal" : "localhost";
    const base = createProvider({
      provider: process.env.BOTIFYR_PROVIDER,
      model: process.env.BOTIFYR_MODEL,
      apiKey: process.env.BOTIFYR_API_KEY,
      baseUrl: process.env.BOTIFYR_BASE_URL,
      demoUrl: process.env.BOTIFYR_DEMO_URL ?? `http://${hostForBrowser}:${port}/demo`,
    });
    // Exact-match response cache: a cache hit costs zero tokens. 0 disables.
    provider = withResponseCache(base, Number(process.env.BOTIFYR_CACHE_TTL_SECONDS ?? 300));
  }
  return provider;
}

/** Summarize older turns cheaply so long chats keep their memory. */
export async function summarizeConversation(text: string): Promise<string> {
  const maxTokens = Number(process.env.BOTIFYR_SUMMARY_MAX_TOKENS ?? 300);
  try {
    const response = await getProvider().complete({
      messages: [
        {
          role: "system",
          content:
            "You compress conversation history. Preserve names, facts, decisions, preferences and open tasks. Reply with a concise summary and nothing else.",
        },
        { role: "user", content: text },
      ],
      tools: [],
      maxTokens,
    });
    return (response.text ?? "").trim().slice(0, 2000);
  } catch {
    return "";
  }
}

export function runtimeInfo(): {
  provider: string;
  demo: boolean;
  capabilities: Capability[];
  sandbox: "local" | "docker";
} {
  const active = getProvider();
  return {
    provider: active.name,
    demo: active.name === "mock",
    capabilities: capabilities(),
    sandbox: sandboxMode(),
  };
}

function upsertStep(task: Task, update: StepUpdate): void {
  const now = new Date().toISOString();
  const existing = task.steps.find((step) => step.id === update.id);
  if (!existing) {
    task.steps.push({
      id: update.id,
      index: task.steps.length,
      title: update.title,
      detail: update.detail,
      status: update.status,
      startedAt: update.status === "running" ? now : undefined,
      finishedAt: update.status === "running" ? undefined : now,
    });
    return;
  }
  existing.title = update.title;
  if (update.detail !== undefined) existing.detail = update.detail;
  existing.status = update.status;
  if (update.status === "running" && !existing.startedAt) existing.startedAt = now;
  if (update.status !== "running") existing.finishedAt = now;
}

function buildTools(
  store: Store,
  task: Task,
  userId: string,
  local: boolean,
  vaultKey?: Buffer,
): { tools: ToolDefinition[]; closers: Array<() => Promise<void>>; hasComputer: boolean } {
  // "Run on my computer": use only the user's own machine tools.
  if (local && nodeInfo(userId).online) {
    return { tools: createLocalTools(userId), closers: [], hasComputer: false };
  }

  const caps = capabilities();
  const tools: ToolDefinition[] = [];
  const closers: Array<() => Promise<void>> = [];
  let hasComputer = false;

  if (caps.includes("browser")) {
    const browser = createBrowserTools(createBrowserBackend({ mode: sandboxMode() }));
    tools.push(...browser.tools);
    closers.push(() => browser.close());
  }
  if (caps.includes("computer")) {
    const backend = createDockerComputerBackend();
    const computer = createComputerTools(backend);
    tools.push(...computer.tools);
    closers.push(() => computer.close());
    setComputerSandbox(task.id, backend);
    hasComputer = true;
  }
  if (caps.includes("code")) {
    const downloadsVolume = process.env.BOTIFYR_DOWNLOADS_VOLUME ?? "botifyr-downloads";
    const downloadsDir = process.env.BOTIFYR_DOWNLOADS_DIR ?? "/downloads";
    const shellBackend = createDockerShellBackend({ volumes: [`${downloadsVolume}:${downloadsDir}`] });
    const shell = createShellTools(shellBackend);
    tools.push(...shell.tools);
    closers.push(() => shell.close());
    // Media (yt-dlp) tools save into the shared downloads volume, which the
    // cloud serves back to the user via /v1/tasks/:id/downloads. If the user
    // stored YouTube cookies (Vault: YOUTUBE_COOKIES), pass them to yt-dlp.
    const getCookies = vaultKey
      ? async (): Promise<string | null> => {
          const record = await store.getSecret(userId, "YOUTUBE_COOKIES");
          if (!record) return null;
          try {
            return decryptSecret(vaultKey, record);
          } catch {
            return null;
          }
        }
      : undefined;
    tools.push(...createMediaTools(shellBackend, `${downloadsDir}/${task.id}`, getCookies).tools);
  }
  // Local tools operate the user's own machine; only when their node is online.
  if (nodeInfo(userId).online) {
    tools.push(...createLocalTools(userId));
  }
  return { tools, closers, hasComputer };
}

export async function runTask(deps: RunnerDeps, task: Task): Promise<void> {
  const { store, userId, history } = deps;

  task.status = "running";
  task.steps = [];
  task.updatedAt = new Date().toISOString();
  await store.updateTask(task);
  emit({ type: "task.updated", task });

  const { tools, closers, hasComputer } = buildTools(store, task, userId, Boolean(deps.local), deps.vaultKey);
  // Connected-app tools (Gmail / Calendar / Drive) when the user has linked any.
  if (deps.vaultKey) {
    const connections = await store.listConnections(userId).catch(() => []);
    const providers = new Set(connections.map((connection) => connection.provider));
    if (connections.length > 0) tools.push(...createConnectionTools(store, deps.vaultKey, userId));
    if (providers.has("github")) tools.push(...createGithubTools(store, deps.vaultKey, userId));
    if (providers.has("slack")) tools.push(...createSlackTools(store, deps.vaultKey, userId));
    if (providers.has("notion")) tools.push(...createNotionTools(store, deps.vaultKey, userId));
    if (providers.has("telegram")) tools.push(...createTelegramTools(store, deps.vaultKey, userId));
  }
  // Library tools: the authoring bot can read/write its own files.
  if (deps.author) tools.push(...createFileTools(store, deps.author.id, userId));
  const localInstruction =
    deps.local && nodeInfo(userId).online
      ? "The user has explicitly enabled their own computer for this request. Perform it on their machine using the local.browser.* and local.shell/local.file tools."
      : undefined;
  const instructions = [deps.instructions, localInstruction].filter(Boolean).join(" ") || undefined;
  if (hasComputer) {
    task.liveStream = true;
    task.updatedAt = new Date().toISOString();
    await store.updateTask(task);
    emit({ type: "task.updated", task });
  }

  let chain = Promise.resolve();
  const queue = (event: ServerEvent): void => {
    chain = chain
      .then(async () => {
        task.updatedAt = new Date().toISOString();
        await store.updateTask(task);
        emit(event);
      })
      .catch(() => {});
  };
  const audit = (type: "tool" | "approval" | "task", toolName: string | null, detail: string): void => {
    chain = chain
      .then(() =>
        store.appendAudit({
          id: randomUUID(),
          taskId: task.id,
          userId,
          type,
          toolName,
          detail,
          createdAt: new Date().toISOString(),
        }),
      )
      .catch(() => {});
  };

  let reply = "";
  let ok = false;

  try {
    const result = await runAgent({
      goal: task.goal,
      history,
      instructions,
      summary: deps.summary,
      provider: getProvider(),
      tools,
      workspaceDir: process.cwd(),
      maxSteps: Number(process.env.BOTIFYR_MAX_STEPS ?? 12),
      maxTokens: Number(process.env.BOTIFYR_MAX_OUTPUT_TOKENS ?? 1024),
      requestApproval: async (title, description, risk) => {
        const approval = {
          id: randomUUID(),
          taskId: task.id,
          title,
          description,
          risk,
          status: "pending" as const,
          createdAt: new Date().toISOString(),
        };
        task.approval = approval;
        task.status = "awaiting_approval";
        await store.updateTask(task);
        emit({ type: "task.updated", task });
        emit({ type: "approval.requested", taskId: task.id, approval });
        audit("approval", null, `${title}: ${description}`);

        const resolved = await waitForApproval(approval.id);
        task.approval = resolved;
        task.status = "running";
        return resolved.status === "allowed";
      },
      onStep: (step) => {
        upsertStep(task, step);
        queue({ type: "task.updated", task });
        if (step.status !== "running" && step.title.includes("."))
          audit("tool", step.title, step.detail ?? "");
      },
      onToken: (delta) => {
        emit({
          type: "assistant.delta",
          sessionId: task.sessionId,
          taskId: task.id,
          botId: deps.author?.id,
          text: delta,
        });
      },
      onScreenshot: (png) => {
        setScreenshot(task.id, png);
        task.screenshotAt = new Date().toISOString();
        queue({ type: "task.updated", task });
      },
    });

    await chain;
    ok = result.ok;
    reply = result.summary;

    // Best-effort cost accounting: never let a failed write break the task.
    try {
      if (result.usage && (result.usage.promptTokens > 0 || result.usage.completionTokens > 0)) {
        await store.addUsage({
          id: randomUUID(),
          userId,
          taskId: task.id,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      // usage recording is best-effort
    }
    task.status = ok ? "completed" : "failed";
    if (ok) task.result = reply;
    else task.error = reply;
    task.updatedAt = new Date().toISOString();
    await store.updateTask(task);
    emit(ok ? { type: "task.completed", task } : { type: "task.failed", task });
    audit("task", null, ok ? "completed" : `failed: ${reply}`);
  } finally {
    await Promise.all(closers.map((close) => close()));
    if (hasComputer) {
      clearComputerSandbox(task.id);
      task.liveStream = false;
      task.updatedAt = new Date().toISOString();
      await store.updateTask(task);
      emit({ type: "task.updated", task });
    }
  }

  // Append the assistant's reply to the conversation transcript.
  try {
    const session = await store.getSession(task.sessionId);
    if (session && !deps.suppressIf?.(reply)) {
      session.messages.push({
        id: randomUUID(),
        role: "assistant",
        content: ok ? reply : `Something went wrong: ${reply}`,
        createdAt: new Date().toISOString(),
        taskId: task.id,
        botId: deps.author?.id,
      });
      await store.updateSession(session);
      emit({ type: "session.updated", session });
    }
  } catch {
    // transcript update is best-effort
  }
}
