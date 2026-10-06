import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  AuditEvent,
  AuthResponse,
  Bot,
  BotFile,
  ConnectionInfo,
  SecretSummary,
  ServerEvent,
  Session,
  Task,
  User,
} from "@botifyr/shared";
import type { LocalChannel } from "@botifyr/channels";
import { emit, subscribe } from "./events.js";
import {
  getComputerSandbox,
  getScreenshot,
  ownerOfEventTask,
  ownerOfSession,
  rememberSession,
  rememberTask,
} from "./runtime.js";
import { resolveTaskApproval } from "./approvals.js";
import { handleNodeMessage, nodeInfo, registerNode } from "./nodes.js";
import { createToken, hashPassword, hashToken, verifyPassword } from "./auth.js";
import { encryptSecret } from "./vault.js";
import { runTask, runtimeInfo, summarizeConversation } from "./runner.js";
import type { Store } from "./store/index.js";
import type { FileRecord } from "./store/types.js";

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

export interface ServerOptions {
  store: Store;
  vaultKey: Buffer;
  localChannel: LocalChannel;
}

export async function buildServer(options: ServerOptions) {
  const { store, vaultKey, localChannel } = options;

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

  /** Returns a non-blocking warning when the user is over the daily budget. */
  async function budgetWarning(userId: string): Promise<string | null> {
    if (dailyTokenBudget <= 0) return null;
    const { tokens } = await store.usageSince(userId, startOfToday());
    if (tokens >= dailyTokenBudget) {
      return `Daily token budget reached (${tokens.toLocaleString()} tokens). Messages still work — raise BOTIFYR_DAILY_TOKEN_BUDGET to increase it.`;
    }
    return null;
  }
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
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

  const requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearer(request) ?? tokenFromQuery(request);
    if (!token) {
      await reply.code(401).send({ error: "missing bearer token" });
      return;
    }
    const userId = await store.getUserIdByTokenHash(hashToken(token));
    if (!userId) {
      await reply.code(401).send({ error: "invalid or expired token" });
      return;
    }
    request.userId = userId;
  };

  const toUser = (record: { id: string; email: string; createdAt: string }): User => ({
    id: record.id,
    email: record.email,
    createdAt: record.createdAt,
  });

  const canReceive = (userId: string, event: ServerEvent): boolean => {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        return event.session.userId === userId;
      case "assistant.delta":
        // Route by task owner (set for every run) and fall back to session owner.
        return ownerOfEventTask(event.taskId) === userId || ownerOfSession(event.sessionId) === userId;
      case "task.created":
      case "task.updated":
      case "task.completed":
      case "task.failed":
        return ownerOfEventTask(event.task.id) === userId;
      case "approval.requested":
      case "approval.resolved":
        return ownerOfEventTask(event.taskId) === userId;
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
    if (summarizeEnabled && session.messages.length > windowSize) {
      const boundary = session.messages.length - windowSize;
      const already = session.summaryUpTo ?? 0;
      if (boundary > already) {
        const older = session.messages
          .slice(already, boundary)
          .map((message) => `${message.role}: ${message.content.slice(0, maxMessageChars)}`)
          .join("\n");
        const summary = await summarizeConversation(session.summary ? `${session.summary}\n${older}` : older);
        if (summary) {
          session.summary = summary;
          session.summaryUpTo = boundary;
          await store.updateSession(session);
        }
      }
    }

    const history = session.messages
      .slice(-windowSize)
      .map((message) => ({ role: message.role, content: message.content.slice(0, maxMessageChars) }));
    // A bot owns its thread, so keep the bot's name as the title.
    if (session.messages.length === 0 && !session.botId) session.title = capped.slice(0, 60);

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
    session.messages.push({
      id: randomUUID(),
      role: "user",
      content: capped,
      createdAt: now,
      taskId: task.id,
    });

    await store.updateSession(session);
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
      const responders = mentioned.length > 0 ? mentioned : members;
      void (async () => {
        for (const member of responders) {
          const latest = (await store.getSession(session.id)) ?? session;
          const memberHistory = latest.messages.slice(-windowSize).map((message) => ({
            role: message.role,
            content: message.content.slice(0, maxMessageChars),
          }));
          await runTask(
            {
              store,
              userId,
              history: memberHistory,
              local,
              instructions: `In this group chat you are "${member.name}". ${member.instructions}`.trim(),
              summary: latest.summary,
              vaultKey,
              author: { id: member.id },
            },
            task,
          ).catch((error) => app.log.error({ err: error, taskId: task.id }, "group member run failed"));
        }
      })();
    } else {
      void runTask(
        {
          store,
          userId,
          history,
          local,
          instructions: bot?.instructions,
          summary: session.summary,
          vaultKey,
          author: bot ? { id: bot.id } : undefined,
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

    void runTask(
      {
        store,
        userId,
        history,
        local,
        instructions: bot?.instructions,
        summary: session.summary,
        vaultKey,
        author: bot ? { id: bot.id } : undefined,
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
        instructions: bot.instructions,
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
    input: { name: string; emoji: string; scheme: number; instructions: string; memberIds?: string[] },
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
      memberIds: input.memberIds && input.memberIds.length > 0 ? input.memberIds : undefined,
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
    return {
      ...runtimeInfo(),
      store: (process.env.BOTIFYR_STORE ?? "memory").toLowerCase(),
      nodeOnline: nodeInfo(request.userId as string).online,
      limits: { rateLimitPerHour, maxOutputTokens, maxHistoryTurns, dailyTokenBudget },
      usage: { tokensToday: usage.tokens, requestsToday: usage.requests },
    };
  });

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

    const record = {
      id: randomUUID(),
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    await store.createUser(record);

    const { token, tokenHash, expiresAt } = createToken();
    await store.createToken(tokenHash, record.id, expiresAt);

    const response: AuthResponse = { token, user: toUser(record) };
    return reply.code(201).send(response);
  });

  app.post<{ Body: { email?: string; password?: string } }>("/auth/login", async (request, reply) => {
    const email = (request.body?.email ?? "").trim();
    const password = request.body?.password ?? "";
    const record = await store.getUserByEmail(email);
    if (!record || !verifyPassword(password, record.passwordHash)) {
      return reply.code(401).send({ error: "invalid email or password" });
    }

    const { token, tokenHash, expiresAt } = createToken();
    await store.createToken(tokenHash, record.id, expiresAt);

    const response: AuthResponse = { token, user: toUser(record) };
    return response;
  });

  /* ---------------------------------------------------------------------- */
  /* Google sign-in (browser-handled, like Grok Bot)                        */
  /* ---------------------------------------------------------------------- */
  const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const googleRedirect =
    process.env.GOOGLE_REDIRECT_URI ?? `http://localhost:${process.env.PORT ?? 8787}/auth/google/callback`;
  const pendingSignins = new Map<string, { token: string; createdAt: number }>();

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

        let record = await store.getUserByEmail(info.email);
        if (!record) {
          record = {
            id: randomUUID(),
            email: info.email,
            passwordHash: "google",
            createdAt: new Date().toISOString(),
          };
          await store.createUser(record);
        }

        const issued = createToken();
        await store.createToken(issued.tokenHash, record.id, issued.expiresAt);
        pendingSignins.set(state, { token: issued.token, createdAt: Date.now() });

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
    return { token: entry.token };
  });

  /* ---------------------------------------------------------------------- */
  /* Connect apps (Gmail / Calendar / Drive) — real Google OAuth            */
  /* ---------------------------------------------------------------------- */
  const googleConnectRedirect =
    process.env.GOOGLE_CONNECT_REDIRECT_URI ??
    `http://localhost:${process.env.PORT ?? 8787}/auth/google/connect/callback`;
  const CONNECT_SCOPES: Record<string, string[]> = {
    gmail: ["https://www.googleapis.com/auth/gmail.readonly"],
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

  app.post("/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const token = bearer(request);
    if (token) await store.deleteToken(hashToken(token));
    return reply.code(204).send();
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const record = await store.getUserById(request.userId as string);
    if (!record) return reply.code(404).send({ error: "user not found" });
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
    Body: { name?: string; emoji?: string; scheme?: number; instructions?: string; memberIds?: string[] };
  }>("/v1/bots", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId as string;
    const name = (request.body?.name ?? "").trim();
    if (!name) return reply.code(400).send({ error: "a bot name is required" });
    if (name.length > 40) return reply.code(400).send({ error: "name must be 40 characters or fewer" });
    const emoji = (request.body?.emoji ?? "🤖").trim().slice(0, 8) || "🤖";
    const scheme = Number.isInteger(request.body?.scheme) ? Number(request.body?.scheme) : 0;
    const instructions = (request.body?.instructions ?? "").slice(0, 4000);
    // Group: keep only member ids that belong to this user.
    let memberIds: string[] | undefined;
    if (Array.isArray(request.body?.memberIds) && request.body.memberIds.length > 0) {
      const owned = await store.listBots(userId);
      const ownedIds = new Set(owned.map((entry) => entry.id));
      memberIds = request.body.memberIds.filter((id) => ownedIds.has(id));
      if (memberIds.length === 0) memberIds = undefined;
    }

    const bot = await createBotFor(userId, { name, emoji, scheme, instructions, memberIds });
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
      memberIds?: string[];
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

    // Group membership: keep only ids the user owns (excluding the bot itself).
    if (Array.isArray(request.body?.memberIds)) {
      const owned = await store.listBots(userId);
      const ownedIds = new Set(owned.filter((entry) => entry.id !== bot.id).map((entry) => entry.id));
      const members = request.body.memberIds.filter((id) => ownedIds.has(id));
      bot.memberIds = members.length > 0 ? members : undefined;
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
      const warning = await budgetWarning(userId);

      const task = await startTask(session, text, userId, request.body?.local === true);
      return { session, task, warning: warning ?? undefined };
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
    ws.addEventListener?.("close", () => unsubscribe());
  });

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
  app.addHook("onClose", async () => clearInterval(scheduler));

  return app;
}
