import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  AuditEvent,
  AuthResponse,
  Bot,
  BotFile,
  BotRole,
  ConnectionInfo,
  CreateWorkspaceRequest,
  SecretSummary,
  ServerEvent,
  Session,
  Task,
  User,
  Workspace,
  WorkspaceWithRoles,
} from "@botifyr/shared";
import type { LocalChannel } from "@botifyr/channels";
import { emit, subscribe } from "./events.js";
import {
  getComputerSandbox,
  setComputerSandbox,
  clearComputerSandbox,
  touchComputerSandbox,
  takeIdleComputerSandboxes,
  getScreenshot,
  ownerOfEventTask,
  ownerOfSession,
  rememberSession,
  rememberTask,
  cancelTask,
  runningTasksForSession,
  withSessionLock,
} from "./runtime.js";
import { resolveTaskApproval } from "./approvals.js";
import { handleNodeMessage, nodeInfo, registerNode } from "./nodes.js";
import { createToken, hashPassword, hashToken, verifyPassword } from "./auth.js";
import { encryptSecret } from "./vault.js";
import { oneShot, runTask, runtimeInfo, summarizeConversation } from "./runner.js";
import { planCompany, toDepartment } from "./company.js";
import { createDockerComputerBackend } from "@botifyr/agent-core";
import {
  chmabaConfigFromEnv,
  createPayment,
  runBillingTick,
  settleInvoice,
  verifyChmabaSignature,
} from "./billing.js";
import { SKILLS, skillInstructions } from "./skills.js";
import type { Store } from "./store/index.js";
import type {
  FileRecord,
  InvoiceRecord,
  LearnedSkillRecord,
  MediaRecipe,
  ModelPricingRecord,
  PlatformSettings,
  Plan,
} from "./store/types.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

/** Minimal shape we need from a websocket. */
interface SocketLike {
  send(data: string): void;
  close?(): void;
  addEventListener?(type: string, listener: (event: unknown) => void): void;
}

const DEMO_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Botifyr Demo</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0b0d12; color: #e6e9f2; padding: 48px; }
      h1 { margin-top: 0; }
      input { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #2a3042; background: #12151d; color: #fff; }
      button { font: inherit; padding: 10px 18px; border: none; border-radius: 8px; cursor: pointer; color: #fff; background: linear-gradient(135deg, #6d8bff, #8f6dff); }
      #result { margin-top: 22px; color: #3fd18b; font-size: 18px; }
    </style>
  </head>
  <body>
    <h1>Botifyr Demo Page</h1>
    <p>This page exists so the browser-use agent has something real to operate.</p>
    <input id="name" placeholder="Your name" />
    <button id="submit" type="button">Submit</button>
    <div id="result"></div>
    <script>
      document.getElementById("submit").addEventListener("click", function () {
        var value = document.getElementById("name").value || "world";
        document.getElementById("result").textContent = "Hello, " + value + "! Form submitted successfully.";
      });
    </script>
  </body>
</html>`;

/**
 * If the user pasted links and asked to download them, return the URLs. This
 * lets the runtime invoke the download tool directly, so the mechanical step
 * can't be refused by the model.
 */
function downloadTargets(text: string): string[] | null {
  const urls = text.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
  if (urls.length === 0) return null;
  if (!/\b(download|grab|save|fetch|rip|bulk)\b/i.test(text)) return null;
  const media = urls.filter((url) =>
    /youtube\.com|youtu\.be|vimeo\.com|soundcloud\.com|tiktok\.com/i.test(url),
  );
  const list = (media.length > 0 ? media : urls).slice(0, 50);
  return list.length > 0 ? list : null;
}

/**
 * Detect "grab 20 links of <query>" style requests so the runtime can search
 * YouTube directly (via yt-dlp) instead of depending on the model.
 */
function searchIntent(text: string): { query: string; count: number } | null {
  if (!/\b(grab|find|get|search|collect|list|pull)\b/i.test(text)) return null;
  if (!/\b(links?|videos?|songs?|urls?|clips?)\b/i.test(text)) return null;
  const countMatch = text.match(/\b(\d{1,3})\b/);
  const count = countMatch ? Math.min(50, Math.max(1, Number(countMatch[1]))) : 10;
  const head = text.split(/\b(?:so that|so i can|so i|then|so)\b/i)[0] ?? text;
  const query = head
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(
      /\b(grab|find|get|search|collect|list|pull|me|please|the|top|youtube|links?|videos?|songs?|urls?|clips?|for|and|of|from|on)\b/gi,
      " ",
    )
    .replace(/\b\d{1,3}\b/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (query.length < 2) return null;
  return { query, count };
}

interface MediaPlan {
  mediaTask: boolean;
  initialToolCall?: { name: string; arguments: Record<string, unknown> };
  initialToolOnly: boolean;
}

/**
 * Decide whether a message is a deterministic media request and, if so, which
 * yt-dlp tool to invoke directly. Used by both the first send and retries, so a
 * retried download never falls back to the model (which would probe the user's
 * local machine).
 */
export function planMedia(text: string): MediaPlan {
  const targets = downloadTargets(text);
  const search = targets ? null : searchIntent(text);
  // "highest/best/4k" → ask yt-dlp for 2160p; otherwise the 720p default.
  const quality = /\b(highest|best|max(?:imum)?|4k|2160)\b/i.test(text) ? 2160 : undefined;
  const wantsAll = /\b(all|every|entire|whole|full)\b/i.test(text);
  // An explicit count ("only 5 videos") wins over "all".
  const countMatch = /\b(\d{1,3})\s*(?:videos?|songs?|links?|clips?|items?|results?)\b/i.exec(text);
  const limit = countMatch ? Math.min(500, Number(countMatch[1])) : wantsAll ? 0 : undefined;
  const wantsDownload = /\b(download|grab|save|fetch|rip)\b/i.test(text);
  const wantsAudio = /\b(mp3|audio|music)\b/i.test(text) && !/\bvideo\b/i.test(text);
  const mediaArgs = {
    ...(quality ? { quality } : {}),
    ...(wantsAudio ? { audio_only: true } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
  const initialToolCall = targets
    ? { name: "youtube.download", arguments: { urls: targets, ...mediaArgs } }
    : search
      ? wantsDownload
        ? {
            name: "youtube.download_search",
            arguments: { query: search.query, count: search.count, ...mediaArgs },
          }
        : { name: "youtube.search", arguments: { query: search.query, count: search.count } }
      : undefined;
  return {
    mediaTask: Boolean(initialToolCall?.name.startsWith("youtube.")),
    initialToolCall,
    initialToolOnly:
      initialToolCall?.name === "youtube.download" || initialToolCall?.name === "youtube.download_search",
  };
}

export interface ServerOptions {
  store: Store;
  vaultKey: Buffer;
  localChannel: LocalChannel;
}

/**
 * Origins allowed to call this API from a browser. Anything else is refused,
 * so a random site the user visits can't silently drive their bots with their
 * stored session. Override with BOTIFYR_ALLOWED_ORIGINS (comma-separated); set
 * it to "*" only for throwaway/local debugging.
 */
function allowedOrigins(): Set<string> {
  const defaults = [
    // Desktop dev (Vite) and packaged Tauri webview.
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    // Web portal + marketing (Docker / dev).
    "http://localhost:4322",
    "http://127.0.0.1:4322",
    "http://localhost:4323",
    "http://127.0.0.1:4323",
    "https://botifyr.xyz",
    "https://www.botifyr.xyz",
    "https://app.botifyr.xyz",
    // Admin console.
    "http://localhost:4324",
    "http://127.0.0.1:4324",
    "https://admin.botifyr.xyz",
  ];
  const raw = process.env.BOTIFYR_ALLOWED_ORIGINS;
  const list = raw && raw.trim() ? raw.split(",") : defaults;
  return new Set(list.map((entry) => entry.trim()).filter(Boolean));
}

export async function buildServer(options: ServerOptions) {
  const { store, vaultKey, localChannel } = options;
  const corsOrigins = allowedOrigins();

  /* ------------------------------------------------------------------------ */
  /* Cost controls (modelled on Chmaba's limits)                              */
  /* ------------------------------------------------------------------------ */
  const rateLimitPerHour = Number(process.env.BOTIFYR_RATE_LIMIT_PER_HOUR ?? 60);
  const dailyTokenBudget = Number(process.env.BOTIFYR_DAILY_TOKEN_BUDGET ?? 200_000);
  const maxOutputTokens = Number(process.env.BOTIFYR_MAX_OUTPUT_TOKENS ?? 1024);
  const maxHistoryTurns = Number(process.env.BOTIFYR_MAX_HISTORY_TURNS ?? 12);
  const maxMessageChars = Number(process.env.BOTIFYR_MAX_MESSAGE_CHARS ?? 4000);
  const summarizeEnabled = (process.env.BOTIFYR_SUMMARY ?? "1") !== "0";
  const rateWindows = new Map<string, number[]>();

  /** Sliding-window per-user rate limit. 0 disables it. */
  function rateLimitOk(userId: string): boolean {
    if (rateLimitPerHour <= 0) return true;
    const now = Date.now();
    const window = (rateWindows.get(userId) ?? []).filter((t) => now - t < 3_600_000);
    if (window.length >= rateLimitPerHour) {
      rateWindows.set(userId, window);
      return false;
    }
    window.push(now);
    rateWindows.set(userId, window);
    return true;
  }

  function startOfToday(): string {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
  }

  /** Midnight on the 1st of the current month (for the free plan allowance). */
  function startOfMonth(): string {
    const date = new Date();
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
  }

  // Emails listed here become platform admins automatically.
  const adminEmails = new Set(
    (process.env.BOTIFYR_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const roleFor = (email: string): "user" | "admin" =>
    adminEmails.has(email.toLowerCase()) ? "admin" : "user";

  // When set, only these emails may create a NEW account (invite-only signup).
  // An empty list keeps signups open. Existing accounts are never locked out.
  const allowedSignupEmails = new Set(
    (process.env.BOTIFYR_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const signupAllowed = (email: string): boolean =>
    allowedSignupEmails.size === 0 ||
    allowedSignupEmails.has(email.toLowerCase()) ||
    adminEmails.has(email.toLowerCase());

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearer(request) ?? tokenFromQuery(request);
    const userId = token ? await store.getUserIdByTokenHash(hashToken(token)) : null;
    if (!userId) {
      await reply.code(401).send({ error: "missing bearer token" });
      return;
    }
    const record = await store.getUserById(userId);
    if (!record || record.role !== "admin") {
      await reply.code(403).send({ error: "admin only" });
      return;
    }
    request.userId = userId;
  };

  /** Record a platform-admin action for the audit log (best-effort). */
  const auditAdmin = (request: FastifyRequest, action: string, detail: string): void => {
    void store
      .appendAudit({
        id: randomUUID(),
        taskId: null,
        userId: (request.userId as string) ?? null,
        type: "admin",
        toolName: action,
        detail,
        createdAt: new Date().toISOString(),
      })
      .catch(() => {});
  };

  /* Presence + device registry: live websocket streams per user/device. */
  const streamCounts = new Map<string, number>();
  const devices = new Map<string, Map<string, { name: string; count: number }>>();
  const isOnline = (userId: string): boolean => (streamCounts.get(userId) ?? 0) > 0;
  const broadcastPresence = async (userId: string, online: boolean): Promise<void> => {
    const friends = await store.listFriends(userId).catch(() => []);
    for (const friend of friends) emit({ type: "presence", userId, online, toUserId: friend });
  };
  const noteOnline = (userId: string, deviceId: string, deviceName: string): void => {
    const next = (streamCounts.get(userId) ?? 0) + 1;
    streamCounts.set(userId, next);
    const perDevice = devices.get(userId) ?? new Map<string, { name: string; count: number }>();
    const entry = perDevice.get(deviceId) ?? { name: deviceName, count: 0 };
    if (deviceName) entry.name = deviceName;
    entry.count += 1;
    perDevice.set(deviceId, entry);
    devices.set(userId, perDevice);
    if (next === 1) void broadcastPresence(userId, true);
  };
  const noteOffline = (userId: string, deviceId: string): void => {
    const next = Math.max(0, (streamCounts.get(userId) ?? 1) - 1);
    if (next === 0) {
      streamCounts.delete(userId);
      void broadcastPresence(userId, false);
    } else {
      streamCounts.set(userId, next);
    }
    const perDevice = devices.get(userId);
    if (perDevice) {
      const entry = perDevice.get(deviceId);
      if (entry) {
        entry.count -= 1;
        if (entry.count <= 0) perDevice.delete(deviceId);
      }
      if (perDevice.size === 0) devices.delete(userId);
    }
  };

  /** Returns a non-blocking warning when the user is over the daily budget. */
  async function budgetWarning(userId: string): Promise<string | null> {
    if (dailyTokenBudget <= 0) return null;
    const { tokens } = await store.usageSince(userId, startOfToday());
    if (tokens >= dailyTokenBudget) {
      return `Daily token budget reached (${tokens.toLocaleString()} tokens). Messages still work — raise BOTIFYR_DAILY_TOKEN_BUDGET to increase it.`;
    }
    return null;
  }

  // When BOTIFYR_ENFORCE_BUDGET=1, an over-budget user is refused new work
  // (HTTP 429) instead of merely warned. Off by default so it can't surprise you.
  const enforceBudget = (process.env.BOTIFYR_ENFORCE_BUDGET ?? "0") === "1";

  /** Whether new work should be refused because the daily budget is spent. */
  async function budgetBlocked(userId: string): Promise<boolean> {
    if (!enforceBudget || dailyTokenBudget <= 0) return false;
    const { tokens } = await store.usageSince(userId, startOfToday());
    return tokens >= dailyTokenBudget;
  }

  /**
   * Hard-stop: refuse new work when the account is out of allowance. Free users
   * get a monthly token pool; plan users get their period's included tokens;
   * pay-as-you-go users need a positive credit balance (unless they may fall
   * back to the free pool). Returns a user-facing reason, or null to allow.
   */
  async function billingBlockReason(userId: string): Promise<string | null> {
    const record = await store.getUserById(userId);
    if (!record) return null;
    const settings = await store.getPlatformSettings();
    const plan = record.plan ?? "free";
    const paidPlan = plan === "pro" || plan === "business";

    if (paidPlan) {
      const { tokens } = await store.usageSince(userId, record.periodStart ?? startOfMonth());
      const included =
        plan === "business" ? settings.plans.includedTokens.business : settings.plans.includedTokens.pro;
      if (tokens < included) return null;
    } else {
      const { tokens } = await store.usageSince(userId, startOfMonth());
      if (tokens < settings.freeMonthlyTokens) return null;
    }

    // Over allowance: credits can cover it (payg, or overage allowed for plans).
    const wallet = await store.getWallet(userId);
    const creditsUsable =
      settings.onDemand.enabled &&
      wallet.balanceCents > 0 &&
      (record.billingMode === "payg" || settings.onDemand.allowPro);
    if (creditsUsable || settings.onDemand.onEmpty === "free") return null;

    return paidPlan
      ? "You've used this period's included tokens — renew to continue, or top up credits."
      : "You've used this month's free tokens — upgrade or top up credits to continue.";
  }
  const app = Fastify({ logger: true });

  // Keep the raw body as well as the parsed JSON, so webhook handlers (Stripe)
  // can verify their HMAC signature over the exact bytes.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request: FastifyRequest & { rawBody?: Buffer }, body, done) => {
      request.rawBody = body as Buffer;
      try {
        done(null, JSON.parse((body as Buffer).toString("utf8")));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  // The desktop app (and website) call this API cross-origin, so allow the
  // full set of verbs we actually use — the default omits PUT/PATCH/DELETE,
  // which silently broke Edit/Delete bot with a CORS "Failed to fetch".
  // Origins are allowlisted so a random site can't drive a user's bots.
  await app.register(cors, {
    origin: (origin, cb) => {
      const ok = !origin || corsOrigins.has("*") || corsOrigins.has(origin);
      cb(null, ok);
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization"],
  });
  await app.register(websocket);

  // Serve the brand logo for the sign-in pages (botifyr.xyz has an untrusted cert).
  let logo: Buffer | null = null;
  try {
    logo = readFileSync("assets/botifyr-logo.png");
  } catch {
    logo = null;
  }
  app.get("/logo.png", async (_request, reply) => {
    if (!logo) return reply.code(404).send();
    return reply.header("cache-control", "public, max-age=3600").type("image/png").send(logo);
  });

  const bearer = (request: FastifyRequest): string | null => {
    const header = request.headers.authorization;
    return header?.startsWith("Bearer ") ? header.slice(7) : null;
  };

  // `<img>` tags cannot send an Authorization header, so image/stream GETs may
  // pass the token as a query parameter instead.
  const tokenFromQuery = (request: FastifyRequest): string | null => {
    const value = (request.query as { token?: string } | undefined)?.token;
    return typeof value === "string" ? value : null;
  };

  /** A developer key from `x-api-key` or a `bk_…` bearer token. */
  const apiKeyFromRequest = (request: FastifyRequest): string | null => {
    const header = request.headers["x-api-key"];
    if (typeof header === "string" && header.trim()) return header.trim();
    const token = bearer(request);
    return token && token.startsWith("bk_") ? token : null;
  };

  /**
   * Resolve the caller to a user from either a session bearer token or a
   * developer API key. API keys are hashed at rest and their last use is
   * recorded so the portal can show activity.
   */
  const resolveUserId = async (request: FastifyRequest): Promise<string | null> => {
    const apiKey = apiKeyFromRequest(request);
    if (apiKey) {
      const record = await store.getApiKeyByHash(hashToken(apiKey));
      if (!record) return null;
      void store.touchApiKey(record.id).catch(() => {});
      return record.userId;
    }
    const token = bearer(request) ?? tokenFromQuery(request);
    return token ? store.getUserIdByTokenHash(hashToken(token)) : null;
  };

  const requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userId = await resolveUserId(request);
    if (!userId) {
      await reply.code(401).send({ error: "invalid or missing credentials" });
      return;
    }
    request.userId = userId;
  };

  /**
   * Issue a short-lived access token plus a long-lived refresh token. The
   * access token is what every API call carries; the refresh token can only be
   * exchanged at /auth/refresh and is rotated on each use.
   */
  const issueSession = async (
    userId: string,
  ): Promise<{ token: string; refreshToken: string; expiresAt: string }> => {
    const access = createToken(1);
    const refresh = createToken(30);
    await store.createToken(access.tokenHash, userId, access.expiresAt, "access");
    await store.createToken(refresh.tokenHash, userId, refresh.expiresAt, "refresh");
    return { token: access.token, refreshToken: refresh.token, expiresAt: access.expiresAt };
  };

  const toUser = (record: {
    id: string;
    email: string;
    createdAt: string;
    role?: string;
    plan?: string;
    handle?: string;
    displayName?: string;
    avatarEmoji?: string;
    avatarScheme?: number;
  }): User => ({
    id: record.id,
    email: record.email,
    createdAt: record.createdAt,
    role: record.role === "admin" ? "admin" : "user",
    plan: record.plan === "pro" ? "pro" : record.plan === "business" ? "business" : "free",
    handle: record.handle,
    displayName: record.displayName,
    avatarEmoji: record.avatarEmoji,
    avatarScheme: record.avatarScheme,
  });

  const slugify = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "")
      .slice(0, 24) || "user";

  /** Pick a free @handle derived from the email's local part. */
  const freeHandle = async (email: string): Promise<string> => {
    const base = slugify(email.split("@")[0] ?? "user");
    let candidate = base;
    for (let n = 2; n < 500; n += 1) {
      if (!(await store.getUserByHandle(candidate))) return candidate;
      candidate = `${base}${n}`;
    }
    return `${base}${Date.now().toString(36).slice(-4)}`;
  };

  const canReceive = (userId: string, event: ServerEvent): boolean => {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        return event.session.userId === userId || (event.session.participants ?? []).includes(userId);
      case "assistant.delta":
      case "assistant.reset":
        // Route by task owner (set for every run) and fall back to session owner.
        return ownerOfEventTask(event.taskId) === userId || ownerOfSession(event.sessionId) === userId;
      case "group.working":
        return ownerOfSession(event.sessionId) === userId;
      case "task.created":
      case "task.updated":
      case "task.completed":
      case "task.failed":
        return ownerOfEventTask(event.task.id) === userId;
      case "approval.requested":
      case "approval.resolved":
        return ownerOfEventTask(event.taskId) === userId;
      case "presence":
      case "friend.request":
        return event.toUserId === userId;
      case "p2p.signal":
        return event.toUserId === userId;
      default:
        return false;
    }
  };

  async function ownedTask(request: FastifyRequest, taskId: string): Promise<Task | null> {
    const task = await store.getTask(taskId);
    if (!task) return null;
    const session = await store.getSession(task.sessionId);
    if (!session || session.userId !== request.userId) return null;
    return task;
  }

  /** Append the user turn, create a task, and run the agent with prior context. */
  async function startTask(session: Session, text: string, userId: string, local = false): Promise<Task> {
    // Cost control: cap the incoming message and the history sent to the model.
    const capped = text.slice(0, maxMessageChars);
    const windowSize = maxHistoryTurns * 2;

    // Compress older turns into a rolling summary (keeps memory, bounds tokens).
    // Rolling summary runs in the background so it never delays the response.
    if (summarizeEnabled && session.messages.length > windowSize) {
      const snapshot = session.summary;
      const messages = session.messages.slice();
      void (async () => {
        try {
          const boundary = messages.length - windowSize;
          const already = session.summaryUpTo ?? 0;
          if (boundary <= already) return;
          const older = messages
            .slice(already, boundary)
            .map((message) => `${message.role}: ${message.content.slice(0, maxMessageChars)}`)
            .join("\n");
          const summary = await summarizeConversation(snapshot ? `${snapshot}\n${older}` : older);
          if (summary) {
            // Re-read before writing: the run may have appended messages since
            // this snapshot, and writing the stale object would wipe them.
            const fresh = await store.getSession(session.id);
            if (fresh) {
              fresh.summary = summary;
              fresh.summaryUpTo = boundary;
              await store.updateSession(fresh);
            }
          }
        } catch {
          // summarization is best-effort
        }
      })();
    }

    const history = session.messages
      .slice(-windowSize)
      .map((message) => ({ role: message.role, content: message.content.slice(0, maxMessageChars) }));
    // A bot owns its thread, so keep the bot's name as the title.
    if (session.messages.length === 0 && !session.botId) session.title = capped.slice(0, 60);

    // If the user pasted links and asked to download them, run the download tool
    // directly (deterministic) instead of hoping the model chooses to. Media
    // steps run in the cloud sandbox (they need yt-dlp), never on the user's
    // machine; a deterministic one finishes without consulting the model.
    const { mediaTask, initialToolCall, initialToolOnly } = planMedia(capped);

    const bot = session.botId ? await store.getBot(session.botId) : null;
    // Group chats: every member bot replies in turn.
    const members =
      bot?.memberIds && bot.memberIds.length > 0
        ? (await Promise.all(bot.memberIds.map((id) => store.getBot(id)))).filter(
            (entry): entry is NonNullable<typeof entry> => Boolean(entry),
          )
        : [];

    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      sessionId: session.id,
      goal: capped,
      status: "queued",
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
    const userMessage = {
      id: randomUUID(),
      role: "user" as const,
      content: capped,
      createdAt: now,
      taskId: task.id,
    };
    // Append against the freshest copy so a concurrent run can't clobber it.
    await withSessionLock(session.id, async () => {
      const fresh = (await store.getSession(session.id)) ?? session;
      if (!fresh.messages.some((message) => message.id === userMessage.id)) {
        fresh.messages.push(userMessage);
      }
      await store.updateSession(fresh);
      session.messages = fresh.messages;
    });
    await store.createTask(task);
    rememberSession(session.id, session.userId);
    rememberTask(task.id, session.id, userId);
    emit({ type: "session.updated", session });
    emit({ type: "task.created", task });

    if (members.length > 0) {
      // @mentions choose who replies; otherwise every member replies in turn.
      const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const mentioned = members.filter((member) =>
        new RegExp(`@${escapeRegex(member.name)}(?![\\w-])`, "i").test(capped),
      );
      const autonomous = bot?.autonomous === true;
      const responders = autonomous ? members : mentioned.length > 0 ? mentioned : members;
      // A deterministic tool step (download/search) runs on ONE member only, so
      // two bots don't download the same links.
      const directMemberId = initialToolCall ? (mentioned[0]?.id ?? responders[0]?.id ?? null) : null;
      void (async () => {
        const nameById = new Map(members.map((m) => [m.id, m.name]));
        const spoken = new Set<string>();

        const runMember = async (member: (typeof members)[number]) => {
          const latest = (await store.getSession(session.id)) ?? session;
          const memberHistory = latest.messages.slice(-windowSize).map((message) => {
            const content = message.content.slice(0, maxMessageChars);
            if (message.role === "user") return { role: "user" as const, content };
            // Its own past replies stay assistant turns; other bots' replies are
            // other participants, so surface them as user turns labelled by name.
            if (message.botId === member.id) return { role: "assistant" as const, content };
            const speaker = nameById.get(message.botId ?? "") ?? "another bot";
            return { role: "user" as const, content: `[${speaker}]: ${content}` };
          });
          // The member's own separate one-to-one chat with the user, so it can
          // recall context the user shared with it elsewhere (e.g. links).
          const ownSession = member.sessionId ? await store.getSession(member.sessionId) : null;
          const ownRecent = ownSession
            ? ownSession.messages
                .slice(-6)
                .map(
                  (message) =>
                    `${message.role === "user" ? "User" : "You"}: ${message.content.slice(0, 600)}`,
                )
                .join("\n")
            : "";
          await runTask(
            {
              store,
              userId,
              history: memberHistory,
              local,
              instructions: [
                `In this group chat you are "${member.name}".`,
                "The user may address one or more members with @name. Answer when you are addressed; if you need another member, or the user clearly also needs their answer, @mention them by name to bring them in.",
                "Messages from other bots are shown as coming from them (prefixed with [their name]); your own earlier replies are your turns.",
                ownRecent
                  ? `Context from your OWN separate one-to-one chat with the user (use it — e.g. links they shared with you earlier):\n${ownRecent}`
                  : "",
                autonomous
                  ? "Autonomous mode: " +
                    (mentioned.length > 0
                      ? `the user addressed ${mentioned.map((m) => m.name).join(", ")}. `
                      : "the user addressed no one in particular. ") +
                    "Only reply if you are addressed or can genuinely add something new. If the message is aimed at another member and you have nothing to add, reply with exactly [SKIP] and nothing else."
                  : "",
                "If the user refers to links/items from earlier, list what you found and confirm which ones they want before acting (end with an options block).",
                member.instructions,
                skillInstructions(member.skills),
              ]
                .filter(Boolean)
                .join("\n\n"),
              summary: latest.summary,
              vaultKey,
              author: { id: member.id },
              autoApprove: member.autoApprove === true,
              initialToolCall: member.id === directMemberId ? initialToolCall : undefined,
              initialToolOnly,
              suppressIf: autonomous ? (reply) => reply.trim().startsWith("[SKIP]") : undefined,
            },
            task,
          ).catch((error) => app.log.error({ err: error, taskId: task.id }, "group member run failed"));
        };

        // A wave runs its members at the same time. Each reads the transcript as
        // it was when the user sent the message, so they answer in parallel.
        const runWave = async (list: typeof members) => {
          const fresh = list.filter((member) => !spoken.has(member.id));
          if (fresh.length === 0) return;
          for (const member of fresh) spoken.add(member.id);
          emit({
            type: "group.working",
            sessionId: session.id,
            names: fresh.map((member) => member.name),
          });
          await Promise.all(fresh.map((member) => runMember(member)));
        };

        await runWave(
          initialToolCall ? responders.filter((member) => member.id === directMemberId) : responders,
        );

        // Handoff waves: a reply may @mention a member who hasn't spoken yet.
        for (let round = 0; round < 2; round += 1) {
          const latest = (await store.getSession(session.id)) ?? session;
          const pending = members.filter(
            (member) =>
              !spoken.has(member.id) &&
              latest.messages.some(
                (message) =>
                  message.role === "assistant" &&
                  new RegExp(`@${escapeRegex(member.name)}(?![\\w-])`, "i").test(message.content),
              ),
          );
          if (pending.length === 0) break;
          await runWave(pending);
        }

        emit({ type: "group.working", sessionId: session.id, names: [] });
      })();
    } else {
      void runTask(
        {
          store,
          userId,
          history,
          local: mediaTask ? false : local,
          instructions:
            [bot?.instructions, skillInstructions(bot?.skills)].filter(Boolean).join("\n\n") || undefined,
          summary: session.summary,
          vaultKey,
          author: bot ? { id: bot.id } : undefined,
          autoApprove: bot?.autoApprove === true,
          initialToolCall,
          initialToolOnly,
        },
        task,
      ).catch((error) => {
        app.log.error({ err: error, taskId: task.id }, "task runner failed");
      });
    }

    return task;
  }

  /** Re-run the last user turn (drops the previous reply first). */
  async function retryTask(session: Session, userId: string, local = false): Promise<Task> {
    const lastUserIndex = session.messages.map((message) => message.role).lastIndexOf("user");
    if (lastUserIndex < 0) throw new Error("there is nothing to retry");
    session.messages = session.messages.slice(0, lastUserIndex + 1);
    const goal = session.messages[lastUserIndex].content.slice(0, maxMessageChars);
    const windowSize = maxHistoryTurns * 2;
    const history = session.messages
      .slice(0, lastUserIndex)
      .slice(-windowSize)
      .map((message) => ({ role: message.role, content: message.content.slice(0, maxMessageChars) }));

    const bot = session.botId ? await store.getBot(session.botId) : null;
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      sessionId: session.id,
      goal,
      status: "queued",
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
    await store.updateSession(session);
    await store.createTask(task);
    rememberSession(session.id, session.userId);
    rememberTask(task.id, session.id, userId);
    emit({ type: "session.updated", session });
    emit({ type: "task.created", task });

    const { mediaTask, initialToolCall, initialToolOnly } = planMedia(goal);
    void runTask(
      {
        store,
        userId,
        history,
        local: mediaTask ? false : local,
        instructions:
          [bot?.instructions, skillInstructions(bot?.skills)].filter(Boolean).join("\n\n") || undefined,
        summary: session.summary,
        vaultKey,
        author: bot ? { id: bot.id } : undefined,
        autoApprove: bot?.autoApprove === true,
        initialToolCall,
        initialToolOnly,
      },
      task,
    ).catch((error) => app.log.error({ err: error, taskId: task.id }, "retry run failed"));

    return task;
  }

  /** Run a bot's scheduled prompt with no incoming user message. */
  async function runScheduled(session: Session, bot: Bot, prompt: string): Promise<void> {
    const windowSize = maxHistoryTurns * 2;
    const history = session.messages
      .slice(-windowSize)
      .map((message) => ({ role: message.role, content: message.content.slice(0, maxMessageChars) }));
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      sessionId: session.id,
      goal: prompt,
      status: "queued",
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
    await store.createTask(task);
    rememberSession(session.id, bot.userId);
    rememberTask(task.id, session.id, bot.userId);
    emit({ type: "task.created", task });

    void runTask(
      {
        store,
        userId: bot.userId,
        history,
        local: false,
        instructions: [bot.instructions, skillInstructions(bot.skills)].filter(Boolean).join("\n\n"),
        summary: session.summary,
        vaultKey,
        author: { id: bot.id },
      },
      task,
    ).catch((error) => app.log.error({ err: error, taskId: task.id }, "scheduled run failed"));
  }

  /** Create a bot together with the conversation thread it owns. */
  async function createBotFor(
    userId: string,
    input: {
      name: string;
      emoji: string;
      scheme: number;
      instructions: string;
      workspace?: string;
      memberIds?: string[];
      autonomous?: boolean;
      skills?: string[];
      autoApprove?: boolean;
    },
  ): Promise<Bot> {
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      userId,
      title: input.name,
      messages: [],
      createdAt: now,
    };
    const bot: Bot = {
      id: randomUUID(),
      userId,
      name: input.name,
      emoji: input.emoji,
      scheme: input.scheme,
      instructions: input.instructions,
      workspace: input.workspace,
      memberIds: input.memberIds && input.memberIds.length > 0 ? input.memberIds : undefined,
      autonomous: input.autonomous === true ? true : undefined,
      autoApprove: input.autoApprove === true ? true : undefined,
      skills: input.skills && input.skills.length > 0 ? input.skills : undefined,
      sessionId: session.id,
      createdAt: now,
    };
    session.botId = bot.id;
    await store.createSession(session);
    await store.createBot(bot);
    rememberSession(session.id, userId);
    emit({ type: "session.created", session });
    return bot;
  }

  /* ------------------------------------------------------------------------ */
  /* Public                                                                   */
  /* ------------------------------------------------------------------------ */

  app.get("/health", async () => ({ ok: true, service: "botifyr-cloud", time: new Date().toISOString() }));

  app.get("/", async () => ({
    name: "Botifyr Cloud",
    status: "ok",
    milestone: "M4 — accounts, persistence, secret vault, audit log",
    store: (process.env.BOTIFYR_STORE ?? "memory").toLowerCase(),
  }));

  app.get("/demo", async (_request, reply) => reply.type("text/html; charset=utf-8").send(DEMO_HTML));

  app.get("/v1/config", { preHandler: requireAuth }, async (request) => {
    const usage = await store.usageSince(request.userId as string, startOfToday());
    // STUN/TURN for P2P: a full JSON array, or a single TURN relay from env.
    let iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> | undefined;
    if (process.env.BOTIFYR_ICE_SERVERS) {
      try {
        const parsed = JSON.parse(process.env.BOTIFYR_ICE_SERVERS);
        if (Array.isArray(parsed)) iceServers = parsed;
      } catch {
        // ignore malformed JSON
      }
    } else if (process.env.BOTIFYR_TURN_URL) {
      iceServers = [
        {
          urls: process.env.BOTIFYR_TURN_URL,
          username: process.env.BOTIFYR_TURN_USERNAME,
          credential: process.env.BOTIFYR_TURN_CREDENTIAL,
        },
      ];
    }
    return {
      ...runtimeInfo(),
      store: (process.env.BOTIFYR_STORE ?? "memory").toLowerCase(),
      nodeOnline: nodeInfo(request.userId as string).online,
      limits: { rateLimitPerHour, maxOutputTokens, maxHistoryTurns, dailyTokenBudget },
      usage: { tokensToday: usage.tokens, requestsToday: usage.requests },
      iceServers,
    };
  });

  /** Built-in knowledge packs a bot can be taught. */
  app.get("/v1/skills", { preHandler: requireAuth }, async () =>
    SKILLS.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description })),
  );

  /**
   * Public, unauthenticated view of the approved learned-skill library, for the
   * website's "Browse all skills" page. Never exposes the full guide content.
   */
  app.get("/public/skills", async (request) => {
    const query = String((request.query as { q?: string } | undefined)?.q ?? "")
      .trim()
      .toLowerCase();
    const all = (await store.listLearnedSkills()).filter((skill) => skill.status === "approved");
    const matched = query
      ? all.filter(
          (skill) =>
            skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
        )
      : all;
    return {
      total: all.length,
      count: matched.length,
      skills: matched.slice(0, 100).map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        updatedAt: skill.updatedAt,
      })),
    };
  });

  /** Skills the bot team has learned (approved ones are global). */
  app.get("/v1/learned-skills", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId as string;
    const list = await store.listLearnedSkills();
    return list
      .filter((skill) => skill.status === "approved" || skill.createdBy === userId)
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        status: skill.status,
        createdAt: skill.createdAt,
      }));
  });

  app.post<{ Body: { name?: string; description?: string; content?: string; source?: string } }>(
    "/v1/learned-skills",
    { preHandler: requireAuth },
    async (request, reply) => {
      const name = (request.body?.name ?? "").trim().slice(0, 80);
      if (!name) return reply.code(400).send({ error: "a skill name is required" });
      const userId = request.userId as string;
      const existing = await store.getLearnedSkillByName(name);
      const now = new Date().toISOString();
      const record = {
        id: existing?.id ?? randomUUID(),
        name,
        description: (request.body?.description ?? "").slice(0, 240),
        content: (request.body?.content ?? "").slice(0, 20_000),
        source: (request.body?.source ?? "").slice(0, 1_000),
        createdBy: existing?.createdBy ?? userId,
        status: existing?.status ?? ("pending" as const),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await store.upsertLearnedSkill(record);
      return reply.code(existing ? 200 : 201).send({
        id: record.id,
        name: record.name,
        description: record.description,
        status: record.status,
        createdAt: record.createdAt,
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/learned-skills/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const removed = await store.deleteLearnedSkill(request.userId as string, request.params.id);
      if (!removed) return reply.code(404).send({ error: "skill not found" });
      return reply.code(204).send();
    },
  );

  /* ------------------------------------------------------------------------ */
  /* Platform admin (moderation + users)                                       */
  /* ------------------------------------------------------------------------ */
  app.get("/admin/learned-skills", { preHandler: requireAdmin }, async () => store.listLearnedSkills());

  app.post<{ Params: { id: string }; Body: { status?: string } }>(
    "/admin/learned-skills/:id/status",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const skill = await store.getLearnedSkill(request.params.id);
      if (!skill) return reply.code(404).send({ error: "skill not found" });
      const status = request.body?.status;
      if (status !== "approved" && status !== "rejected" && status !== "pending") {
        return reply.code(400).send({ error: "status must be approved, rejected or pending" });
      }
      skill.status = status;
      skill.updatedAt = new Date().toISOString();
      await store.upsertLearnedSkill(skill);
      auditAdmin(request, "skill.status", `${skill.name} -> ${status}`);
      return skill;
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string; content?: string } }>(
    "/admin/learned-skills/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const skill = await store.getLearnedSkill(request.params.id);
      if (!skill) return reply.code(404).send({ error: "skill not found" });
      if (typeof request.body?.name === "string" && request.body.name.trim()) {
        skill.name = request.body.name.trim().slice(0, 80);
      }
      if (typeof request.body?.description === "string")
        skill.description = request.body.description.slice(0, 240);
      if (typeof request.body?.content === "string") skill.content = request.body.content.slice(0, 20_000);
      skill.updatedAt = new Date().toISOString();
      await store.upsertLearnedSkill(skill);
      return skill;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/learned-skills/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const skill = await store.getLearnedSkill(request.params.id);
      if (!skill) return reply.code(404).send({ error: "skill not found" });
      const removed = await store.deleteLearnedSkill(skill.createdBy ?? "", skill.id);
      if (!removed) return reply.code(400).send({ error: "could not delete" });
      auditAdmin(request, "skill.delete", skill.name);
      return reply.code(204).send();
    },
  );

  app.get("/admin/users", { preHandler: requireAdmin }, async () =>
    (await store.listUsers()).map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan ?? "free",
      createdAt: user.createdAt,
    })),
  );

  app.post<{ Params: { id: string }; Body: { role?: string } }>(
    "/admin/users/:id/role",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const role = request.body?.role;
      if (role !== "user" && role !== "admin")
        return reply.code(400).send({ error: "role must be user or admin" });
      await store.setUserRole(request.params.id, role);
      auditAdmin(request, "user.role", `${request.params.id} -> ${role}`);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { plan?: string } }>(
    "/admin/users/:id/plan",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const plan = request.body?.plan;
      if (plan !== "free" && plan !== "pro" && plan !== "business")
        return reply.code(400).send({ error: "plan must be free, pro, or business" });
      await store.setUserPlan(request.params.id, plan);
      auditAdmin(request, "user.plan", `${request.params.id} -> ${plan}`);
      return { ok: true };
    },
  );

  /* Billing policy + model pricing (admin). */
  app.get("/admin/settings", { preHandler: requireAdmin }, async () => store.getPlatformSettings());

  app.put<{ Body: Partial<PlatformSettings> }>(
    "/admin/settings",
    { preHandler: requireAdmin },
    async (request) => {
      const next: PlatformSettings = { ...(await store.getPlatformSettings()), ...(request.body ?? {}) };
      await store.savePlatformSettings(next);
      auditAdmin(request, "settings.update", "platform settings");
      return next;
    },
  );

  app.get("/admin/model-pricing", { preHandler: requireAdmin }, async () => store.listModelPricing());

  app.put<{ Params: { model: string }; Body: Partial<ModelPricingRecord> }>(
    "/admin/model-pricing/:model",
    { preHandler: requireAdmin },
    async (request) => {
      const body = request.body ?? {};
      const record: ModelPricingRecord = {
        model: request.params.model,
        provider: body.provider,
        inputCentsPerM: Number(body.inputCentsPerM ?? 0),
        outputCentsPerM: Number(body.outputCentsPerM ?? 0),
        markupPercent: body.markupPercent,
        enabled: body.enabled !== false,
        updatedAt: new Date().toISOString(),
      };
      await store.saveModelPricing(record);
      auditAdmin(request, "modelPricing.update", record.model);
      return record;
    },
  );

  app.delete<{ Params: { model: string } }>(
    "/admin/model-pricing/:model",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const removed = await store.deleteModelPricing(request.params.model);
      if (!removed) return reply.code(404).send({ error: "model not found" });
      auditAdmin(request, "modelPricing.delete", request.params.model);
      return reply.code(204).send();
    },
  );

  /* Self-learned extraction recipes (admin moderation). */
  app.get("/admin/media-recipes", { preHandler: requireAdmin }, async () => store.listMediaRecipes());

  app.put<{ Params: { domain: string }; Body: Partial<MediaRecipe> }>(
    "/admin/media-recipes/:domain",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const domain = request.params.domain.toLowerCase();
      const existing = await store.getMediaRecipe(domain);
      const body = request.body ?? {};
      const status =
        body.status === "approved" || body.status === "rejected" || body.status === "pending"
          ? body.status
          : (existing?.status ?? "pending");
      const now = new Date().toISOString();
      const record: MediaRecipe = {
        domain,
        pattern: (body.pattern ?? existing?.pattern ?? "").trim(),
        headers: body.headers ?? existing?.headers,
        status,
        createdBy: existing?.createdBy,
        note: body.note ?? existing?.note,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (!record.pattern) return reply.code(400).send({ error: "a pattern is required" });
      await store.saveMediaRecipe(record);
      auditAdmin(request, "mediaRecipe.update", `${domain} -> ${status}`);
      return record;
    },
  );

  app.delete<{ Params: { domain: string } }>(
    "/admin/media-recipes/:domain",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const removed = await store.deleteMediaRecipe(request.params.domain);
      if (!removed) return reply.code(404).send({ error: "recipe not found" });
      auditAdmin(request, "mediaRecipe.delete", request.params.domain);
      return reply.code(204).send();
    },
  );

  app.get("/admin/audit", { preHandler: requireAdmin }, async () => store.listAuditRecent(100));

  /* Billing / plans. Stripe is optional: without keys the endpoint explains
     that billing isn't configured rather than pretending to charge. */
  const chmabaConfig = chmabaConfigFromEnv();
  const billingConfigured = Boolean(chmabaConfig);

  app.get("/v1/billing", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId as string;
    const record = await store.getUserById(userId);
    const settings = await store.getPlatformSettings();
    const wallet = await store.getWallet(userId);
    const usage = await store.usageSince(userId, startOfMonth());
    const plan: Plan = record?.plan ?? "free";
    return {
      plan,
      billingMode: record?.billingMode ?? "free",
      subStatus: record?.subStatus ?? "free",
      periodEnd: record?.periodEnd,
      graceUntil: record?.graceUntil,
      walletCents: wallet.balanceCents,
      tokensThisMonth: usage.tokens,
      freeMonthlyTokens: settings.freeMonthlyTokens,
      lowBalanceCents: settings.lowBalanceCents,
      includedTokens: settings.plans.includedTokens,
      prices: {
        proCents: settings.plans.proPriceCents,
        businessCents: settings.plans.businessPriceCents,
        periodDays: settings.plans.proPeriodDays,
        currency: settings.plans.currency,
      },
      onDemand: settings.onDemand,
      billingConfigured,
    };
  });

  /** Create a ChmabaPay invoice for a plan renewal or a wallet top-up. */
  app.post<{ Body: { kind?: "plan" | "topup"; plan?: "pro" | "business"; amountCents?: number } }>(
    "/v1/billing/checkout",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!chmabaConfig) {
        return reply.code(400).send({ error: "Billing isn't configured on this server." });
      }
      const userId = request.userId as string;
      const settings = await store.getPlatformSettings();
      const kind = request.body?.kind === "topup" ? "topup" : "plan";
      let amountCents: number;
      let plan: Plan | undefined;
      if (kind === "topup") {
        amountCents = Math.round(Number(request.body?.amountCents ?? 0));
        if (amountCents < settings.onDemand.minTopUpCents) {
          return reply
            .code(400)
            .send({ error: `Minimum top-up is ${(settings.onDemand.minTopUpCents / 100).toFixed(2)}.` });
        }
      } else {
        plan = request.body?.plan === "business" ? "business" : "pro";
        amountCents = plan === "business" ? settings.plans.businessPriceCents : settings.plans.proPriceCents;
      }
      const id = `inv_${randomUUID()}`;
      const now = new Date().toISOString();
      const invoice: InvoiceRecord = {
        id,
        userId,
        kind,
        plan,
        amountCents,
        currency: settings.plans.currency,
        referenceId: id,
        providerStatus: "pending",
        status: "open",
        reminders: {},
        createdAt: now,
        updatedAt: now,
      };
      try {
        const payment = await createPayment(chmabaConfig, {
          amountCents,
          referenceId: id,
          metadata: { userId, kind, plan },
        });
        invoice.providerPaymentId = payment.id;
        invoice.checkoutUrl = payment.checkoutUrl;
        invoice.qrString = payment.qrString;
        invoice.expiresAt = payment.expiresAt;
      } catch (error) {
        return reply
          .code(502)
          .send({ error: error instanceof Error ? error.message : "ChmabaPay checkout failed." });
      }
      await store.createInvoice(invoice);
      return { invoiceId: id, url: invoice.checkoutUrl, qr: invoice.qrString };
    },
  );

  /** ChmabaPay webhook: verify the HMAC, then settle (idempotent). */
  app.post("/v1/billing/chmaba/webhook", async (request, reply) => {
    if (!chmabaConfig?.webhookSecret) return reply.code(404).send();
    const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    const header = String(request.headers["x-chambapay-signature"] ?? "");
    if (!verifyChmabaSignature(raw, header, chmabaConfig.webhookSecret)) {
      return reply.code(400).send({ error: "invalid signature" });
    }
    const event = request.body as {
      type?: string;
      data?: { payment?: { id?: string; status?: string } };
    };
    const paymentId = event?.data?.payment?.id;
    if (!paymentId) return reply.code(204).send();
    const invoice = await store.getInvoiceByProviderPayment(paymentId);
    if (!invoice) return reply.code(204).send();
    const status = event?.data?.payment?.status;
    if (status === "paid" || status === "completed" || event.type === "payment.completed") {
      await settleInvoice(store, invoice, new Date().toISOString());
    } else if (status === "expired" || event.type === "payment.expired") {
      invoice.providerStatus = "expired";
      invoice.updatedAt = new Date().toISOString();
      await store.updateInvoice(invoice);
    } else if (status === "reversed" || event.type === "payment.reversed") {
      invoice.providerStatus = "reversed";
      invoice.updatedAt = new Date().toISOString();
      await store.updateInvoice(invoice);
    }
    return reply.code(204).send();
  });

  /* API keys — the credential for the public API platform. The secret is shown
     once at creation; only a hash is stored. */
  app.get("/v1/api-keys", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId as string;
    return (await store.listApiKeys(userId)).map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
    }));
  });

  app.post<{ Body: { name?: string } }>(
    "/v1/api-keys",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const name = (request.body?.name ?? "").trim().slice(0, 60) || "API key";
      const secret = `bk_${randomBytes(24).toString("hex")}`;
      const record = {
        id: randomUUID(),
        userId,
        name,
        prefix: secret.slice(0, 11),
        keyHash: hashToken(secret),
        createdAt: new Date().toISOString(),
      };
      await store.createApiKey(record);
      // The plaintext key is returned exactly once.
      return reply.code(201).send({
        id: record.id,
        name: record.name,
        prefix: record.prefix,
        key: secret,
        createdAt: record.createdAt,
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/api-keys/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const removed = await store.revokeApiKey(request.userId as string, request.params.id);
      if (!removed) return reply.code(404).send({ error: "key not found" });
      return reply.code(204).send();
    },
  );

  app.post<{ Body: { email?: string; password?: string } }>("/auth/signup", async (request, reply) => {
    const email = (request.body?.email ?? "").trim();
    const password = request.body?.password ?? "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return reply.code(400).send({ error: "a valid email is required" });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: "password must be at least 8 characters" });
    }
    if (await store.getUserByEmail(email)) {
      return reply.code(409).send({ error: "an account with that email already exists" });
    }
    if (!signupAllowed(email)) {
      return reply.code(403).send({ error: "Signups are invite-only. Ask the operator to add your email." });
    }

    const record = {
      id: randomUUID(),
      email,
      passwordHash: hashPassword(password),
      role: roleFor(email),
      handle: await freeHandle(email),
      createdAt: new Date().toISOString(),
    };
    await store.createUser(record);

    const session = await issueSession(record.id);
    const response: AuthResponse = { ...session, user: toUser(record) };
    return reply.code(201).send(response);
  });

  app.post<{ Body: { email?: string; password?: string } }>("/auth/login", async (request, reply) => {
    const email = (request.body?.email ?? "").trim();
    const password = request.body?.password ?? "";
    const record = await store.getUserByEmail(email);
    if (!record || !verifyPassword(password, record.passwordHash)) {
      return reply.code(401).send({ error: "invalid email or password" });
    }
    if (roleFor(email) === "admin" && record.role !== "admin") {
      await store.setUserRole(record.id, "admin");
      record.role = "admin";
    }

    const session = await issueSession(record.id);
    const response: AuthResponse = { ...session, user: toUser(record) };
    return response;
  });

  /* ---------------------------------------------------------------------- */
  /* Google sign-in (browser-handled, like Grok Bot)                        */
  /* ---------------------------------------------------------------------- */
  const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const googleRedirect =
    process.env.GOOGLE_REDIRECT_URI ?? `http://localhost:${process.env.PORT ?? 8787}/auth/google/callback`;
  const pendingSignins = new Map<
    string,
    { token: string; refreshToken: string; expiresAt: string; createdAt: number }
  >();

  const page = (body: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><title>Botifyr</title>` +
    `<style>html,body{height:100%}body{background:#000;color:#ececef;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;display:flex;align-items:center;justify-content:center;padding:24px;line-height:1.5}` +
    `.wrap{width:520px;max-width:92vw}` +
    `.logo{width:44px;height:44px;border-radius:10px}` +
    `h1{font-size:24px;font-weight:600;margin:32px 0 20px}` +
    `.btn{display:inline-block;padding:10px 18px;border-radius:10px;border:none;background:#2a2a2e;color:#fff;font-size:14px;cursor:pointer}` +
    `.btn:hover{background:#34343a}` +
    `hr{border:none;border-top:1px solid #26262b;margin:34px 0 16px}` +
    `.foot{color:#8b8b92;font-size:12.5px}a{color:#8b8b92}</style></head>` +
    `<body><div class="wrap"><img class="logo" src="/logo.png" alt="Botifyr" />${body}</div></body></html>`;

  const successPage = (): string =>
    page(
      `<h1>All set! Feel free to return to Botifyr.</h1>` +
        `<a class="btn" href="botifyr://open" onclick="setTimeout(function(){window.close()},400);return true;">Open Botifyr</a>` +
        `<hr /><p class="foot">For any issues, visit <a href="https://botifyr.xyz/help">botifyr.xyz/help</a>.</p>`,
    );

  const messagePage = (message: string): string =>
    page(`<h1>${message}</h1><p class="foot">You can close this tab and return to the Botifyr app.</p>`);

  app.get("/auth/config", async () => ({ google: Boolean(googleClientId) }));

  app.get<{ Querystring: { state?: string } }>("/auth/google", async (request, reply) => {
    if (!googleClientId) {
      return reply.type("text/html").send(messagePage("Google sign-in isn't configured."));
    }
    const state = request.query.state ?? randomUUID();
    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: googleRedirect,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      state,
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/google/callback",
    async (request, reply) => {
      const { code, state, error } = request.query;
      if (error || !code || !state) {
        return reply.type("text/html").send(messagePage("Sign-in was cancelled."));
      }
      try {
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: googleClientId,
            client_secret: googleClientSecret,
            redirect_uri: googleRedirect,
            grant_type: "authorization_code",
          }),
        });
        if (!tokenResponse.ok) throw new Error(await tokenResponse.text());
        const { access_token } = (await tokenResponse.json()) as { access_token: string };

        const infoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { authorization: `Bearer ${access_token}` },
        });
        const info = (await infoResponse.json()) as { email?: string };
        if (!info.email) throw new Error("no email from Google");

        // The admin console prefixes its state with "admin:". Refuse to issue a
        // session at all unless the account is on the admin allowlist
        // (BOTIFYR_ADMIN_EMAILS) — the client can't be trusted to enforce this.
        if (state.startsWith("admin:") && roleFor(info.email) !== "admin") {
          app.log.warn({ email: info.email }, "admin sign-in denied");
          return reply
            .type("text/html")
            .header("cache-control", "no-store")
            .send(messagePage("This account isn't authorized for the admin console."));
        }

        let record = await store.getUserByEmail(info.email);
        if (!record) {
          if (!signupAllowed(info.email)) {
            app.log.warn({ email: info.email }, "google signup denied (invite-only)");
            return reply
              .type("text/html")
              .header("cache-control", "no-store")
              .send(messagePage("Botifyr is invite-only right now. Ask the operator to add your email."));
          }
          record = {
            id: randomUUID(),
            email: info.email,
            passwordHash: "google",
            role: roleFor(info.email),
            handle: await freeHandle(info.email),
            createdAt: new Date().toISOString(),
          };
          await store.createUser(record);
        } else if (roleFor(info.email) === "admin" && record.role !== "admin") {
          await store.setUserRole(record.id, "admin");
          record.role = "admin";
        }

        const session = await issueSession(record.id);
        pendingSignins.set(state, { ...session, createdAt: Date.now() });

        return reply.type("text/html").header("cache-control", "no-store").send(successPage());
      } catch (error) {
        app.log.error({ err: error }, "google sign-in failed");
        // Idempotent: authorizing once then reloading the callback reuses the
        // code (Google rejects it) — if we already have the token, still succeed.
        if (pendingSignins.has(state)) {
          return reply.type("text/html").header("cache-control", "no-store").send(successPage());
        }
        return reply
          .type("text/html")
          .header("cache-control", "no-store")
          .send(messagePage("Sign-in failed. Please try again."));
      }
    },
  );

  app.get<{ Querystring: { state?: string } }>("/auth/google/result", async (request, reply) => {
    const state = request.query.state ?? "";
    const entry = pendingSignins.get(state);
    if (!entry || Date.now() - entry.createdAt > 10 * 60 * 1000) {
      return reply.code(404).send({ error: "pending" });
    }
    return { token: entry.token, refreshToken: entry.refreshToken, expiresAt: entry.expiresAt };
  });

  /* ---------------------------------------------------------------------- */
  /* Connect apps (Gmail / Calendar / Drive) — real Google OAuth            */
  /* ---------------------------------------------------------------------- */
  const googleConnectRedirect =
    process.env.GOOGLE_CONNECT_REDIRECT_URI ??
    `http://localhost:${process.env.PORT ?? 8787}/auth/google/connect/callback`;
  const CONNECT_SCOPES: Record<string, string[]> = {
    gmail: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
    calendar: ["https://www.googleapis.com/auth/calendar"],
    drive: ["https://www.googleapis.com/auth/drive.readonly"],
  };
  const pendingConnects = new Map<string, { userId: string; provider: string; createdAt: number }>();

  app.get("/v1/connections", { preHandler: requireAuth }, async (request) => {
    const records = await store.listConnections(request.userId as string);
    const list: ConnectionInfo[] = records.map((record) => ({
      provider: record.provider,
      connectedAt: record.createdAt,
    }));
    return list;
  });

  app.post<{ Params: { provider: string } }>(
    "/v1/connections/:provider/start",
    { preHandler: requireAuth },
    async (request, reply) => {
      const provider = request.params.provider;
      if (!CONNECT_SCOPES[provider]) return reply.code(400).send({ error: "unknown app" });
      if (!googleClientId) return reply.code(400).send({ error: "Google OAuth is not configured" });
      const state = randomUUID();
      pendingConnects.set(state, { userId: request.userId as string, provider, createdAt: Date.now() });
      return {
        url: `http://localhost:${process.env.PORT ?? 8787}/auth/google/connect?provider=${provider}&state=${state}`,
      };
    },
  );

  app.delete<{ Params: { provider: string } }>(
    "/v1/connections/:provider",
    { preHandler: requireAuth },
    async (request, reply) => {
      await store.deleteConnection(request.userId as string, request.params.provider);
      return reply.code(204).send();
    },
  );

  // Token-based connection (apps with a personal access token, e.g. GitHub).
  const TOKEN_APPS = new Set(["github", "notion", "slack", "linear", "telegram"]);
  app.post<{ Params: { provider: string }; Body: { token?: string } }>(
    "/v1/connections/:provider/token",
    { preHandler: requireAuth },
    async (request, reply) => {
      const provider = request.params.provider;
      if (!TOKEN_APPS.has(provider)) return reply.code(400).send({ error: "unknown app" });
      const token = (request.body?.token ?? "").trim();
      if (!token) return reply.code(400).send({ error: "a token is required" });
      const encrypted = encryptSecret(
        vaultKey,
        JSON.stringify({ accessToken: token, refreshToken: null, expiresAt: null }),
      );
      const now = new Date().toISOString();
      await store.upsertConnection({
        id: randomUUID(),
        userId: request.userId as string,
        provider,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        createdAt: now,
      });
      return { provider, connectedAt: now };
    },
  );

  app.get<{ Querystring: { provider?: string; state?: string } }>(
    "/auth/google/connect",
    async (request, reply) => {
      const provider = request.query.provider ?? "";
      const state = request.query.state ?? "";
      const scopes = CONNECT_SCOPES[provider];
      const pending = pendingConnects.get(state);
      if (!googleClientId || !scopes || !pending) {
        return reply.type("text/html").send(messagePage("That connection isn't available."));
      }
      const params = new URLSearchParams({
        client_id: googleClientId,
        redirect_uri: googleConnectRedirect,
        response_type: "code",
        scope: ["openid", "email", ...scopes].join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
      });
      return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/google/connect/callback",
    async (request, reply) => {
      const { code, state } = request.query;
      const pending = state ? pendingConnects.get(state) : undefined;
      if (!code || !state || !pending) {
        return reply
          .type("text/html")
          .header("cache-control", "no-store")
          .send(messagePage("Connection was cancelled."));
      }
      try {
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: googleClientId,
            client_secret: googleClientSecret,
            redirect_uri: googleConnectRedirect,
            grant_type: "authorization_code",
          }),
        });
        if (!tokenResponse.ok) throw new Error(await tokenResponse.text());
        const tokens = (await tokenResponse.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
        };
        const payload = JSON.stringify({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
        });
        const encrypted = encryptSecret(vaultKey, payload);
        await store.upsertConnection({
          id: randomUUID(),
          userId: pending.userId,
          provider: pending.provider,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          tag: encrypted.tag,
          createdAt: new Date().toISOString(),
        });
        pendingConnects.delete(state);
        return reply
          .type("text/html")
          .header("cache-control", "no-store")
          .send(
            page(
              `<h1>${pending.provider} is connected.</h1>` +
                `<p class="foot">You can close this tab and return to the Botifyr app.</p>`,
            ),
          );
      } catch (error) {
        app.log.error({ err: error }, "google connect failed");
        return reply
          .type("text/html")
          .header("cache-control", "no-store")
          .send(messagePage("Could not connect. Please try again."));
      }
    },
  );

  /* ------------------------------------------------------------------------ */
  /* Authenticated                                                            */
  /* ------------------------------------------------------------------------ */

  // Exchange a (one-time) refresh token for a fresh access token. Rotation
  // means a stolen refresh token is usable at most once, and the old one dies.
  app.post<{ Body: { refreshToken?: string } }>("/auth/refresh", async (request, reply) => {
    const provided = (request.body?.refreshToken ?? "").trim();
    if (!provided) return reply.code(400).send({ error: "refreshToken is required" });
    const hash = hashToken(provided);
    const userId = await store.getUserIdByTokenHash(hash, "refresh");
    if (!userId) return reply.code(401).send({ error: "invalid or expired refresh token" });
    await store.deleteToken(hash);
    const record = await store.getUserById(userId);
    if (!record) return reply.code(401).send({ error: "user not found" });
    const session = await issueSession(userId);
    return { ...session, user: toUser(record) };
  });

  app.post<{ Body: { refreshToken?: string } }>(
    "/auth/logout",
    { preHandler: requireAuth },
    async (request, reply) => {
      const token = bearer(request);
      if (token) await store.deleteToken(hashToken(token));
      const refresh = (request.body?.refreshToken ?? "").trim();
      if (refresh) await store.deleteToken(hashToken(refresh));
      return reply.code(204).send();
    },
  );

  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const record = await store.getUserById(request.userId as string);
    if (!record) return reply.code(404).send({ error: "user not found" });
    // Backfill a handle for accounts created before profiles existed.
    if (!record.handle) {
      record.handle = await freeHandle(record.email);
      await store.updateUserProfile(record.id, { handle: record.handle });
    }
    return toUser(record);
  });

  /* Bots: each bot is an agent with its own conversation thread. */
  app.get("/v1/bots", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId as string;
    const bots = await store.listBots(userId);
    if (bots.length > 0) return bots;
    // First run: give the account a default bot to talk to.
    const seeded = await createBotFor(userId, {
      name: "Botifyr",
      emoji: "🤖",
      scheme: 0,
      instructions: "",
    });
    return [seeded];
  });

  app.post<{
    Body: {
      name?: string;
      emoji?: string;
      scheme?: number;
      instructions?: string;
      workspace?: string;
      memberIds?: string[];
      autonomous?: boolean;
      skills?: string[];
      autoApprove?: boolean;
    };
  }>("/v1/bots", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId as string;
    const name = (request.body?.name ?? "").trim();
    if (!name) return reply.code(400).send({ error: "a bot name is required" });
    if (name.length > 40) return reply.code(400).send({ error: "name must be 40 characters or fewer" });
    const emoji = (request.body?.emoji ?? "🤖").trim().slice(0, 8) || "🤖";
    const scheme = Number.isInteger(request.body?.scheme) ? Number(request.body?.scheme) : 0;
    const instructions = (request.body?.instructions ?? "").slice(0, 4000);
    const workspace = (request.body?.workspace ?? "").trim().slice(0, 60) || undefined;
    // Group: keep only member ids that belong to this user (individual bots,
    // never another group).
    let memberIds: string[] | undefined;
    if (Array.isArray(request.body?.memberIds) && request.body.memberIds.length > 0) {
      const owned = await store.listBots(userId);
      const ownedIds = new Set(
        owned.filter((entry) => !(entry.memberIds && entry.memberIds.length > 0)).map((entry) => entry.id),
      );
      memberIds = request.body.memberIds.filter((id) => ownedIds.has(id));
      if (memberIds.length === 0) memberIds = undefined;
    }

    const bot = await createBotFor(userId, {
      name,
      emoji,
      scheme,
      instructions,
      workspace,
      memberIds,
      autonomous: request.body?.autonomous === true,
      autoApprove: request.body?.autoApprove === true,
      skills: Array.isArray(request.body?.skills)
        ? request.body.skills.filter((id) => SKILLS.some((skill) => skill.id === id))
        : undefined,
    });
    return reply.code(201).send(bot);
  });

  app.delete<{ Params: { id: string } }>(
    "/v1/bots/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const bot = await store.getBot(request.params.id);
      if (!bot || bot.userId !== userId) return reply.code(404).send({ error: "bot not found" });
      await store.deleteBot(userId, bot.id);
      return reply.code(204).send();
    },
  );

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      emoji?: string;
      scheme?: number;
      instructions?: string;
      workspace?: string;
      memberIds?: string[];
      autonomous?: boolean;
      skills?: string[];
      autoApprove?: boolean;
      schedule?: { prompt?: string; everyMinutes?: number; enabled?: boolean };
    };
  }>("/v1/bots/:id", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId as string;
    const bot = await store.getBot(request.params.id);
    if (!bot || bot.userId !== userId) return reply.code(404).send({ error: "bot not found" });

    if (typeof request.body?.name === "string" && request.body.name.trim()) {
      const name = request.body.name.trim().slice(0, 40);
      bot.name = name;
      const session = await store.getSession(bot.sessionId);
      if (session) {
        session.title = name;
        await store.updateSession(session);
        emit({ type: "session.updated", session });
      }
    }
    if (typeof request.body?.emoji === "string") {
      bot.emoji = request.body.emoji.trim().slice(0, 8) || bot.emoji;
    }
    if (Number.isInteger(request.body?.scheme)) bot.scheme = Number(request.body?.scheme);
    if (typeof request.body?.instructions === "string")
      bot.instructions = request.body.instructions.slice(0, 4000);
    if (typeof request.body?.workspace === "string")
      bot.workspace = request.body.workspace.trim().slice(0, 60) || undefined;

    // Group membership: keep only ids the user owns (excluding the bot itself
    // and other groups — groups hold individual bots, never nested groups).
    if (Array.isArray(request.body?.memberIds)) {
      const owned = await store.listBots(userId);
      const ownedIds = new Set(
        owned
          .filter((entry) => entry.id !== bot.id && !(entry.memberIds && entry.memberIds.length > 0))
          .map((entry) => entry.id),
      );
      const members = request.body.memberIds.filter((id) => ownedIds.has(id));
      bot.memberIds = members.length > 0 ? members : undefined;
    }

    // Skills: keep only known ids.
    if (Array.isArray(request.body?.skills)) {
      const skills = request.body.skills.filter((id) => SKILLS.some((skill) => skill.id === id));
      bot.skills = skills.length > 0 ? skills : undefined;
    }

    if (typeof request.body?.autonomous === "boolean") {
      bot.autonomous = request.body.autonomous || undefined;
    }

    if (typeof request.body?.autoApprove === "boolean") {
      bot.autoApprove = request.body.autoApprove || undefined;
    }

    // Schedule: run a prompt automatically every N minutes.
    if (request.body?.schedule && typeof request.body.schedule === "object") {
      const prompt = (request.body.schedule.prompt ?? "").trim().slice(0, 2000);
      const everyMinutes = Math.max(1, Math.min(10080, Number(request.body.schedule.everyMinutes ?? 60)));
      if (!prompt) {
        bot.schedule = undefined;
      } else {
        const previous = bot.schedule;
        const changed = !previous || previous.prompt !== prompt || previous.everyMinutes !== everyMinutes;
        bot.schedule = {
          prompt,
          everyMinutes,
          enabled: request.body.schedule.enabled !== false,
          nextRunAt: changed
            ? new Date(Date.now() + everyMinutes * 60_000).toISOString()
            : previous?.nextRunAt,
        };
      }
    }

    await store.updateBot(bot);
    return bot;
  });

  /* ---------------------------------------------------------------------- */
  /* Company workspaces (see docs/company-workspace.md)                      */
  /* ---------------------------------------------------------------------- */

  const workspaceView = async (record: Workspace): Promise<WorkspaceWithRoles> => {
    const roles: BotRole[] = await store.listBotRoles(record.id);
    return { ...record, roles };
  };

  /** Propose an org chart from a website or an idea (creates nothing). */
  app.post<{ Body: { source?: { kind?: string; value?: string }; name?: string } }>(
    "/v1/workspaces/plan",
    { preHandler: requireAuth },
    async (request, reply) => {
      const value = (request.body?.source?.value ?? "").trim().slice(0, 1000);
      if (!value) return reply.code(400).send({ error: "a website URL or an idea is required" });
      const kind = request.body?.source?.kind === "url" ? "url" : "idea";
      return planCompany({ kind, value, name: request.body?.name?.trim().slice(0, 60) }, oneShot);
    },
  );

  app.get("/v1/workspaces", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId as string;
    const workspaces = await store.listWorkspaces(userId);
    return Promise.all(workspaces.map((workspace) => workspaceView(workspace)));
  });

  app.get<{ Params: { id: string } }>(
    "/v1/workspaces/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const workspace = await store.getWorkspace(request.params.id);
      if (!workspace || workspace.ownerId !== userId) {
        return reply.code(404).send({ error: "workspace not found" });
      }
      return workspaceView(workspace);
    },
  );

  app.post<{ Body: CreateWorkspaceRequest }>(
    "/v1/workspaces",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const name = (request.body?.name ?? "").trim().slice(0, 60);
      if (!name) return reply.code(400).send({ error: "a workspace name is required" });

      const now = new Date().toISOString();
      const workspace: Workspace = {
        id: randomUUID(),
        ownerId: userId,
        name,
        source: {
          kind: request.body?.source?.kind === "url" ? "url" : "idea",
          value: (request.body?.source?.value ?? "").trim().slice(0, 500),
        },
        mission: (request.body?.mission ?? "").slice(0, 2000),
        status: "active",
        avatarEmoji: request.body?.avatarEmoji?.trim().slice(0, 8) || undefined,
        scheme: Number.isInteger(request.body?.scheme) ? Number(request.body?.scheme) : undefined,
        createdAt: now,
        updatedAt: now,
      };
      await store.createWorkspace(workspace);

      // New employee bots, each created with a role. The bot's `workspace`
      // label matches the company name so the sidebar groups them together.
      let chairBotId: string | undefined;
      const members = Array.isArray(request.body?.members) ? request.body.members.slice(0, 20) : [];
      for (const member of members) {
        const botName = (member?.name ?? "").trim().slice(0, 40);
        if (!botName) continue;
        const bot = await createBotFor(userId, {
          name: botName,
          emoji: (member.emoji ?? "🤖").trim().slice(0, 8) || "🤖",
          scheme: Number.isInteger(member.scheme) ? Number(member.scheme) : 0,
          instructions: (member.instructions ?? "").slice(0, 4000),
          workspace: name,
        });
        await store.setBotRole({
          workspaceId: workspace.id,
          botId: bot.id,
          title: (member.title ?? "Member").trim().slice(0, 40) || "Member",
          department: toDepartment(member.department),
          isChair: member.isChair === true,
          hiredAt: now,
        });
        if (member.isChair === true && !chairBotId) chairBotId = bot.id;
      }

      // Existing owned bots attached with a role.
      const memberships = Array.isArray(request.body?.memberships)
        ? request.body.memberships.slice(0, 50)
        : [];
      if (memberships.length > 0) {
        const owned = new Set((await store.listBots(userId)).map((entry) => entry.id));
        for (const membership of memberships) {
          if (!membership?.botId || !owned.has(membership.botId)) continue;
          await store.setBotRole({
            workspaceId: workspace.id,
            botId: membership.botId,
            title: (membership.title ?? "Member").trim().slice(0, 40) || "Member",
            department: toDepartment(membership.department),
            managerBotId: membership.managerBotId,
            isChair: membership.isChair === true,
            hiredAt: now,
          });
          if (membership.isChair === true && !chairBotId) chairBotId = membership.botId;
        }
      }

      if (chairBotId) {
        workspace.ceoBotId = chairBotId;
        await store.updateWorkspace(workspace);
      }
      return reply.code(201).send(await workspaceView(workspace));
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      mission?: string;
      status?: Workspace["status"];
      avatarEmoji?: string;
      scheme?: number;
      ceoBotId?: string;
    };
  }>("/v1/workspaces/:id", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId as string;
    const workspace = await store.getWorkspace(request.params.id);
    if (!workspace || workspace.ownerId !== userId) {
      return reply.code(404).send({ error: "workspace not found" });
    }
    if (typeof request.body?.name === "string" && request.body.name.trim()) {
      workspace.name = request.body.name.trim().slice(0, 60);
    }
    if (typeof request.body?.mission === "string") {
      workspace.mission = request.body.mission.slice(0, 2000);
    }
    const status = request.body?.status;
    if (status && ["onboarding", "active", "paused", "archived"].includes(status)) {
      workspace.status = status;
    }
    if (typeof request.body?.avatarEmoji === "string") {
      workspace.avatarEmoji = request.body.avatarEmoji.trim().slice(0, 8) || undefined;
    }
    if (Number.isInteger(request.body?.scheme)) workspace.scheme = Number(request.body.scheme);
    if (typeof request.body?.ceoBotId === "string") {
      workspace.ceoBotId = request.body.ceoBotId || undefined;
    }
    workspace.updatedAt = new Date().toISOString();
    await store.updateWorkspace(workspace);
    return workspaceView(workspace);
  });

  app.delete<{ Params: { id: string } }>(
    "/v1/workspaces/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const ok = await store.deleteWorkspace(userId, request.params.id);
      if (!ok) return reply.code(404).send({ error: "workspace not found" });
      return reply.code(204).send();
    },
  );

  /* Bot Library: text files a bot can keep and the agent can read/write. */
  const toBotFile = (record: FileRecord): BotFile => ({
    id: record.id,
    botId: record.botId,
    name: record.name,
    size: record.content.length,
    updatedAt: record.updatedAt,
  });

  app.get<{ Params: { id: string } }>(
    "/v1/bots/:id/files",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const bot = await store.getBot(request.params.id);
      if (!bot || bot.userId !== userId) return reply.code(404).send({ error: "bot not found" });
      return (await store.listFiles(bot.id)).map(toBotFile);
    },
  );

  app.post<{ Params: { id: string }; Body: { name?: string; content?: string } }>(
    "/v1/bots/:id/files",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const bot = await store.getBot(request.params.id);
      if (!bot || bot.userId !== userId) return reply.code(404).send({ error: "bot not found" });
      const name = (request.body?.name ?? "").trim().slice(0, 120);
      if (!name) return reply.code(400).send({ error: "a file name is required" });
      const content = String(request.body?.content ?? "").slice(0, 200_000);
      const existing = (await store.listFiles(bot.id)).find((file) => file.name === name);
      const now = new Date().toISOString();
      const record: FileRecord = {
        id: existing?.id ?? randomUUID(),
        botId: bot.id,
        userId,
        name,
        content,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await store.upsertFile(record);
      return reply.code(existing ? 200 : 201).send(toBotFile(record));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/files/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const file = await store.getFile(request.userId as string, request.params.id);
      if (!file) return reply.code(404).send({ error: "file not found" });
      return file;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/files/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const removed = await store.deleteFile(request.userId as string, request.params.id);
      if (!removed) return reply.code(404).send({ error: "file not found" });
      return reply.code(204).send();
    },
  );

  app.post("/v1/sessions", { preHandler: requireAuth }, async (request) => {
    const session: Session = {
      id: randomUUID(),
      userId: request.userId as string,
      title: "New chat",
      messages: [],
      createdAt: new Date().toISOString(),
    };
    await store.createSession(session);
    rememberSession(session.id, session.userId);
    emit({ type: "session.created", session });
    return session;
  });

  app.get("/v1/sessions", { preHandler: requireAuth }, async (request) => {
    return store.listSessions(request.userId as string);
  });

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      return session;
    },
  );

  // Send a chat message: appends the user turn and runs the agent with context.
  app.post<{ Params: { id: string }; Body: { text?: string; local?: boolean } }>(
    "/v1/sessions/:id/messages",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      const text = (request.body?.text ?? "").trim();
      if (!text) return reply.code(400).send({ error: "text is required" });

      const userId = request.userId as string;
      if (!rateLimitOk(userId)) {
        return reply
          .code(429)
          .send({ error: "You've reached the message limit for now — please try again later." });
      }
      if (await budgetBlocked(userId)) {
        return reply
          .code(429)
          .send({ error: "Daily token budget reached — try again tomorrow or raise the budget." });
      }
      const billingReason = await billingBlockReason(userId);
      if (billingReason) return reply.code(402).send({ error: billingReason });
      const warning = await budgetWarning(userId);

      // Natural-language stop: "stop", "cancel", "stop this download".
      if (text.length <= 80 && /\b(stop|cancel|abort|halt)\b/i.test(text)) {
        const running = runningTasksForSession(session.id);
        const now = new Date().toISOString();
        let replyText = "Nothing is running right now.";
        if (running.length > 0) {
          for (const taskId of running) {
            cancelTask(taskId);
            const active = await store.getTask(taskId);
            if (active && active.status !== "completed" && active.status !== "failed") {
              active.status = "cancelled";
              active.error = "Stopped by you.";
              active.updatedAt = new Date().toISOString();
              await store.updateTask(active);
              emit({ type: "task.updated", task: active });
            }
          }
          replyText = "Stopped.";
        }
        await withSessionLock(session.id, async () => {
          const fresh = (await store.getSession(session.id)) ?? session;
          fresh.messages.push({ id: randomUUID(), role: "user", content: text, createdAt: now });
          fresh.messages.push({ id: randomUUID(), role: "assistant", content: replyText, createdAt: now });
          await store.updateSession(fresh);
          session.messages = fresh.messages;
        });
        emit({ type: "session.updated", session });
        return { session, warning: warning ?? undefined };
      }

      const task = await startTask(session, text, userId, request.body?.local === true);
      return { session, task, warning: warning ?? undefined };
    },
  );

  /* Direct messages and friend group chats between users. */
  app.get("/v1/conversations", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId as string;
    const sessions = await store.listConversations(userId);
    return sessions
      .filter((session) => session.kind === "dm" || session.kind === "group")
      .map((session) => ({
        id: session.id,
        kind: session.kind,
        title: session.title,
        participants: session.participants ?? [],
        last: session.messages[session.messages.length - 1],
        createdAt: session.createdAt,
      }));
  });

  app.post<{ Params: { userId: string } }>(
    "/v1/dm/:userId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const otherId = request.params.userId;
      if (otherId === userId) return reply.code(400).send({ error: "you can't message yourself" });
      if (!(await store.areFriends(userId, otherId))) {
        return reply.code(403).send({ error: "you're not friends yet" });
      }
      const other = await store.getUserById(otherId);
      if (!other) return reply.code(404).send({ error: "user not found" });
      const existing = (await store.listConversations(userId)).find(
        (session) =>
          session.kind === "dm" &&
          (session.participants ?? []).length === 2 &&
          (session.participants ?? []).includes(otherId),
      );
      if (existing) return existing;
      const session = {
        id: randomUUID(),
        userId,
        title: other.displayName || (other.handle ? `@${other.handle}` : other.email),
        messages: [],
        createdAt: new Date().toISOString(),
        kind: "dm" as const,
        participants: [userId, otherId],
      };
      await store.createSession(session);
      emit({ type: "session.created", session });
      return session;
    },
  );

  app.post<{ Body: { participantIds?: string[]; title?: string } }>(
    "/v1/conversations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const ids = Array.isArray(request.body?.participantIds) ? request.body.participantIds : [];
      const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== userId))];
      if (unique.length < 2) return reply.code(400).send({ error: "pick at least two friends" });
      for (const id of unique) {
        if (!(await store.areFriends(userId, id))) {
          return reply.code(403).send({ error: "you can only add friends" });
        }
      }
      const title = (request.body?.title ?? "").trim().slice(0, 60) || "New group";
      const session = {
        id: randomUUID(),
        userId,
        title,
        messages: [],
        createdAt: new Date().toISOString(),
        kind: "group" as const,
        participants: [userId, ...unique],
      };
      await store.createSession(session);
      emit({ type: "session.created", session });
      return session;
    },
  );

  app.post<{ Params: { id: string }; Body: { text?: string } }>(
    "/v1/dm/:id/messages",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const session = await store.getSession(request.params.id);
      if (!session || !(session.participants ?? []).includes(userId)) {
        return reply.code(404).send({ error: "conversation not found" });
      }
      const text = (request.body?.text ?? "").trim().slice(0, maxMessageChars);
      if (!text) return reply.code(400).send({ error: "text is required" });
      const message = {
        id: randomUUID(),
        role: "user" as const,
        content: text,
        createdAt: new Date().toISOString(),
        senderId: userId,
      };
      await withSessionLock(session.id, async () => {
        const fresh = (await store.getSession(session.id)) ?? session;
        fresh.messages.push(message);
        await store.updateSession(fresh);
        session.messages = fresh.messages;
      });
      emit({ type: "session.updated", session });
      return { session };
    },
  );

  // Stop every running task in a chat (covers all members of a group at once).
  app.post<{ Params: { id: string } }>(
    "/v1/sessions/:id/cancel",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      const running = runningTasksForSession(session.id);
      for (const taskId of running) {
        cancelTask(taskId);
        const active = await store.getTask(taskId);
        if (active && active.status !== "completed" && active.status !== "failed") {
          active.status = "cancelled";
          active.error = "Stopped by you.";
          active.updatedAt = new Date().toISOString();
          await store.updateTask(active);
          emit({ type: "task.updated", task: active });
        }
      }
      return { stopped: running.length };
    },
  );

  // Re-run the last user turn (Regenerate).
  app.post<{ Params: { id: string }; Body: { local?: boolean } }>(
    "/v1/sessions/:id/retry",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      const userId = request.userId as string;
      if (!rateLimitOk(userId)) {
        return reply
          .code(429)
          .send({ error: "You've reached the message limit for now — please try again later." });
      }
      if (await budgetBlocked(userId)) {
        return reply
          .code(429)
          .send({ error: "Daily token budget reached — try again tomorrow or raise the budget." });
      }
      const billingReason = await billingBlockReason(userId);
      if (billingReason) return reply.code(402).send({ error: billingReason });
      const warning = await budgetWarning(userId);
      try {
        const task = await retryTask(session, userId, request.body?.local === true);
        return { session, task, warning: warning ?? undefined };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "retry failed" });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { goal?: string } }>(
    "/v1/sessions/:id/tasks",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      const goal = (request.body?.goal ?? "").trim();
      if (!goal) return reply.code(400).send({ error: "goal is required" });

      const userId = request.userId as string;
      if (!rateLimitOk(userId)) {
        return reply
          .code(429)
          .send({ error: "You've reached the message limit for now — please try again later." });
      }

      if (await budgetBlocked(userId)) {
        return reply
          .code(429)
          .send({ error: "Daily token budget reached — try again tomorrow or raise the budget." });
      }
      const billingReason = await billingBlockReason(userId);
      if (billingReason) return reply.code(402).send({ error: billingReason });

      return startTask(session, goal, userId);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/tasks/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const task = await ownedTask(request, request.params.id);
      if (!task) return reply.code(404).send({ error: "task not found" });
      return task;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/tasks/:id/screenshot",
    { preHandler: requireAuth },
    async (request, reply) => {
      const task = await ownedTask(request, request.params.id);
      if (!task) return reply.code(404).send({ error: "task not found" });
      const png = getScreenshot(task.id);
      if (!png) return reply.code(404).send({ error: "no screenshot captured yet" });
      return reply.header("cache-control", "no-store").type("image/png").send(png);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/tasks/:id/audit",
    { preHandler: requireAuth },
    async (request, reply) => {
      const task = await ownedTask(request, request.params.id);
      if (!task) return reply.code(404).send({ error: "task not found" });
      const records = await store.listAudit(task.id);
      const events: AuditEvent[] = records.map((record) => ({
        id: record.id,
        taskId: record.taskId,
        userId: record.userId,
        type: record.type as AuditEvent["type"],
        toolName: record.toolName,
        detail: record.detail,
        createdAt: record.createdAt,
      }));
      return events;
    },
  );

  /* ------------------------------------------------------------------------ */
  /* People: profiles, friend requests, friends (with presence)               */
  /* ------------------------------------------------------------------------ */
  const personOf = (record: {
    id: string;
    handle?: string;
    displayName?: string;
    avatarEmoji?: string;
    avatarScheme?: number;
  }) => ({
    id: record.id,
    handle: record.handle,
    displayName: record.displayName,
    avatarEmoji: record.avatarEmoji,
    avatarScheme: record.avatarScheme,
    online: isOnline(record.id),
  });

  app.patch<{
    Body: { handle?: string; displayName?: string; avatarEmoji?: string; avatarScheme?: number };
  }>("/v1/profile", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId as string;
    const profile: { handle?: string; displayName?: string; avatarEmoji?: string; avatarScheme?: number } =
      {};
    if (typeof request.body?.handle === "string") {
      const handle = slugify(request.body.handle);
      if (handle.length < 3) return reply.code(400).send({ error: "handle must be at least 3 characters" });
      const existing = await store.getUserByHandle(handle);
      if (existing && existing.id !== userId) return reply.code(409).send({ error: "that handle is taken" });
      profile.handle = handle;
    }
    if (typeof request.body?.displayName === "string")
      profile.displayName = request.body.displayName.slice(0, 40);
    if (typeof request.body?.avatarEmoji === "string")
      profile.avatarEmoji = request.body.avatarEmoji.trim().slice(0, 8);
    if (Number.isInteger(request.body?.avatarScheme))
      profile.avatarScheme = Number(request.body?.avatarScheme);
    await store.updateUserProfile(userId, profile);
    const record = await store.getUserById(userId);
    return record ? toUser(record) : reply.code(404).send({ error: "not found" });
  });

  app.get<{ Querystring: { q?: string } }>("/v1/people", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId as string;
    const query = String((request.query as { q?: string } | undefined)?.q ?? "").trim();
    if (query.length < 1) return [];
    const results = await store.searchUsers(query, userId, 20);
    const friendIds = new Set(await store.listFriends(userId));
    const requests = await store.listFriendRequests(userId);
    const outgoing = new Set(
      requests.filter((r) => r.status === "pending" && r.fromUserId === userId).map((r) => r.toUserId),
    );
    const incoming = new Set(
      requests.filter((r) => r.status === "pending" && r.toUserId === userId).map((r) => r.fromUserId),
    );
    return results.map((record) => ({
      ...personOf(record),
      friend: friendIds.has(record.id),
      requested: outgoing.has(record.id),
      incoming: incoming.has(record.id),
    }));
  });

  app.get("/v1/friends", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId as string;
    const ids = await store.listFriends(userId);
    const people = await Promise.all(ids.map((id) => store.getUserById(id)));
    return people.filter((record): record is NonNullable<typeof record> => Boolean(record)).map(personOf);
  });

  app.get("/v1/friend-requests", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId as string;
    const requests = (await store.listFriendRequests(userId)).filter((r) => r.status === "pending");
    const cache = new Map<string, ReturnType<typeof personOf> | null>();
    const out: Array<{ id: string; direction: "incoming" | "outgoing"; person: unknown }> = [];
    for (const request of requests) {
      const otherId = request.fromUserId === userId ? request.toUserId : request.fromUserId;
      if (!cache.has(otherId)) {
        const record = await store.getUserById(otherId);
        cache.set(otherId, record ? personOf(record) : null);
      }
      const person = cache.get(otherId);
      if (person)
        out.push({
          id: request.id,
          direction: request.fromUserId === userId ? "outgoing" : "incoming",
          person,
        });
    }
    return out;
  });

  app.post<{ Body: { userId?: string; handle?: string } }>(
    "/v1/friend-requests",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      let target = request.body?.userId ? await store.getUserById(request.body.userId) : null;
      if (!target && request.body?.handle) target = await store.getUserByHandle(request.body.handle);
      if (!target) return reply.code(404).send({ error: "user not found" });
      if (target.id === userId) return reply.code(400).send({ error: "you can't add yourself" });
      if (await store.areFriends(userId, target.id)) return { ok: true, friend: true };
      const existing = (await store.listFriendRequests(userId)).find(
        (record) =>
          record.status === "pending" &&
          ((record.fromUserId === userId && record.toUserId === target?.id) ||
            (record.fromUserId === target?.id && record.toUserId === userId)),
      );
      if (existing) {
        if (existing.toUserId === userId) {
          existing.status = "accepted";
          existing.updatedAt = new Date().toISOString();
          await store.updateFriendRequest(existing);
          await store.createFriendship(userId, target.id);
          emit({ type: "friend.request", requestId: existing.id, fromUserId: userId, toUserId: target.id });
          return { ok: true, friend: true };
        }
        return { ok: true, pending: true };
      }
      const now = new Date().toISOString();
      const record = {
        id: randomUUID(),
        fromUserId: userId,
        toUserId: target.id,
        status: "pending" as const,
        createdAt: now,
        updatedAt: now,
      };
      await store.createFriendRequest(record);
      emit({ type: "friend.request", requestId: record.id, fromUserId: userId, toUserId: target.id });
      return { ok: true, pending: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { action?: string } }>(
    "/v1/friend-requests/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const record = await store.getFriendRequest(request.params.id);
      if (!record || record.toUserId !== userId || record.status !== "pending") {
        return reply.code(404).send({ error: "request not found" });
      }
      record.status = request.body?.action === "accept" ? "accepted" : "declined";
      record.updatedAt = new Date().toISOString();
      await store.updateFriendRequest(record);
      if (record.status === "accepted") {
        await store.createFriendship(record.fromUserId, record.toUserId);
        emit({
          type: "friend.request",
          requestId: record.id,
          fromUserId: userId,
          toUserId: record.fromUserId,
        });
      }
      return { ok: true, friend: record.status === "accepted" };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/friends/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      await store.deleteFriendship(request.userId as string, request.params.id);
      return reply.code(204).send();
    },
  );

  /* Downloads produced by a task (e.g. youtube.download), served to the user. */
  const downloadsRoot = process.env.BOTIFYR_DOWNLOADS_DIR ?? "/downloads";

  /** Read a task's download folder and record each file in the media manifest. */
  const trackTaskMedia = async (userId: string, taskId: string): Promise<void> => {
    try {
      const dir = join(downloadsRoot, taskId);
      const entries = await readdir(dir);
      for (const name of entries) {
        const info = await stat(join(dir, name)).catch(() => null);
        if (!info?.isFile()) continue;
        const mime = name.endsWith(".mp3")
          ? "audio/mpeg"
          : name.endsWith(".mp4")
            ? "video/mp4"
            : "application/octet-stream";
        const stamp = new Date().toISOString();
        await store
          .upsertMedia({
            id: `${taskId}:${name}`,
            userId,
            taskId,
            name,
            size: info.size,
            mime,
            location: "server",
            createdAt: stamp,
            updatedAt: stamp,
          })
          .catch(() => {});
      }
    } catch {
      // No folder for this task yet.
    }
  };

  app.get<{ Params: { id: string } }>(
    "/v1/tasks/:id/downloads",
    { preHandler: requireAuth },
    async (request, reply) => {
      const task = await ownedTask(request, request.params.id);
      if (!task) return reply.code(404).send({ error: "task not found" });
      const userId = request.userId as string;
      try {
        await trackTaskMedia(userId, task.id);
        const dir = join(downloadsRoot, task.id);
        const entries = await readdir(dir);
        const files: Array<{ name: string; size: number }> = [];
        for (const name of entries) {
          const info = await stat(join(dir, name));
          if (info.isFile()) files.push({ name, size: info.size });
        }
        return files;
      } catch {
        return [];
      }
    },
  );

  /* Media manifest: what the user has downloaded and where each item lives. */
  app.get("/v1/media", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId as string;
    // Backfill from the volume so the history is complete even for older tasks
    // that were never opened in the app.
    const tasks = await store.listTasksForUser(userId).catch(() => []);
    for (const task of tasks) {
      await trackTaskMedia(userId, task.id);
    }
    const items = await store.listMedia(userId);
    return items.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      name: item.name,
      size: item.size,
      mime: item.mime,
      location: item.location,
      device: item.device,
      createdAt: item.createdAt,
    }));
  });

  app.patch<{ Params: { id: string }; Body: { location?: string; device?: string } }>(
    "/v1/media/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const record = await store.getMedia(userId, request.params.id);
      if (!record) return reply.code(404).send({ error: "media not found" });
      if (request.body?.location === "device" || request.body?.location === "server") {
        record.location = request.body.location;
      }
      if (typeof request.body?.device === "string") {
        record.device = request.body.device.trim().slice(0, 80) || undefined;
      }
      record.updatedAt = new Date().toISOString();
      await store.updateMedia(record);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { purge?: string } }>(
    "/v1/media/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const record = await store.getMedia(userId, request.params.id);
      if (!record) return reply.code(404).send({ error: "media not found" });
      if (request.query.purge === "1") {
        await rm(join(downloadsRoot, record.taskId, basename(record.name)), { force: true }).catch(() => {});
      }
      await store.deleteMedia(userId, record.id);
      return reply.code(204).send();
    },
  );

  /* Signed, recipient-scoped links so a file can be shared with a friend
     without exposing the sender's token or creating a public URL. */
  const signShare = (payload: Record<string, unknown>): string => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = createHmac("sha256", vaultKey).update(body).digest("base64url");
    return `${body}.${mac}`;
  };

  const verifyShare = (token: string): { t: string; n: string; r: string; e: number } | null => {
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const expected = createHmac("sha256", vaultKey).update(body).digest("base64url");
    const given = Buffer.from(mac);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
        t: string;
        n: string;
        r: string;
        e: number;
      };
      if (!payload.t || !payload.n || !payload.r || typeof payload.e !== "number" || payload.e < Date.now()) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  };

  app.post<{ Params: { id: string }; Body: { toUserId?: string } }>(
    "/v1/media/:id/share",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const record = await store.getMedia(userId, request.params.id);
      if (!record) return reply.code(404).send({ error: "media not found" });
      const toUserId = (request.body?.toUserId ?? "").trim();
      if (!toUserId) return reply.code(400).send({ error: "toUserId is required" });
      if (!(await store.areFriends(userId, toUserId))) {
        return reply.code(403).send({ error: "you can only share with friends" });
      }
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const token = signShare({ t: record.taskId, n: record.name, r: toUserId, e: Date.parse(expiresAt) });
      return { token, expiresAt };
    },
  );

  app.get<{ Querystring: { share?: string } }>(
    "/v1/shared",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const payload = verifyShare(request.query.share ?? "");
      if (!payload || payload.r !== userId) {
        return reply.code(403).send({ error: "invalid or expired share link" });
      }
      const safeName = basename(payload.n);
      const filePath = join(downloadsRoot, payload.t, safeName);
      const type = safeName.endsWith(".mp3")
        ? "audio/mpeg"
        : safeName.endsWith(".mp4")
          ? "video/mp4"
          : "application/octet-stream";
      const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      const disposition = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
      try {
        const info = await stat(filePath);
        if (!info.isFile()) throw new Error("not a file");
        return reply
          .header("content-length", info.size)
          .header("content-disposition", disposition)
          .type(type)
          .send(createReadStream(filePath));
      } catch {
        return reply.code(404).send({ error: "file not found" });
      }
    },
  );

  app.delete<{ Params: { id: string; name: string } }>(
    "/v1/tasks/:id/downloads/:name",
    { preHandler: requireAuth },
    async (request, reply) => {
      const task = await ownedTask(request, request.params.id);
      if (!task) return reply.code(404).send({ error: "task not found" });
      const safeName = basename(request.params.name);
      await rm(join(downloadsRoot, task.id, safeName), { force: true }).catch(() => {});
      await store.deleteMedia(request.userId as string, `${task.id}:${safeName}`).catch(() => {});
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string; name: string }; Querystring: { download?: string } }>(
    "/v1/tasks/:id/downloads/:name",
    { preHandler: requireAuth },
    async (request, reply) => {
      const task = await ownedTask(request, request.params.id);
      if (!task) return reply.code(404).send({ error: "task not found" });
      const safeName = basename(request.params.name);
      const filePath = join(downloadsRoot, task.id, safeName);
      const type = safeName.endsWith(".mp3")
        ? "audio/mpeg"
        : safeName.endsWith(".mp4")
          ? "video/mp4"
          : "application/octet-stream";
      // Inline by default so videos/audio play in the browser; ?download=1 saves.
      const disposition = request.query.download === "1" ? "attachment" : "inline";
      // HTTP headers must be ASCII: use an ASCII fallback plus RFC 5987 UTF-8.
      const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      const dispositionHeader = `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
      try {
        const info = await stat(filePath);
        if (!info.isFile()) throw new Error("not a file");
        const range = request.headers.range;
        const match = typeof range === "string" ? /bytes=(\d*)-(\d*)/.exec(range) : null;
        if (match) {
          const start = match[1] ? Number(match[1]) : 0;
          const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
          if (start > end) {
            return reply.code(416).header("content-range", `bytes */${info.size}`).send();
          }
          return reply
            .code(206)
            .header("content-range", `bytes ${start}-${end}/${info.size}`)
            .header("accept-ranges", "bytes")
            .header("content-length", end - start + 1)
            .header("content-disposition", dispositionHeader)
            .type(type)
            .send(createReadStream(filePath, { start, end }));
        }
        return reply
          .header("accept-ranges", "bytes")
          .header("content-length", info.size)
          .header("content-disposition", dispositionHeader)
          .type(type)
          .send(createReadStream(filePath));
      } catch {
        return reply.code(404).send({ error: "file not found" });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/tasks/:id/stream",
    { preHandler: requireAuth },
    async (request, reply): Promise<void> => {
      const task = await ownedTask(request, request.params.id);
      if (!task) {
        reply.code(404).send({ error: "task not found" });
        return;
      }
      const backend = getComputerSandbox(task.id);
      const base = backend?.streamUrl ? await backend.streamUrl() : null;
      if (!base) {
        reply.code(404).send({ error: "no live desktop for this task" });
        return;
      }
      const upstream = await fetch(`${base}/stream`);
      if (!upstream.ok || !upstream.body) {
        reply.code(502).send({ error: "desktop stream unavailable" });
        return;
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": upstream.headers.get("content-type") ?? "multipart/x-mixed-replace; boundary=frame",
        "cache-control": "no-store",
      });
      const reader = upstream.body.getReader();
      request.raw.on("close", () => {
        void reader.cancel();
      });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(Buffer.from(value));
        }
      } catch {
        // client or upstream closed
      }
      reply.raw.end();
    },
  );

  /* Recorded input per session, for teach-by-demonstration. */
  const sessionTraces = new Map<
    string,
    Array<{ t: number; action: string; args: Record<string, unknown> }>
  >();

  /** Pull the JSON trace back out of a learned task's content. */
  const parseTrace = (content: string): Array<{ action: string; args: Record<string, unknown> }> => {
    const match = /Trace \(JSON\):\s*(\[[\s\S]*\])\s*$/.exec(content);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[1]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  /* "Botifyr's screen": a session-scoped desktop the user can start and watch
     (and drive) without running a task — the basis for teach-by-demonstration. */
  app.post<{ Params: { id: string } }>(
    "/v1/sessions/:id/computer",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      const key = `session:${session.id}`;
      if (!getComputerSandbox(key)) {
        setComputerSandbox(key, createDockerComputerBackend());
      }
      return { ok: true, streaming: true };
    },
  );

  /* Stop and remove a session's desktop container (frees CPU/RAM). */
  app.post<{ Params: { id: string } }>(
    "/v1/sessions/:id/computer/stop",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      const key = `session:${session.id}`;
      const backend = getComputerSandbox(key);
      if (backend) await backend.close().catch(() => {});
      clearComputerSandbox(key);
      return { ok: true };
    },
  );

  /* Forward UI input (click/type/key/scroll) into the session's desktop — the
     user drives the screen, which is how teach-by-demonstration is captured. */
  app.post<{ Params: { id: string }; Body: { action?: string; args?: Record<string, unknown> } }>(
    "/v1/sessions/:id/computer/input",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      const backend = getComputerSandbox(`session:${session.id}`);
      touchComputerSandbox(`session:${session.id}`);
      if (!backend) return reply.code(409).send({ error: "start Botifyr's screen first" });
      const args = request.body?.args ?? {};
      const trace = sessionTraces.get(session.id) ?? [];
      trace.push({ t: Date.now(), action: request.body?.action ?? "", args });
      sessionTraces.set(session.id, trace);
      switch (request.body?.action) {
        case "click":
          await backend.click(Number(args.x), Number(args.y), Number(args.button) || 1);
          break;
        case "move":
          await backend.move(Number(args.x), Number(args.y));
          break;
        case "type":
          await backend.type(String(args.text ?? ""));
          break;
        case "key":
          await backend.key(String(args.key ?? ""));
          break;
        case "scroll":
          await backend.scroll(Number(args.amount) || 3);
          break;
        default:
          return reply.code(400).send({ error: "unknown input action" });
      }
      return { ok: true };
    },
  );

  /* The recorded input trace, and turning it into a learned task. */
  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/computer/trace",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      return { steps: sessionTraces.get(session.id) ?? [] };
    },
  );

  app.post<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    "/v1/sessions/:id/computer/learn",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      const trace = sessionTraces.get(session.id) ?? [];
      if (trace.length === 0) return reply.code(400).send({ error: "nothing recorded to learn yet" });
      const userId = request.userId as string;
      const existing = await store.listLearnedSkills();
      const name = (request.body?.name ?? `Learned task ${existing.length + 1}`).trim().slice(0, 80);
      const lines = trace.map((step, index) => {
        if (step.action === "click") return `${index + 1}. Click (${step.args.x}, ${step.args.y})`;
        if (step.action === "type") return `${index + 1}. Type "${String(step.args.text ?? "")}"`;
        if (step.action === "key") return `${index + 1}. Press ${String(step.args.key ?? "")}`;
        if (step.action === "scroll") return `${index + 1}. Scroll ${String(step.args.amount ?? "")}`;
        return `${index + 1}. ${step.action}`;
      });
      const now = new Date().toISOString();
      const record: LearnedSkillRecord = {
        id: randomUUID(),
        name,
        description: (request.body?.description ?? "Taught by demonstration on Botifyr's screen.").slice(
          0,
          300,
        ),
        content: `Recorded from a demonstration.\n\nSteps:\n${lines.join("\n")}\n\nTrace (JSON):\n${JSON.stringify(trace)}`,
        source: "computer-trace",
        createdBy: userId,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
      await store.upsertLearnedSkill(record);
      // Clear the trace so the next lesson starts clean.
      sessionTraces.set(session.id, []);
      return { ok: true, id: record.id, name };
    },
  );

  /* Replay a learned task's steps on the session's desktop. */
  app.post<{ Params: { id: string }; Body: { name?: string; id?: string } }>(
    "/v1/sessions/:id/computer/replay",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      const backend = getComputerSandbox(`session:${session.id}`);
      if (!backend) return reply.code(409).send({ error: "start Botifyr's screen first" });
      const skill = request.body?.id
        ? await store.getLearnedSkill(request.body.id)
        : request.body?.name
          ? await store.getLearnedSkillByName(request.body.name)
          : null;
      if (!skill) return reply.code(404).send({ error: "learned task not found" });
      const steps = parseTrace(skill.content);
      if (steps.length === 0) return reply.code(400).send({ error: "this task has no recorded steps" });
      let ran = 0;
      for (const step of steps) {
        const args = step.args ?? {};
        if (step.action === "click")
          await backend.click(Number(args.x), Number(args.y), Number(args.button) || 1);
        else if (step.action === "move") await backend.move(Number(args.x), Number(args.y));
        else if (step.action === "type") await backend.type(String(args.text ?? ""));
        else if (step.action === "key") await backend.key(String(args.key ?? ""));
        else if (step.action === "scroll") await backend.scroll(Number(args.amount) || 3);
        else continue;
        ran += 1;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return { ok: true, steps: ran };
    },
  );

  /* Start/stop screen recording, and download the latest recording. */
  app.post<{ Params: { id: string }; Body: { on?: boolean } }>(
    "/v1/sessions/:id/computer/record",
    { preHandler: requireAuth },
    async (request, reply) => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        return reply.code(404).send({ error: "session not found" });
      }
      const backend = getComputerSandbox(`session:${session.id}`);
      if (!backend?.record) return reply.code(409).send({ error: "recording isn't available" });
      const result = await backend.record(request.body?.on !== false);
      return { ok: result.ok, output: result.output };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/computer/recording",
    { preHandler: requireAuth },
    async (request, reply): Promise<void> => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        reply.code(404).send({ error: "session not found" });
        return;
      }
      const backend = getComputerSandbox(`session:${session.id}`);
      const bytes = backend?.recording ? await backend.recording() : null;
      if (!bytes) {
        reply.code(404).send({ error: "no recording yet — record, then stop, to produce one" });
        return;
      }
      return reply
        .header("content-type", "video/mp4")
        .header("cache-control", "no-store")
        .header("content-length", bytes.length)
        .send(bytes);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/stream",
    { preHandler: requireAuth },
    async (request, reply): Promise<void> => {
      const session = await store.getSession(request.params.id);
      if (!session || session.userId !== request.userId) {
        reply.code(404).send({ error: "session not found" });
        return;
      }
      const backend = getComputerSandbox(`session:${session.id}`);
      touchComputerSandbox(`session:${session.id}`);
      const base = backend?.streamUrl ? await backend.streamUrl() : null;
      if (!base) {
        reply.code(404).send({ error: "no live desktop for this session" });
        return;
      }
      const upstream = await fetch(`${base}/stream`);
      if (!upstream.ok || !upstream.body) {
        reply.code(502).send({ error: "desktop stream unavailable" });
        return;
      }
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": upstream.headers.get("content-type") ?? "multipart/x-mixed-replace; boundary=frame",
        "cache-control": "no-store",
      });
      const reader = upstream.body.getReader();
      request.raw.on("close", () => {
        void reader.cancel();
      });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(Buffer.from(value));
        }
      } catch {
        // client or upstream closed
      }
      reply.raw.end();
    },
  );

  app.post<{ Params: { id: string; approvalId: string }; Body: { decision?: "allow" | "deny" } }>(
    "/v1/tasks/:id/approvals/:approvalId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const task = await ownedTask(request, request.params.id);
      if (!task) return reply.code(404).send({ error: "task not found" });

      const decision = request.body?.decision;
      if (decision !== "allow" && decision !== "deny") {
        return reply.code(400).send({ error: "decision must be 'allow' or 'deny'" });
      }

      const approval = await resolveTaskApproval(store, task, request.params.approvalId, decision);
      if (!approval) return reply.code(404).send({ error: "pending approval not found" });

      return { task, approval };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/tasks/:id/cancel",
    { preHandler: requireAuth },
    async (request, reply) => {
      const task = await ownedTask(request, request.params.id);
      if (!task) return reply.code(404).send({ error: "task not found" });
      cancelTask(task.id);
      // Release a pending approval so the runner isn't stuck waiting on it.
      if (task.approval && task.approval.status === "pending") {
        await resolveTaskApproval(store, task, task.approval.id, "deny").catch(() => {});
      }
      if (task.status !== "completed" && task.status !== "failed") {
        task.status = "cancelled";
        task.error = "Stopped by you.";
        task.updatedAt = new Date().toISOString();
        await store.updateTask(task);
        emit({ type: "task.updated", task });
        emit({ type: "task.failed", task });
      }
      return reply.code(204).send();
    },
  );

  /* Secrets (encrypted at rest) */
  app.post<{ Body: { name?: string; value?: string } }>(
    "/v1/secrets",
    { preHandler: requireAuth },
    async (request, reply) => {
      const name = (request.body?.name ?? "").trim();
      const value = request.body?.value ?? "";
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
        return reply.code(400).send({ error: "name must be 1-64 chars of letters, digits, . _ -" });
      }
      if (!value) return reply.code(400).send({ error: "value is required" });
      if (await store.getSecret(request.userId as string, name)) {
        return reply.code(409).send({ error: "a secret with that name already exists" });
      }

      const encrypted = encryptSecret(vaultKey, value);
      const record = {
        id: randomUUID(),
        userId: request.userId as string,
        name,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        createdAt: new Date().toISOString(),
      };
      await store.createSecret(record);
      const summary: SecretSummary = { id: record.id, name: record.name, createdAt: record.createdAt };
      return reply.code(201).send(summary);
    },
  );

  app.get("/v1/secrets", { preHandler: requireAuth }, async (request) => {
    const records = await store.listSecrets(request.userId as string);
    const summaries: SecretSummary[] = records.map((record) => ({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
    }));
    return summaries;
  });

  app.delete<{ Params: { id: string } }>(
    "/v1/secrets/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const removed = await store.deleteSecret(request.userId as string, request.params.id);
      if (!removed) return reply.code(404).send({ error: "secret not found" });
      return reply.code(204).send();
    },
  );

  /* Channels: authenticated local chat (and Telegram when configured) */
  app.post<{ Body: { text?: string; conversationId?: string } }>(
    "/channels/local/messages",
    { preHandler: requireAuth },
    async (request, reply) => {
      const text = (request.body?.text ?? "").trim();
      if (!text) return reply.code(400).send({ error: "text is required" });
      const conversationId = request.body?.conversationId ?? (request.userId as string);
      await localChannel.receive(conversationId, text, request.userId as string);
      return { ok: true, conversationId };
    },
  );

  app.get<{ Querystring: { conversationId?: string } }>(
    "/channels/local/messages",
    { preHandler: requireAuth },
    async (request) => {
      const conversationId = request.query.conversationId ?? (request.userId as string);
      return localChannel.messages(conversationId);
    },
  );

  /* Realtime stream (authenticated + per-user filtered) */
  app.get("/v1/stream", { websocket: true }, async (socket, request) => {
    const token =
      (request.query as { token?: string } | undefined)?.token ?? bearer(request as FastifyRequest);
    const userId = token ? await store.getUserIdByTokenHash(hashToken(token)) : null;
    const ws = ((socket as { socket?: SocketLike }).socket ?? socket) as SocketLike;

    if (!userId) {
      ws.close?.();
      return;
    }

    const unsubscribe = subscribe((event: ServerEvent) => {
      if (!canReceive(userId, event)) return;
      try {
        ws.send(JSON.stringify(event));
      } catch {
        // socket closed
      }
    });
    noteOnline(
      userId,
      String((request.query as { device?: string } | undefined)?.device ?? "default").slice(0, 60),
      String((request.query as { deviceName?: string } | undefined)?.deviceName ?? "").slice(0, 60),
    );
    ws.addEventListener?.("close", () => {
      unsubscribe();
      noteOffline(
        userId,
        String((request.query as { device?: string } | undefined)?.device ?? "default").slice(0, 60),
      );
    });
  });

  /* Devices of the signed-in user that are online (for P2P transfers). */
  app.get("/v1/devices", { preHandler: requireAuth }, async (request) => {
    const perDevice =
      devices.get(request.userId as string) ?? new Map<string, { name: string; count: number }>();
    return [...perDevice.entries()].map(([id, entry]) => ({
      id,
      name: entry.name || id,
      online: true,
    }));
  });

  /* WebRTC signaling relay: delivered to the user's own devices. */
  app.post<{ Body: { to?: string; from?: string; data?: unknown } }>(
    "/v1/signal",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId as string;
      const to = String(request.body?.to ?? "").slice(0, 60);
      if (!to) return reply.code(400).send({ error: "missing target device" });
      emit({
        type: "p2p.signal",
        toUserId: userId,
        to,
        from: String(request.body?.from ?? "unknown").slice(0, 60),
        data: request.body?.data ?? null,
      });
      return { ok: true };
    },
  );

  // Local node: a process on the user's own machine that exposes a local browser.
  app.get("/v1/node", { websocket: true }, async (socket, request) => {
    const token =
      (request.query as { token?: string } | undefined)?.token ?? bearer(request as FastifyRequest);
    const userId = token ? await store.getUserIdByTokenHash(hashToken(token)) : null;
    const ws = ((socket as { socket?: SocketLike }).socket ?? socket) as SocketLike;

    if (!userId) {
      ws.close?.();
      return;
    }

    const { id, unregister } = registerNode(userId, ws, "node", "unknown");
    ws.addEventListener?.("message", (event) => {
      const data = (event as { data?: unknown }).data;
      try {
        handleNodeMessage(id, JSON.parse(typeof data === "string" ? data : String(data)));
      } catch {
        // ignore malformed frames
      }
    });
    ws.addEventListener?.("close", () => unregister());
  });

  // Mint a long-lived token for a local node, so users don't paste passwords.
  app.post("/v1/node-token", { preHandler: requireAuth }, async (request) => {
    const { token, tokenHash, expiresAt } = createToken(90);
    await store.createToken(tokenHash, request.userId as string, expiresAt);
    return { token, expiresAt };
  });

  // Always-on bots: fire scheduled prompts while the cloud is running.
  /* Media retention: drop old task folders and keep the volume under quota. */
  const retentionDays = Number(process.env.BOTIFYR_MEDIA_RETENTION_DAYS ?? 30);
  const quotaBytes = Number(process.env.BOTIFYR_MEDIA_QUOTA_MB ?? 0) * 1024 * 1024;

  const folderInfo = async (dir: string): Promise<{ size: number; newest: number }> => {
    let size = 0;
    let newest = 0;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const inner = await folderInfo(full);
        size += inner.size;
        newest = Math.max(newest, inner.newest);
      } else {
        const info = await stat(full);
        size += info.size;
        newest = Math.max(newest, info.mtimeMs);
      }
    }
    return { size, newest };
  };

  const cleanupMedia = async (): Promise<void> => {
    let entries;
    try {
      entries = await readdir(downloadsRoot, { withFileTypes: true });
    } catch {
      return; // volume not mounted yet
    }
    const folders: Array<{ taskId: string; size: number; newest: number }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const info = await folderInfo(join(downloadsRoot, entry.name)).catch(() => null);
      if (info) folders.push({ taskId: entry.name, ...info });
    }
    // Oldest first, so quota trimming drops the least recently used.
    folders.sort((a, b) => a.newest - b.newest);
    const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 24 * 60 * 60 * 1000 : 0;

    let total = folders.reduce((sum, folder) => sum + folder.size, 0);
    let removed = 0;
    for (const folder of folders) {
      const expired = cutoff > 0 && folder.newest < cutoff;
      const overQuota = quotaBytes > 0 && total > quotaBytes;
      if (!expired && !overQuota) continue;
      await rm(join(downloadsRoot, folder.taskId), { recursive: true, force: true }).catch(() => {});
      await store.deleteMediaByTask(folder.taskId).catch(() => {});
      total -= folder.size;
      removed += 1;
    }
    if (removed > 0) {
      app.log.info({ removed, totalBytes: total }, "media cleanup removed old task folders");
    }
  };

  if (retentionDays > 0 || quotaBytes > 0) {
    void cleanupMedia();
  }
  const cleanupTimer = setInterval(
    () => void cleanupMedia(),
    Math.max(5, Number(process.env.BOTIFYR_MEDIA_CLEANUP_MINUTES ?? 360)) * 60_000,
  );

  /* Tasks that were mid-flight when the process last stopped can't be resumed
     from memory, so mark them failed instead of leaving them "running" forever.
     Re-sending the request re-runs them (yt-dlp resumes partial files). */
  try {
    const orphaned = await store.listActiveTasks();
    for (const task of orphaned) {
      task.status = "failed";
      task.error = "Interrupted when the cloud restarted — send the message again to resume.";
      task.updatedAt = new Date().toISOString();
      for (const step of task.steps) {
        if (step.status === "running" || step.status === "pending") step.status = "failed";
      }
      await store.updateTask(task);
    }
    if (orphaned.length > 0) {
      app.log.warn({ count: orphaned.length }, "reconciled interrupted tasks as failed");
    }
  } catch (error) {
    app.log.error({ err: error }, "task reconciliation failed");
  }

  const scheduler = setInterval(() => {
    void (async () => {
      try {
        const now = Date.now();
        const scheduled = await store.listScheduledBots();
        for (const bot of scheduled) {
          const schedule = bot.schedule;
          if (!schedule?.enabled) continue;
          if (schedule.nextRunAt && new Date(schedule.nextRunAt).getTime() > now) continue;
          // Advance first so a slow run can't double-fire.
          bot.schedule = {
            ...schedule,
            nextRunAt: new Date(now + schedule.everyMinutes * 60_000).toISOString(),
          };
          await store.updateBot(bot);
          const session = await store.getSession(bot.sessionId);
          if (session) {
            app.log.info({ botId: bot.id, userId: bot.userId }, "scheduler: firing scheduled bot");
            await runScheduled(session, bot, schedule.prompt);
          }
        }
      } catch (error) {
        app.log.error({ err: error }, "scheduler tick failed");
      }
    })();
  }, 30_000);

  // Billing: hourly tick — reminders (7/3/1 days), grace, downgrade, reconciliation.
  const billingTimer = setInterval(
    () => {
      void runBillingTick(store, chmabaConfig, (plan, settings) =>
        plan === "business" ? settings.plans.businessPriceCents : settings.plans.proPriceCents,
      )
        .then((summary) => {
          if (summary.reminded || summary.downgraded || summary.settled) {
            app.log.info(summary, "billing tick");
          }
        })
        .catch((error) => app.log.error({ err: error }, "billing tick failed"));
    },
    60 * 60 * 1000,
  );

  // Stop session desktops idle for a while (BOTIFYR_COMPUTER_IDLE_MINUTES, default 10).
  const computerIdleMs = Math.max(60_000, Number(process.env.BOTIFYR_COMPUTER_IDLE_MINUTES ?? 10) * 60_000);
  const computerTimer = setInterval(() => {
    for (const key of takeIdleComputerSandboxes(computerIdleMs, Date.now())) {
      const backend = getComputerSandbox(key);
      if (backend) void backend.close().catch(() => {});
      clearComputerSandbox(key);
    }
  }, 60_000);

  app.addHook("onClose", async () => {
    clearInterval(scheduler);
    clearInterval(cleanupTimer);
    clearInterval(billingTimer);
    clearInterval(computerTimer);
  });

  return app;
}
