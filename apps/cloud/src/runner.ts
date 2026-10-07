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
import { companyContext, isBudgetExhausted } from "./company.js";
import { createCompanyTools } from "./company-tools.js";
import { createDelegationTools } from "./delegation-tools.js";
import { createSocialTools, notConnectedSocial } from "./social-tools.js";
import { createDesignTools } from "./design-tools.js";
import { removeDeniedTools } from "./tool-capabilities.js";
import {
  clearComputerSandbox,
  clearTaskCancel,
  clearTaskRunning,
  isTaskCancelled,
  markTaskRunning,
  setComputerSandbox,
  setScreenshot,
  setTaskAbort,
  waitForApproval,
  withSessionLock,
} from "./runtime.js";
import { createConnectionTools } from "./connections-tools.js";
import { createFileTools } from "./files-tools.js";
import { createGithubTools } from "./github-tools.js";
import { createHistoryTools } from "./history-tools.js";
import { createLearnedSkillTools } from "./learned-skills-tools.js";
import { createNotionTools, createSlackTools, createTelegramTools } from "./token-apps-tools.js";
import { decryptSecret } from "./vault.js";
import { createLocalTools, nodeInfo } from "./nodes.js";
import { priceFor } from "./billing.js";
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
  /** When true, skip approval prompts for this bot (run consequential tools directly). */
  autoApprove?: boolean;
  /** A deterministic first tool call (e.g. download pasted links) before the model runs. */
  initialToolCall?: { name: string; arguments: Record<string, unknown> };
  /** When true, run initialToolCall and finish without consulting the model. */
  initialToolOnly?: boolean;
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

/** A single tool-less completion, for planning tasks (e.g. company onboarding). */
export async function oneShot(input: { system: string; user: string; maxTokens: number }): Promise<string> {
  const response = await getProvider().complete({
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    tools: [],
    maxTokens: input.maxTokens,
  });
  return response.text ?? "";
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
  media = false,
): { tools: ToolDefinition[]; closers: Array<() => Promise<void>>; hasComputer: boolean } {
  // Media (yt-dlp) tasks always run in the cloud sandbox, never on the user's
  // machine, so don't offer local tools even when their node is online.
  // "Run on my computer": use only the user's own machine tools.
  if (local && !media && nodeInfo(userId).online) {
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
    tools.push(
      ...createMediaTools(shellBackend, `${downloadsDir}/${task.id}`, getCookies, {
        quality: Number(process.env.BOTIFYR_DOWNLOAD_QUALITY ?? 720),
        audioOnly: (process.env.BOTIFYR_DOWNLOAD_AUDIO ?? "0") === "1",
        // Save subtitle tracks (English + Khmer) next to the video when available.
        subtitles: (process.env.BOTIFYR_DOWNLOAD_SUBS ?? "1") === "1",
        subtitleLangs: process.env.BOTIFYR_DOWNLOAD_SUB_LANGS ?? "en,km",
        // Approved per-domain recipes are applied on a yt-dlp miss; the bot can
        // propose new ones (saved pending for admin approval).
        getRecipe: async (url) => {
          try {
            const domain = new URL(url).hostname.toLowerCase();
            const recipe = await store.getMediaRecipe(domain);
            if (recipe?.status === "approved") {
              return { pattern: recipe.pattern, headers: recipe.headers };
            }
          } catch {
            // ignore a bad/relative URL
          }
          return null;
        },
        proposeRecipe: async (recipe) => {
          const now = new Date().toISOString();
          await store.saveMediaRecipe({
            domain: recipe.domain,
            pattern: recipe.pattern,
            headers: recipe.headers,
            status: "pending",
            createdBy: userId,
            note: recipe.note,
            createdAt: now,
            updatedAt: now,
          });
        },
        // SPA players (e.g. GoodShort): open the page in a browser sandbox,
        // capture the media request, then download the URL it found. One
        // browser container is reused for the whole batch (starting one per
        // URL is slow) and closed with the task's other closers.
        sniffMedia: (() => {
          let browser: ReturnType<typeof createBrowserBackend> | null = null;
          return async (url: string) => {
            try {
              if (!browser) {
                const created = createBrowserBackend({ mode: sandboxMode() });
                browser = created;
                closers.push(() => created.close().catch(() => {}));
              }
              await browser.goto(url);
              const result = await browser.sniff(12_000);
              if (!result.ok) return null;
              // Prefer an HLS playlist over a plain MP4 segment.
              const match =
                /https?:\/\/\S+\.m3u8\S*/.exec(result.output) ?? /https?:\/\/\S+\.mp4\S*/.exec(result.output);
              return match ? match[0].replace(/[),\s]+$/, "") : null;
            } catch {
              await browser?.close().catch(() => {});
              browser = null;
              return null;
            }
          };
        })(),
      }).tools,
    );
  }
  // Local tools operate the user's own machine; only when their node is online
  // and this isn't a media task (those run in the cloud sandbox).
  if (!media && nodeInfo(userId).online) {
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
  markTaskRunning(task.id, task.sessionId);

  const media = Boolean(deps.initialToolCall?.name.startsWith("youtube."));
  const { tools, closers, hasComputer } = buildTools(
    store,
    task,
    userId,
    Boolean(deps.local),
    deps.vaultKey,
    media,
  );
  // Abort the run's sandboxes when the task is cancelled.
  let sandboxesClosed = false;
  const closeSandboxes = async (): Promise<void> => {
    if (sandboxesClosed) return;
    sandboxesClosed = true;
    await Promise.all(closers.map((close) => close().catch(() => {})));
  };
  setTaskAbort(task.id, () => {
    void closeSandboxes();
  });
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
  // Self-learning tools: available everywhere (list/get/save learned skills).
  tools.push(...createLearnedSkillTools(store, userId));
  // History search: the bot can look up its own past chats for context/links.
  tools.push(...createHistoryTools(store, deps.author?.id ?? null, task.sessionId));
  // Library tools: the authoring bot can read/write its own files.
  if (deps.author) tools.push(...createFileTools(store, deps.author.id, userId));
  const localInstruction =
    deps.local && nodeInfo(userId).online
      ? "The user has explicitly enabled their own computer for this request. Perform it on their machine using the local.browser.* and local.shell/local.file tools."
      : undefined;
  // Surface the team's learned skills so the agent reuses (and grows) them.
  const learned = (await store.listLearnedSkills().catch(() => [])).filter(
    (skill) => skill.status === "approved" || skill.createdBy === userId,
  );
  const skillIndex =
    learned.length > 0
      ? "Skills already learned by the team (call skills.get with the name to read the full guide before unfamiliar work; save new ones with skills.learn):\n" +
        learned
          .slice(0, 25)
          .map((skill) => `- ${skill.name}: ${skill.description}`)
          .join("\n") +
        (learned.length > 25
          ? `\n(Showing 25 of ${learned.length}. Use skills.list with a query to search the rest.)`
          : "")
      : "";
  // Company builder tools: understand a site/idea and propose an org chart.
  const fetchText = async (url: string): Promise<string> => {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return (await res.text()).slice(0, 40_000);
  };
  tools.push(...createCompanyTools(oneShot, fetchText));
  if (deps.author) {
    tools.push(...createDelegationTools(store, userId, deps.author.id));
  }

  // Company context + budget: give every employee the shared briefing (DNA),
  // and stop before spending when the company's token budget is exhausted.
  let companyBrief = "";
  const authorBot = deps.author ? await store.getBot(deps.author.id).catch(() => null) : null;
  const company = authorBot?.workspace
    ? (await store.listWorkspaces(userId).catch(() => [])).find(
        (entry) => entry.name === authorBot.workspace,
      )
    : undefined;
  if (company?.dna) companyBrief = companyContext(company.dna);
  if (company) {
    const budget = await store.getWorkspaceBudget(company.id).catch(() => null);
    if (isBudgetExhausted(budget)) {
      task.status = "failed";
      task.error = `Company budget reached (${budget?.usedTokens.toLocaleString()} / ${budget?.limitTokens.toLocaleString()} tokens). Raise it in the Company HQ → Budget.`;
      task.updatedAt = new Date().toISOString();
      await store.updateTask(task);
      emit({ type: "task.failed", task });
      return;
    }
  }
  // Social + design hands for the right departments.
  if (company && authorBot) {
    const roles = await store.listBotRoles(company.id).catch(() => []);
    const role = roles.find((entry) => entry.botId === authorBot.id);
    const department = role?.department;
    if (department === "marketing" || department === "sales") {
      tools.push(...createSocialTools(notConnectedSocial()));
    }
    if (department === "design" || department === "marketing") {
      tools.push(...createDesignTools(store, userId, authorBot.id));
    }

    // Authorization: revoked capabilities block their tools (docs/company-os.md §8).
    const grants = await store.listCapabilityGrants(company.id).catch(() => []);
    const subjects = new Set([`bot:${authorBot.id}`, ...(role ? [`role:${role.title}`] : [])]);
    const denied = new Set(
      grants
        .filter((grant) => subjects.has(grant.subject) && !grant.granted)
        .map((grant) => grant.capability),
    );
    const kept = removeDeniedTools(tools, denied);
    if (kept.length !== tools.length) {
      tools.length = 0;
      tools.push(...kept);
    }
  }
  const instructions =
    [companyBrief, deps.instructions, skillIndex, localInstruction].filter(Boolean).join("\n\n") || undefined;
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
      maxSteps: Number(process.env.BOTIFYR_MAX_STEPS ?? 16),
      maxTokens: Number(process.env.BOTIFYR_MAX_OUTPUT_TOKENS ?? 1024),
      maxTotalTokens: Number(process.env.BOTIFYR_MAX_TASK_TOKENS ?? 0),
      prefill: (() => {
        const setting = process.env.BOTIFYR_PREFILL ?? "1";
        if (setting === "0") return undefined;
        return setting === "1" ? "On it — I'll do this now with my tools." : setting;
      })(),
      autoApprove: deps.autoApprove === true,
      initialToolCall: deps.initialToolCall,
      initialToolOnly: deps.initialToolOnly === true,
      isCancelled: () => isTaskCancelled(task.id),
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
      onStreamReset: () => {
        emit({ type: "assistant.reset", sessionId: task.sessionId, taskId: task.id, botId: deps.author?.id });
      },
      onScreenshot: (png) => {
        setScreenshot(task.id, png);
        task.screenshotAt = new Date().toISOString();
        queue({ type: "task.updated", task });
      },
      onLog: (message) => {
        // Surface batch-download progress as a live task step.
        if (message.startsWith("download ")) {
          upsertStep(task, {
            id: `downloads-${task.id}`,
            title: "Downloads",
            detail: message.replace(/^download /, ""),
            status: "running",
          });
          queue({ type: "task.updated", task });
        }
      },
    });

    await chain;
    ok = result.ok;
    reply = result.summary;

    // The batch "Downloads" progress step is opened by onLog while files are
    // fetched; close it once the run has finished so it doesn't stay "running".
    const downloadsStep = task.steps.find((step) => step.id === `downloads-${task.id}`);
    if (downloadsStep && downloadsStep.status === "running") {
      downloadsStep.status = ok ? "done" : "failed";
      downloadsStep.finishedAt = new Date().toISOString();
      queue({ type: "task.updated", task });
    }

    // Best-effort cost accounting: never let a failed write break the task.
    try {
      if (result.usage && (result.usage.promptTokens > 0 || result.usage.completionTokens > 0)) {
        const model = process.env.BOTIFYR_MODEL;
        const now = new Date().toISOString();
        await store.addUsage({
          id: randomUUID(),
          userId,
          taskId: task.id,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          model,
          createdAt: now,
        });
        // Per-workspace budget accounting (docs/company-os.md §15).
        if (authorBot?.workspace) {
          const space = (await store.listWorkspaces(userId).catch(() => [])).find(
            (entry) => entry.name === authorBot.workspace,
          );
          if (space) {
            const spent = result.usage.promptTokens + result.usage.completionTokens;
            const budget = (await store.getWorkspaceBudget(space.id)) ?? {
              workspaceId: space.id,
              limitTokens: 0,
              usedTokens: 0,
              updatedAt: now,
            };
            await store.saveWorkspaceBudget({
              workspaceId: space.id,
              limitTokens: budget.limitTokens,
              usedTokens: budget.usedTokens + spent,
              updatedAt: now,
            });
          }
        }
        // On-demand / overage: debit the prepaid credit wallet at the per-model rate.
        const settings = await store.getPlatformSettings();
        const record = await store.getUserById(userId);
        if (record && settings.onDemand.enabled) {
          const charge = priceFor(
            await store.listModelPricing(),
            model,
            result.usage.promptTokens,
            result.usage.completionTokens,
            settings.onDemand.markupPercent,
          );
          const wallet = await store.getWallet(userId);
          const drawsCredits =
            record.billingMode === "payg" || (settings.onDemand.allowPro && wallet.balanceCents > 0);
          if (charge > 0 && drawsCredits) {
            await store.addWalletCents(userId, -charge);
            await store.addLedger({
              id: randomUUID(),
              userId,
              kind: "usage",
              amountCents: -charge,
              tokens: result.usage.promptTokens + result.usage.completionTokens,
              model,
              note: task.id,
              createdAt: now,
            });
          }
        }
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
    await closeSandboxes();
    clearTaskCancel(task.id);
    clearTaskRunning(task.id);
    if (hasComputer) {
      clearComputerSandbox(task.id);
      task.liveStream = false;
      task.updatedAt = new Date().toISOString();
      await store.updateTask(task);
      emit({ type: "task.updated", task });
    }
  }

  // Append the assistant's reply to the conversation transcript. A per-session
  // lock keeps concurrent group members from clobbering each other's writes.
  try {
    await withSessionLock(task.sessionId, async () => {
      const session = await store.getSession(task.sessionId);
      if (session && !deps.suppressIf?.(reply)) {
        session.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: ok || reply === "Stopped by you." ? reply : `Something went wrong: ${reply}`,
          createdAt: new Date().toISOString(),
          taskId: task.id,
          botId: deps.author?.id,
        });
        await store.updateSession(session);
        emit({ type: "session.updated", session });
      }
    });
  } catch {
    // transcript update is best-effort
  }
}
