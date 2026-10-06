import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  AuditEvent,
  Bot,
  ConnectionInfo,
  RuntimeConfig,
  SecretSummary,
  ServerEvent,
  Session,
  Task,
  User,
} from "@botifyr/shared";
import { invoke } from "@tauri-apps/api/core";
import { AuthError, BotifyrClient } from "./api";
import { CalendarIcon, DriveIcon, GmailIcon } from "./AppIcons";
import { BOT_SCHEMES, BotLogo } from "./BotLogo";
import { Markdown } from "./Markdown";
import "./styles.css";

const CLOUD_URL = (import.meta.env.VITE_CLOUD_URL as string | undefined) ?? "http://localhost:8787";
const TOKEN_KEY = "botifyr.token";

type ConnectionState = "connecting" | "online" | "offline";

function token(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

const PENDING_KEY = "botifyr.pendingState";

async function focusWindow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.unminimize();
    await win.setFocus();
  } catch {
    // not running in the desktop app
  }
}

export default function App() {
  const client = useMemo(() => new BotifyrClient(CLOUD_URL), []);

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [signinUrl, setSigninUrl] = useState<string | null>(null);

  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [limitWarning, setLimitWarning] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [useComputer, setUseComputer] = useState(() => localStorage.getItem("botifyr.useComputer") === "1");

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [showConnectApps, setShowConnectApps] = useState(false);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [stream, setStream] = useState<{
    sessionId: string;
    taskId: string;
    botId?: string;
    text: string;
  } | null>(null);
  const [createBotMode, setCreateBotMode] = useState<"bot" | "group" | "edit" | null>(null);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);
  const [botName, setBotName] = useState("");
  const [botEmoji, setBotEmoji] = useState("🤖");
  const [botScheme, setBotScheme] = useState(0);
  const [botIntro, setBotIntro] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [schedulePrompt, setSchedulePrompt] = useState("");
  const [scheduleEvery, setScheduleEvery] = useState(60);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");

  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeSessionId;
  const nodeStartedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cancelSigninRef = useRef(false);

  // Restore a stored token on launch; resume a pending sign-in if any.
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      client.setToken(stored);
      client
        .me()
        .then((account) => setUser(account))
        .catch(() => {
          localStorage.removeItem(TOKEN_KEY);
          client.setToken(null);
        })
        .finally(() => setAuthChecked(true));
      return;
    }

    setAuthChecked(true);
    const pending = localStorage.getItem(PENDING_KEY);
    if (pending) {
      setAuthBusy(true);
      void pollForToken(pending).finally(() => setAuthBusy(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Once authenticated: load conversations and open the realtime stream.
  useEffect(() => {
    if (!user) return;
    let mounted = true;

    setSessions([]);
    setTasks({});
    setBots([]);
    setConnections([]);
    setActiveSessionId(null);
    setActiveBotId(null);
    setAudit([]);
    setShowAudit(false);

    Promise.all([client.listBots(), client.listSessions(), client.listConnections()])
      .then(([botList, sessionList, connectionList]) => {
        if (!mounted) return;
        setBots(botList);
        setSessions(sessionList);
        setConnections(connectionList);
        const first = botList[0];
        if (first) {
          setActiveBotId(first.id);
          setActiveSessionId(first.sessionId);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof AuthError) void logout();
        else if (mounted) setError(messageOf(err));
      });

    const refreshConfig = () => {
      try {
        client
          .config()
          .then((info) => mounted && setConfig(info))
          .catch(() => {});
      } catch {
        // stale client under dev hot-reload
      }
    };
    refreshConfig();
    const configTimer = window.setInterval(refreshConfig, 5000);
    // Start the local "my computer" helper once (desktop app only).
    if (!nodeStartedRef.current) {
      nodeStartedRef.current = true;
      void startLocalNode();
    }

    const disconnect = client.connect({
      onOpen: () => mounted && setConnection("online"),
      onClose: () => {
        if (!mounted) return;
        setConnection("offline");
        client.me().catch((err: unknown) => {
          if (err instanceof AuthError) void logout();
        });
      },
      onEvent: (event) => mounted && applyEvent(event),
    });

    client
      .listSecrets()
      .then((list) => mounted && setSecrets(list))
      .catch(() => {});

    return () => {
      mounted = false;
      window.clearInterval(configTimer);
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, client]);

  // Keep the transcript scrolled to the newest message.
  const activeMessageCount = sessions.find((session) => session.id === activeSessionId)?.messages.length ?? 0;
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [activeSessionId, activeMessageCount]);

  useEffect(() => {
    localStorage.setItem("botifyr.useComputer", useComputer ? "1" : "0");
  }, [useComputer]);

  function applyEvent(event: ServerEvent) {
    switch (event.type) {
      case "session.created":
        setSessions((prev) =>
          prev.some((s) => s.id === event.session.id) ? prev : [event.session, ...prev],
        );
        setActiveSessionId((prev) => prev ?? event.session.id);
        break;
      case "session.updated":
        setSessions((prev) => {
          const exists = prev.some((s) => s.id === event.session.id);
          return exists
            ? prev.map((s) => (s.id === event.session.id ? event.session : s))
            : [event.session, ...prev];
        });
        {
          const messages = event.session.messages;
          const last = messages[messages.length - 1];
          if (last?.role === "assistant") {
            setStream((prev) => (prev && prev.taskId === last.taskId ? null : prev));
          }
        }
        break;
      case "assistant.delta":
        setStream((prev) =>
          prev && prev.taskId === event.taskId
            ? { ...prev, text: prev.text + event.text }
            : { sessionId: event.sessionId, taskId: event.taskId, botId: event.botId, text: event.text },
        );
        break;
      case "task.created":
      case "task.updated":
      case "task.completed":
      case "task.failed":
        setTasks((prev) => ({ ...prev, [event.task.id]: event.task }));
        break;
      case "approval.requested":
      case "approval.resolved":
        break;
    }
  }

  async function openExternal(url: string) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  }

  // Browser-based sign-in (Grok-Bot style): open the web page, then pick up the
  // session the cloud issues once Google returns.
  // Poll the cloud until the browser sign-in produces a token. Persists the
  // pending state so a reload mid-flow resumes instead of losing the session.
  async function pollForToken(state: string): Promise<boolean> {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      if (cancelSigninRef.current) return false;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const issued = await client.googleResult(state);
      if (issued) {
        localStorage.setItem(TOKEN_KEY, issued);
        localStorage.removeItem(PENDING_KEY);
        client.setToken(issued);
        const account = await client.me();
        setUser(account);
        void focusWindow();
        return true;
      }
    }
    return false;
  }

  async function oauthSignIn() {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    cancelSigninRef.current = false;
    try {
      const cfg = await client.authConfig();
      if (!cfg.google) {
        setAuthError(
          "Google sign-in isn't configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the cloud.",
        );
        return;
      }

      const state = crypto.randomUUID();
      localStorage.setItem(PENDING_KEY, state);
      const url = `${CLOUD_URL}/auth/google?state=${encodeURIComponent(state)}`;
      setSigninUrl(url);
      await openExternal(url);

      const ok = await pollForToken(state);
      if (!ok) setAuthError("Sign-in timed out. Please try again.");
    } catch (err: unknown) {
      setAuthError(messageOf(err));
    } finally {
      setAuthBusy(false);
      setSigninUrl(null);
    }
  }

  function cancelSignin() {
    cancelSigninRef.current = true;
    localStorage.removeItem(PENDING_KEY);
    setAuthBusy(false);
    setSigninUrl(null);
    setAuthError(null);
  }

  async function logout() {
    try {
      await client.logout();
    } catch {
      // ignore
    }
    localStorage.removeItem(TOKEN_KEY);
    client.setToken(null);
    setUser(null);
    setConnections([]);
    setConnection("connecting");
  }

  function selectBot(bot: Bot) {
    setActiveBotId(bot.id);
    setActiveSessionId(bot.sessionId);
    setShowAudit(false);
    setShowNewChat(false);
  }

  function openCreateBot(mode: "bot" | "group") {
    setCreateBotMode(mode);
    setEditingBotId(null);
    setBotName("");
    setBotEmoji(mode === "group" ? "👥" : "🤖");
    setBotScheme(bots.length % BOT_SCHEMES.length);
    setBotIntro("");
    setGroupMembers([]);
    setSchedulePrompt("");
    setScheduleEvery(60);
    setScheduleEnabled(false);
    setShowNewChat(false);
  }

  function openEditBot(bot: Bot) {
    setCreateBotMode("edit");
    setEditingBotId(bot.id);
    setBotName(bot.name);
    setBotEmoji(bot.emoji);
    setBotScheme(bot.scheme % BOT_SCHEMES.length);
    setBotIntro(bot.instructions);
    setGroupMembers(bot.memberIds ?? []);
    setSchedulePrompt(bot.schedule?.prompt ?? "");
    setScheduleEvery(bot.schedule?.everyMinutes ?? 60);
    setScheduleEnabled(bot.schedule?.enabled ?? false);
  }

  function closeBotModal() {
    setCreateBotMode(null);
    setEditingBotId(null);
  }

  async function createBot() {
    const name = botName.trim() || (createBotMode === "group" ? "New group" : "New Bot");

    if (createBotMode === "edit" && editingBotId) {
      try {
        const updated = await client.updateBot(editingBotId, {
          name,
          emoji: botEmoji.trim() || "🤖",
          scheme: botScheme,
          instructions: botIntro.trim(),
          memberIds: groupMembers,
          schedule: schedulePrompt.trim()
            ? { prompt: schedulePrompt.trim(), everyMinutes: scheduleEvery, enabled: scheduleEnabled }
            : undefined,
        });
        setBots((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
        setSessions((prev) =>
          prev.map((session) =>
            session.id === updated.sessionId ? { ...session, title: updated.name } : session,
          ),
        );
        closeBotModal();
      } catch (err: unknown) {
        setError(messageOf(err));
      }
      return;
    }

    let instructions = botIntro.trim();
    let memberIds: string[] | undefined;
    if (createBotMode === "group") {
      const members = bots.filter((bot) => groupMembers.includes(bot.id));
      if (members.length === 0) {
        setError("Pick at least one bot for the group.");
        return;
      }
      memberIds = members.map((bot) => bot.id);
      const roster = members.map((bot) => bot.name).join(", ");
      instructions =
        `This is a group chat. Members reply in turn: ${roster}.` +
        (instructions ? ` Group goal: ${instructions}` : "");
    }
    try {
      const bot = await client.createBot({
        name,
        emoji: botEmoji.trim() || "🤖",
        scheme: botScheme,
        instructions,
        memberIds,
      });
      setBots((prev) => [...prev, bot]);
      const session: Session = {
        id: bot.sessionId,
        userId: bot.userId,
        title: bot.name,
        messages: [],
        createdAt: bot.createdAt,
        botId: bot.id,
      };
      setSessions((prev) => [session, ...prev]);
      setActiveBotId(bot.id);
      setActiveSessionId(bot.sessionId);
      closeBotModal();
      setShowAudit(false);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function removeBot(bot: Bot) {
    try {
      await client.deleteBot(bot.id);
      const remaining = bots.filter((entry) => entry.id !== bot.id);
      setBots(remaining);
      setSessions((prev) => prev.filter((session) => session.id !== bot.sessionId));
      if (activeBotId === bot.id) {
        const next = remaining[0] ?? null;
        setActiveBotId(next?.id ?? null);
        setActiveSessionId(next?.sessionId ?? null);
      }
      closeBotModal();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || !activeSessionId || sending) return;
    setSending(true);
    setError(null);
    try {
      const { session, warning } = await client.sendMessage(activeSessionId, trimmed, useComputer);
      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
      setText("");
      setLimitWarning(warning ?? null);
    } catch (err: unknown) {
      setError(messageOf(err));
    } finally {
      setSending(false);
    }
  }

  async function retry() {
    if (!activeSessionId || busy) return;
    setError(null);
    try {
      const { session, warning } = await client.retry(activeSessionId, useComputer);
      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
      setLimitWarning(warning ?? null);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function decide(decision: "allow" | "deny") {
    const task = liveTask;
    if (!task?.approval) return;
    try {
      await client.resolveApproval(task.id, task.approval.id, decision);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function addSecret(event: FormEvent) {
    event.preventDefault();
    if (!secretName.trim() || !secretValue) return;
    try {
      await client.createSecret(secretName.trim(), secretValue);
      setSecrets(await client.listSecrets());
      setSecretName("");
      setSecretValue("");
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function removeSecret(id: string) {
    try {
      await client.deleteSecret(id);
      setSecrets(await client.listSecrets());
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function connectApp(provider: string) {
    if (connectingApp) return;
    setConnectingApp(provider);
    try {
      const { url } = await client.startConnection(provider);
      await openExternal(url);
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const list = await client.listConnections();
        if (list.some((entry) => entry.provider === provider)) {
          setConnections(list);
          break;
        }
      }
    } catch (err: unknown) {
      setError(messageOf(err));
    } finally {
      setConnectingApp(null);
    }
  }

  async function disconnectApp(provider: string) {
    try {
      await client.disconnect(provider);
      setConnections(await client.listConnections());
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function startLocalNode() {
    try {
      const { token } = await client.nodeToken();
      await invoke("start_local_node", { token });
    } catch {
      // Not running inside the desktop app (e.g. browser preview).
    }
  }

  async function stopLocalNode() {
    try {
      await invoke("stop_local_node");
    } catch {
      // ignore
    }
  }

  async function toggleAudit() {
    const task = latestTask;
    if (!task) return;
    if (showAudit) {
      setShowAudit(false);
      return;
    }
    try {
      setAudit(await client.listAudit(task.id));
      setShowAudit(true);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const sessionTasks = Object.values(tasks).filter((t) => t.sessionId === activeSessionId);
  const liveTask =
    sessionTasks
      .filter((t) => t.status === "running" || t.status === "awaiting_approval" || t.status === "queued")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const latestTask = sessionTasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const busy = Boolean(liveTask);
  const activeBot = bots.find((bot) => bot.id === activeBotId) ?? null;
  const activeScheme = BOT_SCHEMES[(activeBot?.scheme ?? 0) % BOT_SCHEMES.length];
  const activeBotName = activeBot?.name ?? "Botifyr";
  const inGroup = Boolean(activeBot?.memberIds && activeBot.memberIds.length > 0);
  const streamBot = stream?.botId ? (bots.find((bot) => bot.id === stream.botId) ?? null) : null;
  const streamScheme = BOT_SCHEMES[(streamBot?.scheme ?? activeBot?.scheme ?? 0) % BOT_SCHEMES.length];
  const streamActive = Boolean(stream && stream.sessionId === activeSessionId);
  // Sidebar lists bots; each bot owns exactly one conversation thread.
  const filteredBots = query.trim()
    ? bots.filter((bot) => bot.name.toLowerCase().includes(query.trim().toLowerCase()))
    : bots;
  const thinking =
    (sending || busy) &&
    (activeSession ? activeSession.messages[activeSession.messages.length - 1]?.role === "user" : false);
  const budgetNotice =
    config?.limits &&
    config.limits.dailyTokenBudget > 0 &&
    (config.usage?.tokensToday ?? 0) >= config.limits.dailyTokenBudget
      ? `Daily token budget reached (${(config.usage?.tokensToday ?? 0).toLocaleString()} / ${config.limits.dailyTokenBudget.toLocaleString()}). Messages still work — raise BOTIFYR_DAILY_TOKEN_BUDGET to increase it.`
      : null;
  const lastAssistantId = activeSession
    ? [...activeSession.messages].reverse().find((message) => message.role === "assistant")?.id
    : undefined;

  if (!authChecked) return <div className="center">Loading…</div>;

  if (!user) {
    return (
      <div className="startup">
        <div className="startup-main">
          <div className="startup-brand">
            <BotLogo size={64} className="startup-logo" />
            <span className="startup-name">Botifyr</span>
          </div>
          <p className="startup-tag">Your team of always-on agents that you can give real work to</p>

          {authBusy ? (
            <div className="signin-progress">
              <span className="spinner" />
              Continue in your browser
            </div>
          ) : (
            <button className="startup-signin" type="button" onClick={() => void oauthSignIn()}>
              Sign in <span className="startup-arrow">→</span>
            </button>
          )}
          {authBusy && (
            <div className="signin-links">
              <button
                className="inline-link"
                type="button"
                onClick={() => signinUrl && void openExternal(signinUrl)}
              >
                Reopen link
              </button>
              <span className="sep">·</span>
              <button className="inline-link" type="button" onClick={cancelSignin}>
                Cancel
              </button>
            </div>
          )}
          {authError && (
            <div className="error" style={{ maxWidth: 420 }}>
              {authError}
            </div>
          )}
        </div>

        <p className="startup-terms">
          By using Botifyr, you additionally agree to these{" "}
          <a className="terms-link" href="https://botifyr.xyz/terms" target="_blank" rel="noreferrer">
            Terms
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="round" type="button" title="Search" onClick={() => setSearchOpen((v) => !v)}>
            ⌕
          </button>
          <button className="round" type="button" title="New chat" onClick={() => setShowNewChat(true)}>
            ＋
          </button>
        </div>

        {searchOpen && (
          <input
            className="search"
            placeholder="Search chats"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        )}

        <div className="sidebar-brand">
          <span className="sidebar-avatar">
            <BotLogo size={56} />
            <span className={`conn conn-${connection} brand-dot`} />
          </span>
          <span className="sidebar-brand-name">Botifyr</span>
        </div>

        <div className="task-list">
          {filteredBots.length === 0 && <p className="empty">No bots yet. Tap ＋ to create one.</p>}
          {filteredBots.map((bot) => {
            const session = sessions.find((entry) => entry.id === bot.sessionId);
            const last = session?.messages[session.messages.length - 1];
            return (
              <button
                key={bot.id}
                type="button"
                className={`conv-item ${bot.id === activeBotId ? "active" : ""}`}
                onClick={() => selectBot(bot)}
              >
                <span className="conv-avatar">
                  <BotLogo size={30} scheme={BOT_SCHEMES[bot.scheme % BOT_SCHEMES.length]} />
                </span>
                <span className="conv-text">
                  <span className="conv-name">{bot.name}</span>
                  <span className="conv-preview">{last?.content?.slice(0, 42) || "No messages yet"}</span>
                </span>
              </button>
            );
          })}
        </div>

        {showSettings && (
          <div className="settings">
            <div className="settings-title">Run on this computer</div>
            <div className="settings-body">
              <button
                className={`ghost small ${useComputer ? "on" : ""}`}
                type="button"
                disabled={!config?.nodeOnline}
                onClick={() => setUseComputer((v) => !v)}
              >
                {useComputer ? "● On — tasks run here" : "○ Off — tasks run in the cloud"}
              </button>
              <p className="muted">
                When on, your messages use your own browser and shell (with approvals). Requires the computer
                to be connected below.
              </p>
            </div>

            <div className="settings-title">My computer</div>
            <div className="settings-body">
              <button
                className="ghost small"
                type="button"
                onClick={() => (config?.nodeOnline ? void stopLocalNode() : void startLocalNode())}
              >
                {config?.nodeOnline ? "Connected — disconnect" : "Connect this computer"}
              </button>
              <p className="muted">
                Lets Botifyr use your browser and shell when you switch on <b>● My PC</b> in the composer.
              </p>
            </div>

            <div className="settings-title">Vault ({secrets.length})</div>
            <div className="settings-body">
              <form className="vault-form" onSubmit={addSecret}>
                <input
                  placeholder="NAME"
                  value={secretName}
                  onChange={(e) => setSecretName(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="secret value"
                  value={secretValue}
                  onChange={(e) => setSecretValue(e.target.value)}
                />
                <button className="ghost small" type="submit">
                  Save secret
                </button>
              </form>
              <ul className="vault-list">
                {secrets.length === 0 && <li className="muted">No secrets stored.</li>}
                {secrets.map((secret) => (
                  <li key={secret.id}>
                    <span className="mono">{secret.name}</span>
                    <button className="link" type="button" onClick={() => removeSecret(secret.id)}>
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="settings-title">Usage today</div>
            <div className="settings-body">
              <p className="muted">
                {config?.usage
                  ? `${config.usage.tokensToday.toLocaleString()} tokens · ${config.usage.requestsToday} requests`
                  : "—"}
                {config?.limits ? ` · budget ${config.limits.dailyTokenBudget.toLocaleString()}` : ""}
              </p>
            </div>

            <div className="settings-title">Account</div>
            <div className="settings-body">
              <button className="ghost small" type="button" onClick={logout}>
                Sign out
              </button>
              <p className="muted mono">{CLOUD_URL}</p>
            </div>
          </div>
        )}

        <footer className="sidebar-footer">
          <button
            className="user-avatar"
            type="button"
            title={`${user.email} · ${connection === "online" ? "Connected" : connection === "connecting" ? "Connecting…" : "Offline"}`}
            onClick={() => setShowSettings((v) => !v)}
          >
            {initials(user.email)}
          </button>
          <button className="connect-apps" type="button" onClick={() => setShowConnectApps(true)}>
            <span>Connect apps</span>
            <span className="connect-apps-icons">
              <GmailIcon />
              <CalendarIcon />
              <DriveIcon />
            </span>
          </button>
        </footer>
      </aside>

      <main className="main">
        {showNewChat && (
          <div className="newchat-overlay" onClick={() => setShowNewChat(false)}>
            <span className="newchat-title">To: Start a chat with…</span>
            <div className="newchat-panel" onClick={(event) => event.stopPropagation()}>
              <button className="newchat-item" type="button" onClick={() => openCreateBot("bot")}>
                <span className="newchat-ico">＋</span>
                Create new Bot
              </button>

              <button className="newchat-item" type="button" onClick={() => openCreateBot("group")}>
                <span className="newchat-ico">👥</span>
                Create group chat
              </button>

              {bots.length > 0 && <div className="newchat-sep" />}

              {bots.map((bot) => (
                <button
                  key={bot.id}
                  className={`newchat-item ${bot.id === activeBotId ? "active" : ""}`}
                  type="button"
                  onClick={() => selectBot(bot)}
                >
                  <span className="conv-avatar">
                    <BotLogo size={26} scheme={BOT_SCHEMES[bot.scheme % BOT_SCHEMES.length]} />
                  </span>
                  <span className="newchat-name">{bot.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!showNewChat && (
          <header className="topbar">
            <span className="thread-pill">
              <BotLogo size={18} scheme={activeScheme} />
              {liveTask && <span className={`status-dot status-${liveTask.status}`} />}
              {activeBotName}
            </span>
            <div className="topbar-right">
              {activeBot && (
                <button
                  className="bot-menu-btn"
                  type="button"
                  title="Bot settings"
                  onClick={() => openEditBot(activeBot)}
                >
                  ⋯
                </button>
              )}
              {config && (
                <span className="chip">
                  {config.provider} · {config.capabilities.join(", ") || "no tools"}
                  {config.nodeOnline ? " · local: on" : ""}
                </span>
              )}
              {latestTask && (
                <button className="ghost small" type="button" onClick={toggleAudit}>
                  {showAudit ? "Hide audit" : "Audit"}
                </button>
              )}
            </div>
          </header>
        )}

        {config?.demo && (
          <div className="notice">
            <strong>Demo model.</strong> Replies are scripted; your message isn't sent to any model. Set
            BOTIFYR_PROVIDER + an API key for real reasoning.
          </div>
        )}

        {(limitWarning ?? budgetNotice) && <div className="notice warn">{limitWarning ?? budgetNotice}</div>}

        <section className="content" ref={scrollRef}>
          {error && <div className="error">{error}</div>}

          {!activeSession && (
            <div className="hero">
              <h1>Start a conversation</h1>
              <p>
                Ask Botifyr to do something. It plans, works inside an isolated sandbox, and asks before risky
                steps.
              </p>
            </div>
          )}

          {activeSession && (
            <div className="thread">
              {activeSession.messages.length === 0 && (
                <div className="hero">
                  <h1>What should Botifyr do?</h1>
                  <p>Try “summarize the top story on news.ycombinator.com” or “hello”.</p>
                </div>
              )}

              {activeSession.messages.map((message) => {
                if (message.role === "user") {
                  return (
                    <div key={message.id} className="msg-user">
                      {message.content}
                    </div>
                  );
                }
                const msgBot =
                  (message.botId && bots.find((entry) => entry.id === message.botId)) || activeBot;
                const msgScheme = BOT_SCHEMES[(msgBot?.scheme ?? 0) % BOT_SCHEMES.length];
                return (
                  <div key={message.id} className="msg-assistant">
                    <BotLogo size={26} scheme={msgScheme} className="msg-bot-logo" />
                    <div className="msg-body">
                      {inGroup && msgBot && <div className="msg-author">{msgBot.name}</div>}
                      <Markdown text={message.content} />
                      <div className="msg-actions">
                        <button
                          className="msg-action"
                          type="button"
                          title="Copy"
                          onClick={() => void navigator.clipboard?.writeText(message.content)}
                        >
                          Copy
                        </button>
                        {message.id === lastAssistantId && (
                          <button
                            className="msg-action"
                            type="button"
                            title="Regenerate reply"
                            disabled={busy}
                            onClick={() => void retry()}
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {streamActive && (
                <div className="msg-assistant">
                  <BotLogo size={26} scheme={streamScheme} className="msg-bot-logo" />
                  <div className="msg-body">
                    {inGroup && streamBot && <div className="msg-author">{streamBot.name}</div>}
                    {stream && stream.text ? (
                      <span className="reveal">{stream.text}</span>
                    ) : (
                      <span className="think-dots">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </div>
                </div>
              )}

              {thinking && !streamActive && (
                <div className="thinking-row">
                  <BotLogo size={24} scheme={activeScheme} />
                  <span>{activeBotName} is thinking</span>
                  <span className="think-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              )}

              {liveTask && (
                <div className="activity">
                  {liveTask.liveStream &&
                  (liveTask.status === "running" || liveTask.status === "awaiting_approval") ? (
                    <img
                      className="activity-screen"
                      src={`${CLOUD_URL}/v1/tasks/${liveTask.id}/stream?token=${encodeURIComponent(token())}`}
                      alt="Live sandbox"
                    />
                  ) : liveTask.screenshotAt ? (
                    <img
                      className="activity-screen"
                      src={`${CLOUD_URL}/v1/tasks/${liveTask.id}/screenshot?v=${encodeURIComponent(liveTask.screenshotAt)}&token=${encodeURIComponent(token())}`}
                      alt="Sandbox screen"
                    />
                  ) : null}

                  <ol className="steps">
                    {liveTask.steps.map((step) => (
                      <li key={step.id} className={`step step-${step.status}`}>
                        <span className="step-icon">{iconFor(step.status)}</span>
                        <div>
                          <div className="step-title">{step.title}</div>
                          {step.detail && <div className="step-detail">{step.detail}</div>}
                        </div>
                      </li>
                    ))}
                  </ol>

                  {liveTask.approval && liveTask.approval.status === "pending" && (
                    <div className={`approval risk-${liveTask.approval.risk}`}>
                      <span className="approval-tag">Approval needed · {liveTask.approval.risk} risk</span>
                      <h3>{liveTask.approval.title}</h3>
                      <p>{liveTask.approval.description}</p>
                      <div className="approval-actions">
                        <button className="btn deny" type="button" onClick={() => decide("deny")}>
                          Deny
                        </button>
                        <button className="btn allow" type="button" onClick={() => decide("allow")}>
                          Allow once
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {showAudit && (
                <div className="audit">
                  <div className="audit-head">Audit log · {audit.length} events</div>
                  <ul>
                    {audit.length === 0 && <li className="muted">No events recorded yet.</li>}
                    {audit.map((entry) => (
                      <li key={entry.id}>
                        <span className={`audit-type audit-${entry.type}`}>{entry.type}</span>
                        <span className="mono">{entry.toolName ?? "—"}</span>
                        <span className="audit-detail">{entry.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        <form
          className="composer"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="composer-bar">
            <button className="round" type="button" title="New chat" onClick={() => setShowNewChat(true)}>
              ＋
            </button>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={`Message ${activeBotName}`}
              rows={1}
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="send round"
              type="submit"
              disabled={!text.trim() || !activeSessionId || sending || busy}
            >
              {busy ? "…" : "➤"}
            </button>
          </div>
        </form>
      </main>

      {showConnectApps && (
        <div className="apps-overlay" onClick={() => setShowConnectApps(false)}>
          <div className="apps-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">Connect apps</span>
              <button className="round small" type="button" onClick={() => setShowConnectApps(false)}>
                ✕
              </button>
            </div>
            <p className="apps-sub">
              Let Botifyr work with the apps you already use. Each connection is authorized with Google, and
              you can revoke it any time.
            </p>
            <ul className="apps-list">
              {CONNECT_APPS.map((app) => {
                const connected = connections.some((entry) => entry.provider === app.id);
                return (
                  <li key={app.id} className="apps-item">
                    <span className="apps-ico">{app.icon}</span>
                    <span className="apps-meta">
                      <span className="apps-name">{app.name}</span>
                      <span className="apps-desc">{app.desc}</span>
                    </span>
                    {connected ? (
                      <button
                        className="ghost small"
                        type="button"
                        onClick={() => void disconnectApp(app.id)}
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        className="ghost small"
                        type="button"
                        disabled={connectingApp === app.id}
                        onClick={() => void connectApp(app.id)}
                      >
                        {connectingApp === app.id ? "Connecting…" : "Connect"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {createBotMode && (
        <div className="apps-overlay" onClick={closeBotModal}>
          <div className="apps-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">
                {createBotMode === "group"
                  ? "Create group chat"
                  : createBotMode === "edit"
                    ? "Edit bot"
                    : "Create new Bot"}
              </span>
              <button className="round small" type="button" onClick={closeBotModal}>
                ✕
              </button>
            </div>

            <div className="bot-preview">
              <BotLogo size={64} scheme={BOT_SCHEMES[botScheme % BOT_SCHEMES.length]} />
              <input
                className="bot-name-input"
                placeholder={createBotMode === "group" ? "Group name" : "Bot name"}
                value={botName}
                onChange={(event) => setBotName(event.target.value)}
                autoFocus
              />
              <input
                className="bot-emoji-input"
                value={botEmoji}
                onChange={(event) => setBotEmoji(event.target.value)}
                maxLength={4}
                aria-label="Emoji"
              />
            </div>

            <div className="scheme-row">
              {BOT_SCHEMES.map((scheme, index) => (
                <button
                  key={index}
                  type="button"
                  className={`scheme-dot ${index === botScheme ? "active" : ""}`}
                  style={{ background: scheme.accent }}
                  onClick={() => setBotScheme(index)}
                  title={`Colour ${index + 1}`}
                />
              ))}
            </div>

            {(createBotMode === "group" || createBotMode === "edit") && (
              <ul className="member-list">
                {bots.map((bot) => (
                  <li key={bot.id}>
                    <label className="member-item">
                      <input
                        type="checkbox"
                        checked={groupMembers.includes(bot.id)}
                        onChange={(event) =>
                          setGroupMembers((prev) =>
                            event.target.checked ? [...prev, bot.id] : prev.filter((id) => id !== bot.id),
                          )
                        }
                      />
                      <BotLogo size={22} scheme={BOT_SCHEMES[bot.scheme % BOT_SCHEMES.length]} />
                      <span>{bot.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            <textarea
              className="bot-instructions"
              placeholder={
                createBotMode === "group"
                  ? "What should this group work on? (optional)"
                  : "Instructions — how should this bot behave? (optional)"
              }
              value={botIntro}
              onChange={(event) => setBotIntro(event.target.value)}
              rows={3}
            />

            {createBotMode === "edit" && (
              <div className="schedule-box">
                <label className="schedule-toggle">
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(event) => setScheduleEnabled(event.target.checked)}
                  />
                  <span>Always-on schedule</span>
                </label>
                <textarea
                  className="bot-instructions"
                  placeholder="What should this bot do on each run? (empty disables the schedule)"
                  value={schedulePrompt}
                  onChange={(event) => setSchedulePrompt(event.target.value)}
                  rows={2}
                />
                <label className="schedule-every">
                  every
                  <input
                    type="number"
                    min={1}
                    value={scheduleEvery}
                    onChange={(event) => setScheduleEvery(Math.max(1, Number(event.target.value) || 1))}
                  />
                  minutes
                </label>
              </div>
            )}

            <div className="apps-actions">
              {createBotMode === "edit" && editingBotId && (
                <button
                  className="ghost small danger"
                  type="button"
                  onClick={() => {
                    const bot = bots.find((entry) => entry.id === editingBotId);
                    if (bot) void removeBot(bot);
                  }}
                >
                  Delete bot
                </button>
              )}
              <button className="ghost small" type="button" onClick={closeBotModal}>
                Cancel
              </button>
              <button className="btn primary" type="button" onClick={() => void createBot()}>
                {createBotMode === "edit"
                  ? "Save changes"
                  : createBotMode === "group"
                    ? "Create group"
                    : "Create bot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CONNECT_APPS = [
  { id: "gmail", name: "Gmail", desc: "Read, search, and draft email", icon: <GmailIcon size={22} /> },
  {
    id: "calendar",
    name: "Google Calendar",
    desc: "See your schedule and create events",
    icon: <CalendarIcon size={22} />,
  },
  {
    id: "drive",
    name: "Google Drive",
    desc: "Find, read, and organize your files",
    icon: <DriveIcon size={22} />,
  },
];

function initials(email: string): string {
  const name = email.split("@")[0] ?? "?";
  return name.slice(0, 2).toUpperCase();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function iconFor(status: Task["steps"][number]["status"]): string {
  switch (status) {
    case "pending":
      return "○";
    case "running":
      return "◐";
    case "done":
      return "●";
    case "failed":
      return "✕";
    case "skipped":
      return "–";
  }
}
