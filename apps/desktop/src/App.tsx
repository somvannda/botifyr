import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  AuditEvent,
  Bot,
  BotFile,
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
import { GithubBrand, NotionBrand, SlackBrand, TelegramBrand } from "./BrandIcons";
import { BOT_SCHEMES, BotLogo } from "./BotLogo";
import {
  ChartIcon,
  CloseIcon,
  DownloadIcon,
  GearIcon,
  HelpIcon,
  LockIcon,
  LogoutIcon,
  MobileIcon,
  MonitorIcon,
  MoreIcon,
  PanelIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  UserPlusIcon,
  UsersIcon,
} from "./Icons";
import { Markdown } from "./Markdown";
import "./styles.css";

const CLOUD_URL = (import.meta.env.VITE_CLOUD_URL as string | undefined) ?? "http://localhost:8787";
const TOKEN_KEY = "botifyr.token";

type ConnectionState = "connecting" | "online" | "offline";

const SETTINGS_TABS = [
  { id: "general", label: "General", icon: <GearIcon size={16} /> },
  { id: "computer", label: "Computer", icon: <MonitorIcon size={16} /> },
  { id: "usage", label: "Usage & Billing", icon: <ChartIcon size={16} /> },
  { id: "updates", label: "Updates", icon: <DownloadIcon size={16} /> },
  { id: "vault", label: "Vault", icon: <LockIcon size={16} /> },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

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
  const [marketQuery, setMarketQuery] = useState("");
  const [marketFilter, setMarketFilter] = useState<"all" | "installed">("all");
  const [marketViewAll, setMarketViewAll] = useState(false);
  const [tokenInputFor, setTokenInputFor] = useState<string | null>(null);
  const [tokenValue, setTokenValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
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
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [computerName, setComputerName] = useState(
    () => localStorage.getItem("botifyr.computerName") ?? "My computer",
  );
  const [executionMode, setExecutionMode] = useState<"ask" | "always_allow">(() =>
    localStorage.getItem("botifyr.execution") === "always_allow" ? "always_allow" : "ask",
  );
  const [theme, setTheme] = useState(() => localStorage.getItem("botifyr.theme") ?? "dark");
  const [language, setLanguage] = useState(() => localStorage.getItem("botifyr.language") ?? "system");
  const [spelling, setSpelling] = useState(() => localStorage.getItem("botifyr.spelling") !== "0");
  const [hardware, setHardware] = useState(() => localStorage.getItem("botifyr.hardware") !== "0");
  const [updateTrack, setUpdateTrack] = useState(
    () => localStorage.getItem("botifyr.updateTrack") ?? "stable",
  );
  const [autoUpdate, setAutoUpdate] = useState(() => localStorage.getItem("botifyr.autoUpdate") !== "0");
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [trialStart] = useState(() => {
    const existing = Number(localStorage.getItem("botifyr.trialStart"));
    if (existing) return existing;
    const now = Date.now();
    localStorage.setItem("botifyr.trialStart", String(now));
    return now;
  });
  const [showBotPanel, setShowBotPanel] = useState(() => localStorage.getItem("botifyr.botPanel") !== "0");
  const [botPanelTab, setBotPanelTab] = useState<"details" | "library" | "computer">("details");
  const [labels, setLabels] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("botifyr.labels") ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [botFiles, setBotFiles] = useState<BotFile[]>([]);
  const [libName, setLibName] = useState("");
  const [libOpen, setLibOpen] = useState<{ id: string; name: string } | null>(null);
  const [libContent, setLibContent] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");

  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeSessionId;
  const nodeStartedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cancelSigninRef = useRef(false);
  const executionModeRef = useRef(executionMode);
  executionModeRef.current = executionMode;

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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("botifyr.botPanel", showBotPanel ? "1" : "0");
  }, [showBotPanel]);

  useEffect(() => {
    if (!activeBotId || botPanelTab !== "library") return;
    client
      .listFiles(activeBotId)
      .then((files) => setBotFiles(files))
      .catch(() => {});
  }, [activeBotId, botPanelTab, client]);

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
      case "task.failed": {
        setTasks((prev) => ({ ...prev, [event.task.id]: event.task }));
        const pending = event.task.approval;
        if (executionModeRef.current === "always_allow" && pending && pending.status === "pending") {
          void client.resolveApproval(event.task.id, pending.id, "allow").catch(() => {});
        }
        break;
      }
      case "approval.requested":
        if (executionModeRef.current === "always_allow") {
          void client.resolveApproval(event.taskId, event.approval.id, "allow").catch(() => {});
        }
        break;
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

  async function addAccount() {
    await logout();
    void oauthSignIn();
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
      setMentionQuery(null);
      setLimitWarning(warning ?? null);
    } catch (err: unknown) {
      setError(messageOf(err));
    } finally {
      setSending(false);
    }
  }

  function saveLabel() {
    if (!activeBotId) return;
    const next = { ...labels, [activeBotId]: labelDraft.trim() };
    setLabels(next);
    localStorage.setItem("botifyr.labels", JSON.stringify(next));
    setEditingLabel(false);
  }

  function onComposerChange(value: string) {
    setText(value);
    if (!activeBot?.memberIds?.length) {
      setMentionQuery(null);
      return;
    }
    const match = /(?:^|\s)@([\w -]*)$/.exec(value);
    setMentionQuery(match ? match[1] : null);
  }

  function insertMention(name: string) {
    setText((prev) => prev.replace(/@[\w -]*$/, () => `@${name} `));
    setMentionQuery(null);
  }

  async function refreshFiles() {
    if (!activeBotId) return;
    setBotFiles(await client.listFiles(activeBotId));
  }

  async function createLibFile() {
    if (!activeBotId || !libName.trim()) return;
    try {
      const file = await client.saveFile(activeBotId, libName.trim(), "");
      setLibName("");
      setLibOpen({ id: file.id, name: file.name });
      setLibContent("");
      await refreshFiles();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function openLibFile(file: BotFile) {
    try {
      const full = await client.getFile(file.id);
      setLibOpen({ id: full.id, name: full.name });
      setLibContent(full.content);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function saveLibFile() {
    if (!activeBotId || !libOpen) return;
    try {
      await client.saveFile(activeBotId, libOpen.name, libContent);
      await refreshFiles();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function deleteLibFile(id: string) {
    try {
      await client.deleteFile(id);
      if (libOpen?.id === id) setLibOpen(null);
      await refreshFiles();
    } catch (err: unknown) {
      setError(messageOf(err));
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

  async function saveToken(provider: string) {
    if (!tokenValue.trim()) return;
    try {
      await client.connectToken(provider, tokenValue.trim());
      setConnections(await client.listConnections());
      setTokenInputFor(null);
      setTokenValue("");
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
  const botLabel = activeBotId ? (labels[activeBotId] ?? "") : "";
  const groupMemberBots: Bot[] = activeBot?.memberIds
    ? activeBot.memberIds
        .map((id) => bots.find((bot) => bot.id === id))
        .filter((bot): bot is Bot => Boolean(bot))
    : [];
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
  const trialPercent =
    config?.limits && config.limits.dailyTokenBudget > 0
      ? Math.min(100, Math.round(((config.usage?.tokensToday ?? 0) / config.limits.dailyTokenBudget) * 100))
      : 0;
  const trialDaysLeft = Math.max(0, 7 - Math.floor((Date.now() - trialStart) / 86_400_000));

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
    <div className={`app${showBotPanel && activeBot ? " with-panel" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="round" type="button" title="Search" onClick={() => setSearchOpen((v) => !v)}>
            <SearchIcon size={16} />
          </button>
          <button className="round" type="button" title="New chat" onClick={() => setShowNewChat(true)}>
            <PlusIcon size={18} />
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

        <footer className="sidebar-footer">
          <button
            className="user-avatar"
            type="button"
            title={`${user.email} · ${connection === "online" ? "Connected" : connection === "connecting" ? "Connecting…" : "Offline"}`}
            onClick={() => setShowAccountMenu((value) => !value)}
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

        {showAccountMenu && (
          <div className="account-menu">
            <button
              className="account-item"
              type="button"
              onClick={() => {
                setSettingsTab("usage");
                setShowSettings(true);
                setShowAccountMenu(false);
              }}
            >
              <span className="account-ico">
                <ChartIcon size={16} />
              </span>
              <span className="account-label">Trial usage</span>
              <span className="account-value">{trialPercent}%</span>
              <span className="account-chev">›</span>
            </button>
            <button className="account-item" type="button" disabled>
              <span className="account-ico">
                <MobileIcon size={16} />
              </span>
              <span className="account-label">Get Botifyr for mobile</span>
            </button>
            <button
              className="account-item"
              type="button"
              onClick={() => {
                void openExternal("https://botifyr.xyz/help");
                setShowAccountMenu(false);
              }}
            >
              <span className="account-ico">
                <HelpIcon size={16} />
              </span>
              <span className="account-label">Support</span>
              <span className="account-chev">›</span>
            </button>
            <button
              className="account-item"
              type="button"
              onClick={() => {
                setSettingsTab("general");
                setShowSettings(true);
                setShowAccountMenu(false);
              }}
            >
              <span className="account-ico">
                <GearIcon size={16} />
              </span>
              <span className="account-label">Settings</span>
            </button>
            <div className="account-sep" />
            <button
              className="account-item"
              type="button"
              onClick={() => {
                setShowAccountMenu(false);
                void addAccount();
              }}
            >
              <span className="account-ico">
                <UserPlusIcon size={16} />
              </span>
              <span className="account-label">Add account</span>
            </button>
            <button
              className="account-item"
              type="button"
              onClick={() => {
                setShowAccountMenu(false);
                void logout();
              }}
            >
              <span className="account-ico">
                <LogoutIcon size={16} />
              </span>
              <span className="account-label">Log out</span>
            </button>
          </div>
        )}
      </aside>

      <main className="main">
        {showNewChat && (
          <div className="newchat-overlay" onClick={() => setShowNewChat(false)}>
            <span className="newchat-title">To: Start a chat with…</span>
            <div className="newchat-panel" onClick={(event) => event.stopPropagation()}>
              <button className="newchat-item" type="button" onClick={() => openCreateBot("bot")}>
                <span className="newchat-ico">
                  <PlusIcon size={16} />
                </span>
                Create new Bot
              </button>

              <button className="newchat-item" type="button" onClick={() => openCreateBot("group")}>
                <span className="newchat-ico">
                  <UsersIcon size={16} />
                </span>
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
              <span className="thread-pill-name">{activeBotName}</span>
            </span>
            <div className="topbar-right">
              <button
                className="bot-menu-btn"
                type="button"
                title={showBotPanel ? "Hide bot panel" : "Show bot panel"}
                onClick={() => setShowBotPanel((value) => !value)}
              >
                <PanelIcon size={16} />
              </button>
              {activeBot && (
                <button
                  className="bot-menu-btn"
                  type="button"
                  title="Bot settings"
                  onClick={() => openEditBot(activeBot)}
                >
                  <MoreIcon size={16} />
                </button>
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
                      <div className="msg-user-bubble">{message.content}</div>
                      <span className="msg-user-avatar">{initials(user.email)}</span>
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
                      {msgBot && <div className="msg-author">{msgBot.name}</div>}
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
                    {streamBot && <div className="msg-author">{streamBot.name}</div>}
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
          {mentionQuery !== null && groupMemberBots.length > 0 && (
            <div className="mention-popup">
              {groupMemberBots
                .filter((bot) => bot.name.toLowerCase().includes(mentionQuery.toLowerCase()))
                .slice(0, 6)
                .map((bot) => (
                  <button
                    key={bot.id}
                    type="button"
                    className="mention-item"
                    onClick={() => insertMention(bot.name)}
                  >
                    <BotLogo size={18} scheme={BOT_SCHEMES[bot.scheme % BOT_SCHEMES.length]} />
                    {bot.name}
                  </button>
                ))}
            </div>
          )}
          <div className="composer-bar">
            <button className="round" type="button" title="New chat" onClick={() => setShowNewChat(true)}>
              <PlusIcon size={18} />
            </button>
            <textarea
              value={text}
              onChange={(event) => onComposerChange(event.target.value)}
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
              {busy ? "…" : <SendIcon size={16} />}
            </button>
          </div>
        </form>
      </main>

      {showBotPanel && activeBot && (
        <aside className="bot-panel">
          <div className="bot-panel-head">
            <BotLogo size={96} scheme={activeScheme} />
            <div className="bot-panel-name">{activeBotName}</div>
            {editingLabel ? (
              <input
                className="bot-panel-label-input"
                autoFocus
                placeholder="Label"
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveLabel();
                  if (event.key === "Escape") setEditingLabel(false);
                }}
                onBlur={saveLabel}
              />
            ) : botLabel ? (
              <button
                className="bot-panel-label"
                type="button"
                onClick={() => {
                  setLabelDraft(botLabel);
                  setEditingLabel(true);
                }}
              >
                {botLabel}
              </button>
            ) : (
              <button
                className="bot-panel-addlabel"
                type="button"
                onClick={() => {
                  setLabelDraft("");
                  setEditingLabel(true);
                }}
              >
                Add a label
              </button>
            )}
          </div>

          <div className="bot-panel-tabs">
            {(["details", "library", "computer"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`bot-panel-tab ${botPanelTab === tab ? "active" : ""}`}
                onClick={() => setBotPanelTab(tab)}
              >
                {tab === "details" ? "Details" : tab === "library" ? "Library" : "Computer"}
              </button>
            ))}
          </div>

          <div className="bot-panel-body">
            {botPanelTab === "details" && (
              <div className="bot-panel-details">
                <div className="bot-panel-kv">
                  <span>Name</span>
                  <span>{activeBotName}</span>
                </div>
                <div className="bot-panel-kv">
                  <span>Type</span>
                  <span>{inGroup ? "Group" : "Bot"}</span>
                </div>
                {config && (
                  <div className="bot-panel-kv">
                    <span>Model</span>
                    <span>{config.provider}</span>
                  </div>
                )}
                {config && (
                  <div className="bot-panel-kv">
                    <span>Tools</span>
                    <span>
                      {(config.capabilities.join(", ") || "none") + (config.nodeOnline ? " · local" : "")}
                    </span>
                  </div>
                )}
                {inGroup && (
                  <div className="bot-panel-kv">
                    <span>Members</span>
                    <span>{activeBot.memberIds?.length ?? 0}</span>
                  </div>
                )}
                {activeBot.schedule && (
                  <div className="bot-panel-kv">
                    <span>Schedule</span>
                    <span>every {activeBot.schedule.everyMinutes}m</span>
                  </div>
                )}
                {activeBot.instructions && <p className="bot-panel-instructions">{activeBot.instructions}</p>}
              </div>
            )}

            {botPanelTab === "library" && (
              <div className="library">
                <div className="library-new">
                  <input
                    placeholder="new file name"
                    value={libName}
                    onChange={(event) => setLibName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void createLibFile();
                    }}
                  />
                  <button className="ghost small" type="button" onClick={() => void createLibFile()}>
                    New
                  </button>
                </div>
                <ul className="library-list">
                  {botFiles.length === 0 && (
                    <li className="bot-panel-empty">No items yet. Files a bot saves show here.</li>
                  )}
                  {botFiles.map((file) => (
                    <li key={file.id} className={libOpen?.id === file.id ? "active" : ""}>
                      <button className="library-name" type="button" onClick={() => void openLibFile(file)}>
                        {file.name}
                      </button>
                      <button
                        className="library-del"
                        type="button"
                        onClick={() => void deleteLibFile(file.id)}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                {libOpen && (
                  <div className="library-editor">
                    <div className="library-editor-head">{libOpen.name}</div>
                    <textarea
                      value={libContent}
                      onChange={(event) => setLibContent(event.target.value)}
                      rows={8}
                    />
                    <button className="ghost small" type="button" onClick={() => void saveLibFile()}>
                      Save
                    </button>
                  </div>
                )}
              </div>
            )}

            {botPanelTab === "computer" && (
              <div className="bot-panel-screen">
                {liveTask && (liveTask.liveStream || liveTask.screenshotAt) ? (
                  <img
                    className="bot-panel-screen-img"
                    src={
                      liveTask.liveStream
                        ? `${CLOUD_URL}/v1/tasks/${liveTask.id}/stream?token=${encodeURIComponent(token())}`
                        : `${CLOUD_URL}/v1/tasks/${liveTask.id}/screenshot?v=${encodeURIComponent(liveTask.screenshotAt ?? "")}&token=${encodeURIComponent(token())}`
                    }
                    alt="Bot screen"
                  />
                ) : (
                  <div className="bot-panel-screen-empty">
                    <span className="bot-panel-screen-ico">▢</span>
                    <span>{activeBotName}&apos;s screen</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      )}

      {showConnectApps && (
        <div className="apps-overlay" onClick={() => setShowConnectApps(false)}>
          <div className="apps-panel marketplace" onClick={(event) => event.stopPropagation()}>
            <div className="market-head">
              <span className="apps-title">Marketplace</span>
              <div className="market-head-right">
                <button
                  className={`market-installed${marketFilter === "installed" ? " active" : ""}`}
                  type="button"
                  onClick={() => setMarketFilter((value) => (value === "installed" ? "all" : "installed"))}
                >
                  <span className="market-installed-dot" />
                  {connections.length} installed <span className="account-chev">›</span>
                </button>
                <button className="round small" type="button" onClick={() => setShowConnectApps(false)}>
                  <CloseIcon size={13} />
                </button>
              </div>
            </div>

            <div className="market-search-wrap">
              <SearchIcon size={15} />
              <input
                className="market-search"
                placeholder="Search plugins"
                value={marketQuery}
                onChange={(event) => setMarketQuery(event.target.value)}
              />
            </div>

            {(marketViewAll ? ["All plugins"] : MARKET_SECTIONS).map((section) => {
              const apps = (
                section === "All plugins" ? MARKETPLACE : MARKETPLACE.filter((app) => app.section === section)
              ).filter((app) => {
                const installed = app.provider
                  ? connections.some((entry) => entry.provider === app.provider)
                  : false;
                if (marketFilter === "installed" && !installed) return false;
                if (!marketQuery.trim()) return true;
                return `${app.name} ${app.category} ${app.desc}`
                  .toLowerCase()
                  .includes(marketQuery.trim().toLowerCase());
              });
              if (apps.length === 0) return null;
              return (
                <section key={section} className="market-section">
                  <div className="market-section-head">
                    <h3>{section}</h3>
                    {section === "All plugins" ? (
                      <button
                        className="market-viewall"
                        type="button"
                        onClick={() => setMarketViewAll(false)}
                      >
                        Back
                      </button>
                    ) : section === "Featured" ? (
                      <button className="market-viewall" type="button" onClick={() => setMarketViewAll(true)}>
                        View all
                      </button>
                    ) : null}
                  </div>
                  <div className="market-rows">
                    {apps.map((app) => {
                      const installed = app.provider
                        ? connections.some((entry) => entry.provider === app.provider)
                        : false;
                      return (
                        <div key={app.id} className="market-row">
                          <span className="market-ico">{app.icon}</span>
                          <span className="market-row-text">
                            <span className="market-name">{app.name}</span>
                            <span className="market-desc">{app.desc}</span>
                          </span>
                          {app.provider ? (
                            installed ? (
                              <button
                                className="market-btn"
                                type="button"
                                onClick={() => void disconnectApp(app.provider!)}
                              >
                                Disconnect
                              </button>
                            ) : app.tokenApp ? (
                              tokenInputFor === app.provider ? (
                                <div className="market-token">
                                  <input
                                    type="password"
                                    placeholder="Token"
                                    value={tokenValue}
                                    onChange={(event) => setTokenValue(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") void saveToken(app.provider!);
                                    }}
                                  />
                                  <button
                                    className="market-btn"
                                    type="button"
                                    onClick={() => void saveToken(app.provider!)}
                                  >
                                    Save
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="market-btn"
                                  type="button"
                                  onClick={() => {
                                    setTokenInputFor(app.provider);
                                    setTokenValue("");
                                  }}
                                >
                                  Add
                                </button>
                              )
                            ) : (
                              <button
                                className="market-btn"
                                type="button"
                                disabled={connectingApp === app.provider}
                                onClick={() => void connectApp(app.provider!)}
                              >
                                {connectingApp === app.provider ? "Connecting…" : "Add"}
                              </button>
                            )
                          ) : (
                            <button className="market-btn" type="button" disabled>
                              Add
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
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
              <>
                <div className="member-actions">
                  <span className="member-actions-title">Members</span>
                  <button
                    className="link"
                    type="button"
                    onClick={() => setGroupMembers(bots.map((bot) => bot.id))}
                  >
                    Add all
                  </button>
                  <button className="link" type="button" onClick={() => setGroupMembers([])}>
                    None
                  </button>
                </div>
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
              </>
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

      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <nav className="settings-nav">
              {SETTINGS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`settings-tab ${settingsTab === tab.id ? "active" : ""}`}
                  onClick={() => setSettingsTab(tab.id)}
                >
                  <span className="settings-tab-ico">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="settings-pane">
              <div className="settings-pane-head">
                <h2>{SETTINGS_TABS.find((tab) => tab.id === settingsTab)?.label}</h2>
                <button className="round small" type="button" onClick={() => setShowSettings(false)}>
                  ✕
                </button>
              </div>

              {settingsTab === "general" && (
                <div className="settings-sections">
                  <div className="settings-section-title">Account</div>
                  <div className="settings-row">
                    <span className="user-avatar">{initials(user.email)}</span>
                    <span className="settings-row-main">
                      <span className="settings-row-name">{user.email.split("@")[0]}</span>
                      <span className="settings-row-sub">{user.email}</span>
                    </span>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(user.email)}
                    >
                      Copy
                    </button>
                    <button className="ghost small" type="button" onClick={() => void addAccount()}>
                      Add account
                    </button>
                    <button className="ghost small" type="button" onClick={() => void logout()}>
                      Sign Out
                    </button>
                  </div>

                  <div className="settings-section-title">Appearance</div>
                  <div className="settings-list">
                    <label className="settings-line">
                      <span>Theme</span>
                      <select
                        value={theme}
                        onChange={(event) => {
                          setTheme(event.target.value);
                          localStorage.setItem("botifyr.theme", event.target.value);
                        }}
                      >
                        <option value="system">Follow System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </label>
                    <label className="settings-line">
                      <span>Language</span>
                      <select
                        value={language}
                        onChange={(event) => {
                          setLanguage(event.target.value);
                          localStorage.setItem("botifyr.language", event.target.value);
                        }}
                      >
                        <option value="system">Follow System</option>
                        <option value="en">English</option>
                      </select>
                    </label>
                    <label className="settings-line">
                      <span>Check Spelling While Typing</span>
                      <input
                        type="checkbox"
                        checked={spelling}
                        onChange={(event) => {
                          setSpelling(event.target.checked);
                          localStorage.setItem("botifyr.spelling", event.target.checked ? "1" : "0");
                        }}
                      />
                    </label>
                  </div>

                  <div className="settings-section-title">System</div>
                  <div className="settings-list">
                    <label className="settings-line">
                      <span>Microphone</span>
                      <select defaultValue="default">
                        <option value="default">System Default</option>
                      </select>
                    </label>
                    <label className="settings-line">
                      <span>Use hardware acceleration</span>
                      <input
                        type="checkbox"
                        checked={hardware}
                        onChange={(event) => {
                          setHardware(event.target.checked);
                          localStorage.setItem("botifyr.hardware", event.target.checked ? "1" : "0");
                        }}
                      />
                    </label>
                  </div>

                  <div className="settings-section-title">Bot</div>
                  <div className="settings-list">
                    <label className="settings-line">
                      <span>Timezone</span>
                      <span className="settings-static">
                        {Intl.DateTimeFormat().resolvedOptions().timeZone}
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {settingsTab === "computer" && (
                <div className="settings-sections">
                  <div className="settings-section-title">Computers</div>
                  <div className="settings-row">
                    <span className="settings-row-main">
                      <span className="settings-row-name">{computerName}</span>
                      <span className="settings-row-sub">This is the computer you are using now</span>
                    </span>
                    <input
                      className="settings-input"
                      value={computerName}
                      onChange={(event) => {
                        setComputerName(event.target.value);
                        localStorage.setItem("botifyr.computerName", event.target.value);
                      }}
                    />
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => setCheckNote("Computer name saved")}
                    >
                      Save
                    </button>
                  </div>

                  <div className="settings-section-title">Execution on this computer</div>
                  <label className="settings-line">
                    <span>Approvals</span>
                    <select
                      value={executionMode}
                      onChange={(event) => {
                        const value = event.target.value as "ask" | "always_allow";
                        setExecutionMode(value);
                        localStorage.setItem("botifyr.execution", value);
                      }}
                    >
                      <option value="ask">Ask first</option>
                      <option value="always_allow">Always allow</option>
                    </select>
                  </label>

                  <div className="settings-section-title">My computer</div>
                  <label className="settings-line">
                    <span>Connection</span>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => (config?.nodeOnline ? void stopLocalNode() : void startLocalNode())}
                    >
                      {config?.nodeOnline ? "Connected — disconnect" : "Connect this computer"}
                    </button>
                  </label>
                  <label className="settings-line">
                    <span>Route tasks through this computer</span>
                    <input
                      type="checkbox"
                      checked={useComputer}
                      disabled={!config?.nodeOnline}
                      onChange={(event) => setUseComputer(event.target.checked)}
                    />
                  </label>
                  <p className="settings-note">
                    When on, your messages use your own browser and shell (with approvals) instead of the
                    cloud.
                  </p>
                  {checkNote && <p className="settings-note">{checkNote}</p>}
                </div>
              )}

              {settingsTab === "usage" && (
                <div className="settings-sections">
                  <div className="trial-card">
                    <div className="trial-head">
                      <span>Trial usage</span>
                      <span>{trialPercent}%</span>
                    </div>
                    <div className="trial-bar">
                      <span style={{ width: `${trialPercent}%` }} />
                    </div>
                    <div className="trial-foot">Ends in {trialDaysLeft} days</div>
                  </div>

                  <div className="settings-section-title">Manage Plan</div>
                  <div className="settings-row">
                    <span className="settings-row-main">
                      <span className="settings-row-name">Current plan: Trial</span>
                      <span className="settings-row-sub">
                        {config?.usage
                          ? `${config.usage.tokensToday.toLocaleString()} tokens · ${config.usage.requestsToday} requests today`
                          : "No usage yet"}
                      </span>
                    </span>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => setCheckNote("Upgrade is not available yet.")}
                    >
                      Upgrade to Pro
                    </button>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-main">
                      <span className="settings-row-name">Cancel Trial</span>
                      <span className="settings-row-sub">Stop the trial at the end of the period</span>
                    </span>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => setCheckNote("Your trial will end at the end of the current period.")}
                    >
                      Cancel Trial
                    </button>
                  </div>
                  {checkNote && <p className="settings-note">{checkNote}</p>}
                </div>
              )}

              {settingsTab === "updates" && (
                <div className="settings-sections">
                  <div className="settings-section-title">Botifyr Updates</div>
                  <label className="settings-line">
                    <span>Update Track</span>
                    <select
                      value={updateTrack}
                      onChange={(event) => {
                        setUpdateTrack(event.target.value);
                        localStorage.setItem("botifyr.updateTrack", event.target.value);
                      }}
                    >
                      <option value="stable">Stable</option>
                      <option value="beta">Beta</option>
                    </select>
                  </label>
                  <label className="settings-line">
                    <span>Automatic Updates</span>
                    <input
                      type="checkbox"
                      checked={autoUpdate}
                      onChange={(event) => {
                        setAutoUpdate(event.target.checked);
                        localStorage.setItem("botifyr.autoUpdate", event.target.checked ? "1" : "0");
                      }}
                    />
                  </label>
                  <div className="settings-row">
                    <span className="settings-row-main">
                      <span className="settings-row-name">Version 0.1.0</span>
                      <span className="settings-row-sub">You're up to date</span>
                    </span>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => setCheckNote("You're on the latest version.")}
                    >
                      Check for Updates
                    </button>
                  </div>
                  {checkNote && <p className="settings-note">{checkNote}</p>}
                </div>
              )}

              {settingsTab === "vault" && (
                <div className="settings-sections">
                  <div className="settings-section-title">Vault ({secrets.length})</div>
                  <form className="vault-form" onSubmit={addSecret}>
                    <input
                      placeholder="NAME"
                      value={secretName}
                      onChange={(event) => setSecretName(event.target.value)}
                    />
                    <input
                      type="password"
                      placeholder="secret value"
                      value={secretValue}
                      onChange={(event) => setSecretValue(event.target.value)}
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
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface MarketApp {
  id: string;
  /** Connection provider id, or null when the app is not available yet. */
  provider: string | null;
  /** True when the app connects with a personal access token (no OAuth). */
  tokenApp?: boolean;
  name: string;
  category: string;
  section: string;
  desc: string;
  icon: ReactNode;
}

const MARKET_SECTIONS = ["For you", "Featured", "Developer", "Design", "Files", "Social"];

const MARKETPLACE: MarketApp[] = [
  {
    id: "github",
    provider: "github",
    tokenApp: true,
    name: "GitHub",
    category: "Developer",
    section: "For you",
    desc: "Read repositories and issues",
    icon: <GithubBrand size={24} />,
  },
  {
    id: "slack",
    provider: "slack",
    tokenApp: true,
    name: "Slack",
    category: "Communication",
    section: "For you",
    desc: "Send and read team messages",
    icon: <SlackBrand size={24} />,
  },
  {
    id: "telegram",
    provider: "telegram",
    tokenApp: true,
    name: "Telegram",
    category: "Communication",
    section: "For you",
    desc: "Send messages from your Telegram bot",
    icon: <TelegramBrand size={24} />,
  },
  {
    id: "gmail",
    provider: "gmail",
    name: "Gmail",
    category: "Communication",
    section: "Featured",
    desc: "Read, search, and draft email",
    icon: <GmailIcon size={26} />,
  },
  {
    id: "calendar",
    provider: "calendar",
    name: "Google Calendar",
    category: "Productivity",
    section: "Featured",
    desc: "See your schedule and create events",
    icon: <CalendarIcon size={26} />,
  },
  {
    id: "drive",
    provider: "drive",
    name: "Google Drive",
    category: "Files",
    section: "Featured",
    desc: "Find, read, and organize your files",
    icon: <DriveIcon size={26} />,
  },
  {
    id: "notion",
    provider: "notion",
    tokenApp: true,
    name: "Notion",
    category: "Productivity",
    section: "Featured",
    desc: "Search and update your pages",
    icon: <NotionBrand size={24} />,
  },
  {
    id: "linear",
    provider: null,
    name: "Linear",
    category: "Developer",
    section: "Developer",
    desc: "Track issues and projects",
    icon: <span className="market-emoji">📐</span>,
  },
  {
    id: "figma",
    provider: null,
    name: "Figma",
    category: "Design",
    section: "Design",
    desc: "Read design files and comments",
    icon: <span className="market-emoji">🎨</span>,
  },
  {
    id: "dropbox",
    provider: null,
    name: "Dropbox",
    category: "Files",
    section: "Files",
    desc: "Find and read your files",
    icon: <span className="market-emoji">📦</span>,
  },
  {
    id: "x",
    provider: null,
    name: "X",
    category: "Social",
    section: "Social",
    desc: "Draft and schedule posts",
    icon: <span className="market-emoji">𝕏</span>,
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
