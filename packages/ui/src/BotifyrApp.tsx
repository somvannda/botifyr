import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent,
} from "react";
import type {
  AuditEvent,
  Bot,
  BotFile,
  BotRole,
  CapabilityGrant,
  ChatMessage,
  CompanyReport,
  ConnectionInfo,
  CreateWorkspaceRequest,
  Department,
  LearnedSkill,
  RuntimeConfig,
  SecretSummary,
  ServerEvent,
  Session,
  Skill,
  Task,
  User,
  WorkItem,
  WorkspaceBudget,
  WorkspaceWithRoles,
} from "@botifyr/shared";
import { DEPARTMENTS, ROLE_CATALOG } from "@botifyr/shared";
import { AuthError, BotifyrClient, type Conversation, type MediaItem, type Person } from "@botifyr/client";
import { CalendarIcon, DriveIcon, GmailIcon } from "./AppIcons";
import { GithubBrand, NotionBrand, SlackBrand, TelegramBrand } from "./BrandIcons";
import { BOT_SCHEMES, BotLogo } from "./BotLogo";
import {
  BellIcon,
  ChartIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ForwardIcon,
  GearIcon,
  HelpIcon,
  LockIcon,
  LogoutIcon,
  MicIcon,
  MobileIcon,
  MonitorIcon,
  MoreIcon,
  PanelIcon,
  PlusIcon,
  RefreshIcon,
  ReplyIcon,
  SparkIcon,
  SearchIcon,
  SendIcon,
  SmileyIcon,
  StopIcon,
  UserPlusIcon,
  UsersIcon,
} from "./Icons";
import { Markdown } from "./Markdown";
import { P2P, deviceId, saveBlob, setIceServers } from "./p2p";
import { defaultBridge, type BotBridge } from "./bridge";
import { mergeTask } from "./taskMerge";
import { mediaKind, type MediaKind } from "./mediaUtils";
import "./styles.css";

const CLOUD_URL = (import.meta.env.VITE_CLOUD_URL as string | undefined) ?? "http://localhost:8787";
const ADMIN_URL = (import.meta.env.VITE_ADMIN_URL as string | undefined) ?? "http://localhost:4322/admin";
const SKILLS_URL = (import.meta.env.VITE_SKILLS_URL as string | undefined) ?? "http://localhost:4322/skills";

/** A small, curated emoji palette for bot/group identity. */
const EMOJI_CHOICES = [
  "🤖",
  "👥",
  "🧠",
  "🦾",
  "✨",
  "🎬",
  "🎵",
  "📊",
  "🔍",
  "✍️",
  "🧑‍💻",
  "🛠️",
  "📚",
  "🧭",
  "⚡",
  "🌐",
  "📦",
  "🎨",
  "🛰️",
  "🔬",
  "💡",
  "🗂️",
  "🧪",
  "🚀",
];
const DEFAULT_EMOJI = "🤖";
const DEFAULT_GROUP_EMOJI = "👥";

/** Older data (or a mangled write) may hold "??" — treat that as “no emoji”. */
function cleanEmoji(value: string | undefined, isGroup: boolean): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.includes("?")) return isGroup ? DEFAULT_GROUP_EMOJI : DEFAULT_EMOJI;
  return trimmed;
}
const TOKEN_KEY = "botifyr.token";
const REFRESH_KEY = "botifyr.refresh";

type ConnectionState = "connecting" | "online" | "offline";

/** A transient in-app notification (incoming message or finished task). */
interface Toast {
  id: string;
  kind: "message" | "task";
  title: string;
  body: string;
  sessionId?: string;
}

/** A stored notification shown in the header notification centre. */
interface AppNotification extends Toast {
  at: string;
  read: boolean;
}

const NOTIFICATIONS_KEY = "botifyr.notifications";
const SEEN_MESSAGES_KEY = "botifyr.seenMessages";

const SETTINGS_TABS = [
  { id: "general", label: "General", icon: <GearIcon size={16} /> },
  { id: "computer", label: "Computer", icon: <MonitorIcon size={16} /> },
  { id: "usage", label: "Usage & Billing", icon: <ChartIcon size={16} /> },
  { id: "skills", label: "Learned skills", icon: <SparkIcon size={16} /> },
  { id: "media", label: "Downloads", icon: <PanelIcon size={16} /> },
  { id: "updates", label: "Updates", icon: <DownloadIcon size={16} /> },
  { id: "vault", label: "Vault", icon: <LockIcon size={16} /> },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

function token(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

const PENDING_KEY = "botifyr.pendingState";

export function BotifyrApp({ bridge = defaultBridge }: { bridge?: BotBridge }) {
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
  const [groupWorking, setGroupWorking] = useState<{ sessionId: string; names: string[] } | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; author: string; content: string } | null>(null);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("botifyr.readAt") ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [shareItem, setShareItem] = useState<MediaItem | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<{ title: string; decision: "allow" | "deny" } | null>(
    null,
  );
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(NOTIFICATIONS_KEY) ?? "[]") as AppNotification[];
    } catch {
      return [];
    }
  });
  const [notifOpen, setNotifOpen] = useState(false);
  const seenMessagesRef = useRef<Set<string>>(
    (() => {
      try {
        return new Set(JSON.parse(localStorage.getItem(SEEN_MESSAGES_KEY) ?? "[]") as string[]);
      } catch {
        return new Set<string>();
      }
    })(),
  );
  const seededSessionsRef = useRef<Set<string>>(new Set());
  const taskStatusRef = useRef<Record<string, string>>({});
  const bootAtRef = useRef<number>(Date.now());
  const [reactions, setReactions] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("botifyr.reactions") ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [forwardMessage, setForwardMessage] = useState<{ content: string } | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRoles[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [stream, setStream] = useState<{
    sessionId: string;
    taskId: string;
    botId?: string;
    text: string;
  } | null>(null);
  const [createBotMode, setCreateBotMode] = useState<"bot" | "group" | "edit" | null>(null);
  const [companySetupOpen, setCompanySetupOpen] = useState(false);
  const [companySource, setCompanySource] = useState("");
  const [companyPlan, setCompanyPlan] = useState<
    (CreateWorkspaceRequest & { template?: string; rationale?: string[] }) | null
  >(null);
  const [companyBusy, setCompanyBusy] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companyEdit, setCompanyEdit] = useState<{ id: string; name: string } | null>(null);
  const [companyStep, setCompanyStep] = useState<"source" | "review" | "confirm">("source");
  const [confirmCompanyDelete, setConfirmCompanyDelete] = useState(false);
  const [wizardUseHours, setWizardUseHours] = useState(false);
  const [wizardHoursStart, setWizardHoursStart] = useState("9");
  const [wizardHoursEnd, setWizardHoursEnd] = useState("18");
  const [wizardWeekdays, setWizardWeekdays] = useState(true);
  const [wizardTimezone, setWizardTimezone] = useState("");
  const [wizardBudget, setWizardBudget] = useState("");
  const [wizardActivate, setWizardActivate] = useState(false);
  const [boardWorkspace, setBoardWorkspace] = useState<{ id: string; name: string } | null>(null);
  const [boardItems, setBoardItems] = useState<Array<WorkItem>>([]);
  const [boardTitle, setBoardTitle] = useState("");
  const [boardBusy, setBoardBusy] = useState(false);
  const [hqTab, setHqTab] = useState<"need" | "team" | "board" | "budget" | "standup" | "office" | "wiki">(
    "need",
  );
  const [hqNeeds, setHqNeeds] = useState<Array<Task>>([]);
  const [hqBudget, setHqBudget] = useState<WorkspaceBudget | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [hqGrants, setHqGrants] = useState<Array<CapabilityGrant>>([]);
  const [hqReports, setHqReports] = useState<Array<CompanyReport>>([]);
  const [hqWiki, setHqWiki] = useState<Array<{ name: string; content: string }>>([]);
  const [addMemberBotId, setAddMemberBotId] = useState("");
  const [hoursStart, setHoursStart] = useState("9");
  const [hoursEnd, setHoursEnd] = useState("18");
  const [hoursWeekdays, setHoursWeekdays] = useState(true);
  const [hoursTimezone, setHoursTimezone] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);
  const [botName, setBotName] = useState("");
  const [botEmoji, setBotEmoji] = useState("🤖");
  const [botScheme, setBotScheme] = useState(0);
  const [botIntro, setBotIntro] = useState("");
  const [botWorkspace, setBotWorkspace] = useState("");
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>({});
  const [workspaceFilter, setWorkspaceFilter] = useState("all");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [autonomous, setAutonomous] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [schedulePrompt, setSchedulePrompt] = useState("");
  const [scheduleEvery, setScheduleEvery] = useState(60);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [learnedSkills, setLearnedSkills] = useState<LearnedSkill[]>([]);
  const [downloads, setDownloads] = useState<Array<{ name: string; size: number }>>([]);
  const [player, setPlayer] = useState<{ items: Array<{ name: string; url: string }>; index: number } | null>(
    null,
  );
  const playerFile = player ? player.items[player.index] : null;
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [friends, setFriends] = useState<Person[]>([]);
  const [friendRequests, setFriendRequests] = useState<
    Array<{ id: string; direction: "incoming" | "outgoing"; person: Person }>
  >([]);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleResults, setPeopleResults] = useState<Person[]>([]);
  const [showPeople, setShowPeople] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupSelection, setGroupSelection] = useState<string[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileHandle, setProfileHandle] = useState("");
  const [profileEmoji, setProfileEmoji] = useState("🙂");
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [downloadsExpanded, setDownloadsExpanded] = useState(false);
  const [devices, setDevices] = useState<Array<{ id: string; name: string; online: boolean }>>([]);
  const myDeviceId = useMemo(() => deviceId(), []);
  const p2p = useMemo(
    () =>
      new P2P({
        signal: (to, data) => {
          void client.sendSignal(to, myDeviceId, data).catch(() => {});
        },
        onFile: (name, blob) => saveBlob(name, blob),
      }),
    [client, myDeviceId],
  );
  const [ytCookies, setYtCookies] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillQuery, setSkillQuery] = useState("");
  const [savingBot, setSavingBot] = useState(false);
  const [botSaved, setBotSaved] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);
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
  const [density, setDensity] = useState<"cozy" | "compact">(() =>
    localStorage.getItem("botifyr.density") === "compact" ? "compact" : "cozy",
  );
  const [order, setOrder] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("botifyr.order") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [language, setLanguage] = useState(() => localStorage.getItem("botifyr.language") ?? "system");
  const [spelling, setSpelling] = useState(() => localStorage.getItem("botifyr.spelling") !== "0");
  const [hardware, setHardware] = useState(() => localStorage.getItem("botifyr.hardware") !== "0");
  const [updateTrack, setUpdateTrack] = useState(
    () => localStorage.getItem("botifyr.updateTrack") ?? "stable",
  );
  const [autoUpdate, setAutoUpdate] = useState(() => localStorage.getItem("botifyr.autoUpdate") !== "0");
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [plan, setPlan] = useState<"free" | "pro" | "business">("free");
  const [billing, setBilling] = useState<Awaited<ReturnType<BotifyrClient["billing"]>> | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [showBotPanel, setShowBotPanel] = useState(() => localStorage.getItem("botifyr.botPanel") !== "0");
  const [screenOn, setScreenOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
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
  const [libraryCategory, setLibraryCategory] = useState<MediaKind | "all">("all");
  const [downloadsCategory, setDownloadsCategory] = useState<MediaKind | "all">("all");
  const [libName, setLibName] = useState("");
  const [libOpen, setLibOpen] = useState<{ id: string; name: string } | null>(null);
  const [libContent, setLibContent] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");

  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeSessionId;
  const activeBotIdRef = useRef<string | null>(null);
  activeBotIdRef.current = activeBotId;
  const botsRef = useRef<Bot[]>([]);
  botsRef.current = bots;
  const sidebarRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeStartedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cancelSigninRef = useRef(false);

  // Persist token rotations (login + silent refresh) so a restart stays signed in.
  useEffect(() => {
    client.onToken = (auth) => {
      localStorage.setItem(TOKEN_KEY, auth.token);
      if (auth.refreshToken) localStorage.setItem(REFRESH_KEY, auth.refreshToken);
    };
  }, [client]);

  // The account's per-bot autoApprove is authoritative, so mirror it here when
  // every bot agrees — otherwise the setting would disagree across hosts.
  useEffect(() => {
    if (bots.length === 0) return;
    if (bots.every((bot) => bot.autoApprove === true)) setExecutionMode("always_allow");
    else if (bots.every((bot) => bot.autoApprove !== true)) setExecutionMode("ask");
  }, [bots]);

  // Restore a stored token on launch; resume a pending sign-in if any.
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      client.setToken(stored);
      client.setRefreshToken(localStorage.getItem(REFRESH_KEY));
      // Never let a slow/hung auth check leave the app on "Loading…" forever:
      // if it doesn't resolve in time, clear the saved session and show sign-in.
      const giveUp = setTimeout(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        client.setToken(null);
        setAuthChecked(true);
      }, 8000);
      client
        .me()
        .then((account) => setUser(account))
        .catch(() => {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_KEY);
          client.setToken(null);
        })
        .finally(() => {
          clearTimeout(giveUp);
          setAuthChecked(true);
        });
      return () => clearTimeout(giveUp);
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
    setWorkspaces([]);
    setConnections([]);
    setActiveSessionId(null);
    setActiveBotId(null);
    setAudit([]);
    setShowAudit(false);

    Promise.all([
      client.listBots(),
      client.listWorkspaces(),
      client.listSessions(),
      client.listConnections(),
      client.listSkills(),
      client.listLearnedSkills(),
      client.billing(),
    ])
      .then(([botList, workspaceList, sessionList, connectionList, skillList, learnedList, billing]) => {
        if (!mounted) return;
        setBots(botList);
        setWorkspaces(workspaceList);
        setSessions(sessionList);
        setConnections(connectionList);
        setSkills(skillList);
        setLearnedSkills(learnedList);
        setPlan(billing.plan);
        setBilling(billing);
        // Open the last-used chat, else the most recently active one.
        const lastAt = (bot: Bot): string => {
          const session = sessionList.find((entry) => entry.id === bot.sessionId);
          const message = session?.messages[session.messages.length - 1];
          return message?.createdAt ?? session?.createdAt ?? bot.createdAt;
        };
        const savedId = localStorage.getItem("botifyr.activeBotId");
        const chosen =
          botList.find((bot) => bot.id === savedId) ??
          [...botList].sort((a, b) => lastAt(b).localeCompare(lastAt(a)))[0];
        if (chosen) {
          setActiveBotId(chosen.id);
          setActiveSessionId(chosen.sessionId);
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
          .then((info) => {
            if (!mounted) return;
            setConfig(info);
            if (info.iceServers) {
              setIceServers(
                info.iceServers.map((server) => ({
                  urls: server.urls,
                  username: server.username,
                  credential: server.credential,
                })),
              );
            }
          })
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

    const disconnect = client.connect(
      {
        onOpen: () => mounted && setConnection("online"),
        onClose: () => {
          if (!mounted) return;
          setConnection("offline");
          client.me().catch((err: unknown) => {
            if (err instanceof AuthError) void logout();
          });
        },
        onEvent: (event) => mounted && applyEvent(event),
      },
      { device: myDeviceId, deviceName: computerName },
    );

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
    setHistoryIndex(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (activeBotId) localStorage.setItem("botifyr.activeBotId", activeBotId);
  }, [activeBotId]);

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

  /** Pull fresh bots + companies after a new session appears (e.g. company.create
   *  just hired people) so the sidebar groups them without a manual reload. */
  function scheduleSidebarRefresh() {
    if (sidebarRefreshRef.current) clearTimeout(sidebarRefreshRef.current);
    sidebarRefreshRef.current = setTimeout(() => {
      sidebarRefreshRef.current = null;
      Promise.all([client.listBots(), client.listWorkspaces()])
        .then(([botList, workspaceList]) => {
          botsRef.current = botList;
          setBots(botList);
          setWorkspaces(workspaceList);
        })
        .catch(() => {});
    }, 400);
  }

  function applyEvent(event: ServerEvent) {
    switch (event.type) {
      case "session.created":
        setSessions((prev) =>
          prev.some((s) => s.id === event.session.id) ? prev : [event.session, ...prev],
        );
        setActiveSessionId((prev) => prev ?? event.session.id);
        scheduleSidebarRefresh();
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
      case "bot.deleted": {
        // Another device removed this bot: drop it (and its thread) so the
        // sidebar can't keep a stale row that fails to delete again.
        const remaining = botsRef.current.filter((bot) => bot.id !== event.botId);
        botsRef.current = remaining;
        setBots(remaining);
        if (event.sessionId) {
          setSessions((prev) => prev.filter((session) => session.id !== event.sessionId));
        }
        if (activeBotIdRef.current === event.botId) {
          const next = remaining[0] ?? null;
          setActiveBotId(next?.id ?? null);
          setActiveSessionId(next?.sessionId ?? null);
        }
        break;
      }
      case "assistant.delta":
        setStream((prev) =>
          prev && prev.taskId === event.taskId
            ? { ...prev, text: prev.text + event.text }
            : { sessionId: event.sessionId, taskId: event.taskId, botId: event.botId, text: event.text },
        );
        break;
      case "assistant.reset":
        setStream((prev) => (prev && prev.taskId === event.taskId ? null : prev));
        break;
      case "p2p.signal":
        if (event.to === myDeviceId) void p2p.handleSignal(event.from, event.data);
        break;
      case "group.working":
        setGroupWorking({ sessionId: event.sessionId, names: event.names });
        break;
      case "task.created":
      case "task.updated":
      case "task.completed":
      case "task.failed": {
        setTasks((prev) => {
          const existing = prev[event.task.id];
          return { ...prev, [event.task.id]: mergeTask(existing, event.task) };
        });
        break;
      }
      case "approval.requested":
        setTasks((prev) => {
          const task = prev[event.taskId];
          return task
            ? { ...prev, [event.taskId]: { ...task, approval: event.approval, status: "awaiting_approval" } }
            : prev;
        });
        break;
      case "approval.resolved":
        setTasks((prev) => {
          const task = prev[event.taskId];
          return task ? { ...prev, [event.taskId]: { ...task, approval: event.approval } } : prev;
        });
        break;
    }
  }

  /** Open the conversation a notification points at. */
  function openSessionById(sessionId: string): void {
    const bot = bots.find((entry) => entry.sessionId === sessionId);
    if (bot) {
      selectBot(bot);
      return;
    }
    setActiveBotId(null);
    setActiveSessionId(sessionId);
  }

  const pushToast = useCallback(
    (toast: Omit<Toast, "id">): void => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
      // Also store it in the notification centre so it survives the 6s toast.
      setNotifications((prev) => {
        const next = [{ ...toast, id, at: new Date().toISOString(), read: false }, ...prev].slice(0, 50);
        try {
          localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(next));
        } catch {
          // ignore quota errors
        }
        return next;
      });
      // If the window isn't visible, also raise an OS-level notification.
      if (typeof document !== "undefined" && document.hidden) {
        void bridge.notify?.(toast.title, toast.body);
      }
      window.setTimeout(() => setToasts((prev) => prev.filter((entry) => entry.id !== id)), 6000);
    },
    [bridge],
  );

  function dismissToast(id: string): void {
    setToasts((prev) => prev.filter((entry) => entry.id !== id));
  }

  function toggleNotifications(): void {
    setNotifOpen((value) => {
      const next = !value;
      if (next) {
        setNotifications((prev) => {
          const updated = prev.map((entry) => (entry.read ? entry : { ...entry, read: true }));
          try {
            localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated));
          } catch {
            // ignore
          }
          return updated;
        });
      }
      return next;
    });
  }

  function clearNotifications(): void {
    setNotifications([]);
    try {
      localStorage.removeItem(NOTIFICATIONS_KEY);
    } catch {
      // ignore
    }
  }

  async function openExternal(url: string) {
    await bridge.openExternal(url);
  }

  /** Start "Botifyr's computer" (a session desktop sandbox) and open its view. */
  async function startComputerScreen(): Promise<void> {
    if (!activeSessionId) return;
    try {
      await client.startComputer(activeSessionId);
      setScreenOn(true);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Close the modal and stop the desktop container (frees CPU/RAM). */
  function stopScreen(): void {
    const sessionId = activeSessionId;
    setScreenOn(false);
    if (sessionId) void client.stopComputer(sessionId).catch(() => {});
  }

  // A real remote-desktop view: mouse + keyboard are forwarded to the sandbox.
  const SCREEN_W = 1280;
  const SCREEN_H = 800;
  const screenRef = useRef<HTMLDivElement | null>(null);
  const lastMoveRef = useRef(0);

  useEffect(() => {
    if (screenOn) screenRef.current?.focus();
  }, [screenOn]);

  function screenCoords(event: ReactMouseEvent<HTMLImageElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * SCREEN_W),
      y: Math.round(((event.clientY - rect.top) / rect.height) * SCREEN_H),
    };
  }

  function onScreenMove(event: ReactMouseEvent<HTMLImageElement>): void {
    if (!activeSessionId) return;
    const now = Date.now();
    if (now - lastMoveRef.current < 60) return; // throttle pointer moves
    lastMoveRef.current = now;
    const { x, y } = screenCoords(event);
    void client.computerInput(activeSessionId, "move", { x, y }).catch(() => {});
  }

  function onScreenDown(event: ReactMouseEvent<HTMLImageElement>): void {
    if (!activeSessionId) return;
    const { x, y } = screenCoords(event);
    const button = event.button === 2 ? 3 : event.button === 1 ? 2 : 1;
    void client.computerInput(activeSessionId, "click", { x, y, button }).catch(() => {});
  }

  function onScreenWheel(event: ReactWheelEvent<HTMLImageElement>): void {
    if (!activeSessionId) return;
    void client
      .computerInput(activeSessionId, "scroll", { amount: event.deltaY > 0 ? 3 : -3 })
      .catch(() => {});
  }

  function onScreenKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!activeSessionId) return;
    event.preventDefault();
    if (event.key.length === 1) {
      void client.computerInput(activeSessionId, "type", { text: event.key }).catch(() => {});
      return;
    }
    const map: Record<string, string> = {
      Enter: "Return",
      Backspace: "BackSpace",
      Tab: "Tab",
      Escape: "Escape",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Delete: "Delete",
    };
    const key = map[event.key];
    if (key) void client.computerInput(activeSessionId, "key", { key }).catch(() => {});
  }

  /** Start/stop recording the desktop (teach-by-demonstration). */
  async function toggleRecord(): Promise<void> {
    if (!activeSessionId) return;
    const next = !recording;
    try {
      await client.recordComputer(activeSessionId, next);
      setRecording(next);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Save the recorded demonstration as a learned task (pending review). */
  async function saveTask(): Promise<void> {
    if (!activeSessionId) return;
    try {
      const { name } = await client.learnTask(activeSessionId);
      pushToast({ kind: "task", title: "Task saved", body: `"${name}" is pending review.` });
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Replay a learned task (one recorded by demonstration) on this desktop. */
  async function replayTask(name: string): Promise<void> {
    if (!activeSessionId) return;
    try {
      const { steps } = await client.replayTask(activeSessionId, name);
      pushToast({ kind: "task", title: "Task replayed", body: `${steps} step(s) re-run.` });
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Open the media viewer at an item so you can browse prev/next. */
  function openPlayer(items: Array<{ name: string; url: string }>, index: number): void {
    if (items.length === 0) return;
    setPlayer({ items, index: Math.max(0, Math.min(index, items.length - 1)) });
  }

  // Arrow keys / Esc while the viewer is open.
  useEffect(() => {
    if (!player) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlayer(null);
      else if (event.key === "ArrowRight")
        setPlayer((prev) =>
          prev && prev.index < prev.items.length - 1 ? { ...prev, index: prev.index + 1 } : prev,
        );
      else if (event.key === "ArrowLeft")
        setPlayer((prev) => (prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

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
        localStorage.setItem(TOKEN_KEY, issued.token);
        if (issued.refreshToken) localStorage.setItem(REFRESH_KEY, issued.refreshToken);
        localStorage.removeItem(PENDING_KEY);
        client.setToken(issued.token);
        client.setRefreshToken(issued.refreshToken ?? null);
        const account = await client.me();
        setUser(account);
        void bridge.focusWindow?.();
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
    localStorage.removeItem(REFRESH_KEY);
    client.setToken(null);
    client.setRefreshToken(null);
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

  function openCompanySetup() {
    setCompanySetupOpen(true);
    setCompanySource("");
    setCompanyPlan(null);
    setCompanyError(null);
    setCompanyStep("source");
    setWizardUseHours(false);
    setWizardHoursStart("9");
    setWizardHoursEnd("18");
    setWizardWeekdays(true);
    setWizardTimezone("");
    setWizardBudget("");
    setWizardActivate(false);
    setShowNewChat(false);
  }

  function closeCompanySetup() {
    setCompanySetupOpen(false);
    setCompanyPlan(null);
    setCompanyError(null);
    setCompanyBusy(false);
  }

  /** A pasted value is treated as a URL when it looks like one, else an idea. */
  function looksLikeUrl(value: string): boolean {
    return /^https?:\/\//i.test(value) || /^[\w-]+\.[a-z]{2,}(\/|$)/i.test(value);
  }

  async function runCompanyPlan() {
    const value = companySource.trim();
    if (!value || companyBusy) return;
    setCompanyBusy(true);
    setCompanyError(null);
    try {
      const plan = await client.planCompany({ kind: looksLikeUrl(value) ? "url" : "idea", value });
      // Keep the suggested name unique so two companies never look identical.
      const taken = new Set(workspaces.map((entry) => entry.name.trim().toLowerCase()));
      let suggested = plan.name;
      if (taken.has(suggested.trim().toLowerCase())) {
        for (let n = 2; n < 1000; n += 1) {
          if (!taken.has(`${plan.name} ${n}`.toLowerCase())) {
            suggested = `${plan.name} ${n}`;
            break;
          }
        }
      }
      setCompanyPlan({ ...plan, name: suggested });
      setCompanyStep("review");
    } catch (err: unknown) {
      setCompanyError(messageOf(err));
    } finally {
      setCompanyBusy(false);
    }
  }

  async function createCompany() {
    if (!companyPlan || companyBusy) return;
    setCompanyBusy(true);
    setCompanyError(null);
    try {
      // Promote the bot you set the company up with (the Founder) to CEO.
      const founder =
        bots.find((bot) => bot.id === activeBotId && !bot.workspace) ??
        bots.find((bot) => !bot.workspace && bot.name === "Botifyr") ??
        bots.find((bot) => !bot.workspace);
      const created = await client.createWorkspace({ ...companyPlan, ceoBotId: founder?.id });
      // Apply the optional settings chosen in the wizard (best-effort).
      try {
        if (wizardUseHours) {
          await client.updateWorkspace(created.id, {
            operatingHours: {
              start: Math.max(0, Math.min(23, Math.floor(Number(wizardHoursStart) || 0))),
              end: Math.max(1, Math.min(24, Math.floor(Number(wizardHoursEnd) || 24))),
              days: wizardWeekdays ? [1, 2, 3, 4, 5] : undefined,
              timezone: wizardTimezone.trim() || undefined,
            },
          });
        }
        const budget = Math.max(0, Math.floor(Number(wizardBudget) || 0));
        if (budget > 0) await client.setWorkspaceBudget(created.id, budget);
        if (wizardActivate) await client.activateCompany(created.id, "supervised");
      } catch {
        // Settings are best-effort; the company already exists.
      }
      const [botList, sessionList, workspaceList] = await Promise.all([
        client.listBots(),
        client.listSessions(),
        client.listWorkspaces(),
      ]);
      setBots(botList);
      setSessions(sessionList);
      setWorkspaces(workspaceList);
      setWorkspaceFilter(created.id);
      const chairId = created.ceoBotId ?? created.roles[0]?.botId;
      const chair = botList.find((bot) => bot.id === chairId);
      if (chair) {
        setActiveBotId(chair.id);
        setActiveSessionId(chair.sessionId);
      }
      closeCompanySetup();
    } catch (err: unknown) {
      setCompanyError(messageOf(err));
      setCompanyBusy(false);
    }
  }

  function updatePlanMember(
    index: number,
    patch: Partial<NonNullable<CreateWorkspaceRequest["members"]>[number]>,
  ) {
    setCompanyPlan((prev) => {
      if (!prev?.members) return prev;
      return { ...prev, members: prev.members.map((m, i) => (i === index ? { ...m, ...patch } : m)) };
    });
  }

  function removePlanMember(index: number) {
    setCompanyPlan((prev) => {
      if (!prev?.members) return prev;
      return { ...prev, members: prev.members.filter((_, i) => i !== index) };
    });
  }

  function addPlanMember() {
    setCompanyPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        members: [
          ...(prev.members ?? []),
          { name: "New hire", emoji: "🤖", title: "Member", department: "ops", isChair: false },
        ],
      };
    });
  }

  async function renameCompany() {
    if (!companyEdit || companyBusy) return;
    const name = companyEdit.name.trim();
    if (!name) return;
    setCompanyBusy(true);
    setCompanyError(null);
    try {
      await client.updateWorkspace(companyEdit.id, { name });
      const [botList, workspaceList] = await Promise.all([client.listBots(), client.listWorkspaces()]);
      setBots(botList);
      setWorkspaces(workspaceList);
      setCompanyEdit(null);
    } catch (err: unknown) {
      setCompanyError(messageOf(err));
    } finally {
      setCompanyBusy(false);
    }
  }

  async function removeCompany() {
    if (!companyEdit || companyBusy) return;
    setCompanyBusy(true);
    setCompanyError(null);
    try {
      await client.deleteWorkspace(companyEdit.id);
      if (workspaceFilter === companyEdit.id) setWorkspaceFilter("all");
      const [botList, workspaceList] = await Promise.all([client.listBots(), client.listWorkspaces()]);
      setBots(botList);
      setWorkspaces(workspaceList);
      setCompanyEdit(null);
    } catch (err: unknown) {
      setCompanyError(messageOf(err));
    } finally {
      setCompanyBusy(false);
    }
  }

  async function openBoard(workspaceId: string, name: string) {
    setBoardWorkspace({ id: workspaceId, name });
    setBoardTitle("");
    setBoardBusy(true);
    setHqTab("need");
    setAddMemberBotId("");
    try {
      const [items, needs, budget, grants, reports] = await Promise.all([
        client.listWorkItems(workspaceId).catch(() => []),
        client.listWorkspaceNeeds(workspaceId).catch(() => []),
        client.getWorkspaceBudget(workspaceId).catch(() => null),
        client.listCapabilityGrants(workspaceId).catch(() => []),
        client.listCompanyReports(workspaceId).catch(() => []),
      ]);
      setBoardItems(items);
      setHqNeeds(needs);
      setHqBudget(budget);
      setBudgetInput(budget && budget.limitTokens > 0 ? String(budget.limitTokens) : "");
      setHqGrants(grants);
      setHqReports(reports);
      const hours = workspaces.find((entry) => entry.id === workspaceId)?.operatingHours;
      setHoursStart(hours ? String(hours.start) : "9");
      setHoursEnd(hours ? String(hours.end) : "18");
      setHoursWeekdays(hours ? Boolean(hours.days && hours.days.length > 0) : true);
      setHoursTimezone(hours?.timezone ?? "");

      // Company wiki: the chair bot's Library (BRIEF / OKRS / BACKLOG).
      const wiki = await client.listWorkspaceFiles(workspaceId).catch(() => []);
      setHqWiki(wiki.map((file) => ({ name: file.name, content: file.content })));
    } finally {
      setBoardBusy(false);
    }
  }

  function closeBoard() {
    setBoardWorkspace(null);
    setBoardItems([]);
    setBoardTitle("");
    setBoardBusy(false);
    setHqNeeds([]);
    setHqBudget(null);
    setBudgetInput("");
    setHqGrants([]);
    setHqReports([]);
    setHqWiki([]);
    setAddMemberBotId("");
  }

  async function runStandup(kind: "standup" | "weekly" = "standup") {
    const workspace = boardWorkspace;
    if (!workspace) return;
    setBoardBusy(true);
    try {
      const report = await client.runStandup(workspace.id, kind);
      setHqReports((prev) => [report, ...prev]);
    } finally {
      setBoardBusy(false);
    }
  }

  /** Open an employee's live screen (their sandbox desktop) from the Office tab. */
  function openEmployee(bot: Bot) {
    closeBoard();
    selectBot(bot);
    setShowBotPanel(true);
    setBotPanelTab("computer");
    void client.startComputer(bot.sessionId).catch(() => {});
  }

  async function toggleGrant(subject: string, capability: string, granted: boolean) {
    const workspace = boardWorkspace;
    if (!workspace) return;
    await client.setCapabilityGrant(workspace.id, { subject, capability, granted }).catch(() => {});
    setHqGrants(await client.listCapabilityGrants(workspace.id).catch(() => []));
  }

  /** Pause/resume the company: paused companies stop their autonomous schedules. */
  async function setCompanyStatus(status: "active" | "paused") {
    const workspace = boardWorkspace;
    if (!workspace) return;
    await client.updateWorkspace(workspace.id, { status }).catch(() => {});
    setWorkspaces(await client.listWorkspaces().catch(() => workspaces));
  }

  /** One-click halt: cancel every running task across the company's employees. */
  async function stopCompany() {
    const workspace = boardWorkspace;
    if (!workspace) return;
    setBoardBusy(true);
    try {
      await client.stopCompany(workspace.id).catch(() => null);
    } finally {
      setBoardBusy(false);
    }
  }

  /** Set the company's autonomy level (manual = deactivate). */
  async function setAutonomy(level: "manual" | "supervised" | "autonomous") {
    const workspace = boardWorkspace;
    if (!workspace) return;
    setBoardBusy(true);
    try {
      const updated =
        level === "manual"
          ? await client.deactivateCompany(workspace.id).catch(() => null)
          : await client.activateCompany(workspace.id, level).catch(() => null);
      if (updated) setWorkspaces(await client.listWorkspaces().catch(() => workspaces));
    } finally {
      setBoardBusy(false);
    }
  }

  /** Attach an existing (personal) bot to this company. */
  async function addExistingMember() {
    const workspace = boardWorkspace;
    if (!workspace || !addMemberBotId) return;
    setBoardBusy(true);
    try {
      const bot = bots.find((entry) => entry.id === addMemberBotId);
      await client
        .addWorkspaceMember(workspace.id, { botId: addMemberBotId, title: bot?.name })
        .catch(() => null);
      setAddMemberBotId("");
      const [botList, workspaceList] = await Promise.all([client.listBots(), client.listWorkspaces()]);
      setBots(botList);
      setWorkspaces(workspaceList);
    } finally {
      setBoardBusy(false);
    }
  }

  async function saveBudget() {
    const workspace = boardWorkspace;
    if (!workspace) return;
    const limitTokens = Math.max(0, Math.floor(Number(budgetInput) || 0));
    setBoardBusy(true);
    try {
      setHqBudget(await client.setWorkspaceBudget(workspace.id, limitTokens));
    } finally {
      setBoardBusy(false);
    }
  }

  /** Operating hours: scheduled work only happens inside this window (cost control). */
  async function saveHours() {
    const workspace = boardWorkspace;
    if (!workspace) return;
    setBoardBusy(true);
    try {
      await client
        .updateWorkspace(workspace.id, {
          operatingHours: {
            start: Math.max(0, Math.min(23, Math.floor(Number(hoursStart) || 0))),
            end: Math.max(1, Math.min(24, Math.floor(Number(hoursEnd) || 24))),
            days: hoursWeekdays ? [1, 2, 3, 4, 5] : undefined,
            timezone: hoursTimezone.trim() || undefined,
          },
        })
        .catch(() => null);
      setWorkspaces(await client.listWorkspaces().catch(() => workspaces));
    } finally {
      setBoardBusy(false);
    }
  }

  async function refreshNeeds(workspaceId: string) {
    setHqNeeds(await client.listWorkspaceNeeds(workspaceId).catch(() => []));
  }

  async function resolveNeed(task: Task, decision: "allow" | "deny") {
    const workspace = boardWorkspace;
    const approvalId = task.approval?.id;
    if (!approvalId) return;
    await client.resolveApproval(task.id, approvalId, decision).catch(() => {});
    if (workspace) await refreshNeeds(workspace.id);
  }

  async function refreshBoard(workspaceId: string) {
    setBoardItems(await client.listWorkItems(workspaceId).catch(() => []));
  }

  async function addBoardItem() {
    const workspace = boardWorkspace;
    const title = boardTitle.trim();
    if (!workspace || !title) return;
    setBoardBusy(true);
    try {
      await client.createWorkItem(workspace.id, { title });
      setBoardTitle("");
      await refreshBoard(workspace.id);
    } finally {
      setBoardBusy(false);
    }
  }

  async function setWorkStatus(id: string, status: WorkItem["status"]) {
    const workspace = boardWorkspace;
    await client.updateWorkItem(id, { status }).catch(() => {});
    if (workspace) await refreshBoard(workspace.id);
  }

  async function deleteBoardItem(id: string) {
    const workspace = boardWorkspace;
    await client.deleteWorkItem(id).catch(() => {});
    if (workspace) await refreshBoard(workspace.id);
  }

  function openCreateBot(mode: "bot" | "group") {
    setCreateBotMode(mode);
    setEditingBotId(null);
    setBotName("");
    setBotEmoji(mode === "group" ? DEFAULT_GROUP_EMOJI : DEFAULT_EMOJI);
    setBotScheme(bots.length % BOT_SCHEMES.length);
    setBotIntro("");
    setBotWorkspace("");
    setGroupMembers([]);
    setAutonomous(false);
    setAutoApprove(false);
    setSchedulePrompt("");
    setScheduleEvery(60);
    setScheduleEnabled(false);
    setSelectedSkills([]);
    setShowNewChat(false);
  }

  function openEditBot(bot: Bot) {
    setCreateBotMode("edit");
    setEditingBotId(bot.id);
    setBotName(bot.name);
    setBotEmoji(cleanEmoji(bot.emoji, (bot.memberIds?.length ?? 0) > 0));
    setBotScheme(bot.scheme % BOT_SCHEMES.length);
    setBotIntro(bot.instructions);
    setBotWorkspace(bot.workspace ?? "");
    setGroupMembers((bot.memberIds ?? []).filter((id) => id !== bot.id));
    setAutonomous(bot.autonomous === true);
    setAutoApprove(bot.autoApprove === true);
    setSchedulePrompt(bot.schedule?.prompt ?? "");
    setScheduleEvery(bot.schedule?.everyMinutes ?? 60);
    setScheduleEnabled(bot.schedule?.enabled ?? false);
    setSelectedSkills(bot.skills ?? []);
  }

  function closeBotModal() {
    setCreateBotMode(null);
    setEditingBotId(null);
    setSavingBot(false);
    setBotSaved(false);
    setBotError(null);
    setSkillQuery("");
    setEmojiOpen(false);
  }

  async function createBot() {
    const name = botName.trim() || (createBotMode === "group" ? "New group" : "New Bot");
    setSavingBot(true);
    setBotError(null);
    setBotSaved(false);

    if (createBotMode === "edit" && editingBotId) {
      try {
        const updated = await client.updateBot(editingBotId, {
          name,
          emoji: botEmoji.trim() || "🤖",
          scheme: botScheme,
          instructions: botIntro.trim(),
          workspace: botWorkspace.trim(),
          memberIds: groupMembers,
          autonomous,
          autoApprove,
          skills: selectedSkills,
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
        finishBotSave();
      } catch (err: unknown) {
        setBotError(messageOf(err));
        setSavingBot(false);
      }
      return;
    }

    let instructions = botIntro.trim();
    let memberIds: string[] | undefined;
    if (createBotMode === "group") {
      const members = bots.filter((bot) => groupMembers.includes(bot.id));
      if (members.length === 0) {
        setBotError("Pick at least one bot for the group.");
        setSavingBot(false);
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
        workspace: botWorkspace.trim(),
        memberIds,
        autonomous,
        autoApprove,
        skills: selectedSkills,
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
      setShowAudit(false);
      finishBotSave();
    } catch (err: unknown) {
      setBotError(messageOf(err));
      setSavingBot(false);
    }
  }

  /** Flash a "Saved" confirmation, then close the editor. */
  function finishBotSave() {
    setBotSaved(true);
    window.setTimeout(() => closeBotModal(), 750);
  }

  async function upgradePlan(target: "pro" | "business" = "pro") {
    setCheckNote(null);
    try {
      const { url } = await client.billingCheckout({ kind: "plan", plan: target });
      if (url) void openExternal(url);
      setCheckNote("Opening secure checkout…");
    } catch (err: unknown) {
      const message = messageOf(err);
      setCheckNote(message);
      pushToast({ kind: "task", title: "Checkout unavailable", body: message });
    }
  }

  async function topUp(amountCents: number) {
    setTopUpOpen(false);
    setCheckNote(null);
    try {
      const { url } = await client.billingCheckout({ kind: "topup", amountCents });
      if (url) void openExternal(url);
      setCheckNote("Opening secure checkout…");
    } catch (err: unknown) {
      const message = messageOf(err);
      setCheckNote(message);
      pushToast({ kind: "task", title: "Top-up unavailable", body: message });
    }
  }

  async function removeBot(bot: Bot) {
    setConfirmDeleteId(null);
    const dropLocally = () => {
      const remaining = botsRef.current.filter((entry) => entry.id !== bot.id);
      botsRef.current = remaining;
      setBots(remaining);
      setSessions((prev) => prev.filter((session) => session.id !== bot.sessionId));
      if (activeBotIdRef.current === bot.id) {
        const next = remaining[0] ?? null;
        setActiveBotId(next?.id ?? null);
        setActiveSessionId(next?.sessionId ?? null);
      }
      closeBotModal();
    };
    try {
      await client.deleteBot(bot.id);
      dropLocally();
    } catch (err: unknown) {
      // A bot that is already gone still needs to leave the sidebar: treat the
      // server's "not found" as success so a stale row self-heals.
      if (messageOf(err).toLowerCase().includes("not found")) {
        dropLocally();
        return;
      }
      setError(messageOf(err));
    }
  }

  async function sendMessage(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || !activeSessionId || sending) return;
    const sessionId = activeSessionId;
    const payload = replyTo ? `↩ ${replyTo.author}: ${replyTo.content.slice(0, 120)}\n\n${trimmed}` : trimmed;
    const optimisticId = `local-${Date.now()}`;
    setReplyTo(null);
    // Show the message immediately; the bot's reply arrives asynchronously.
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: [
                ...session.messages,
                {
                  id: optimisticId,
                  role: "user" as const,
                  content: payload,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : session,
      ),
    );
    setText("");
    setMentionQuery(null);
    setHistoryIndex(null);
    setSending(true);
    setError(null);
    try {
      const activeKind = sessions.find((entry) => entry.id === sessionId)?.kind;
      const result =
        activeKind === "dm" || activeKind === "group"
          ? await client.sendDm(sessionId, payload)
          : await client.sendMessage(sessionId, payload, useComputer);
      const session = result.session;
      const warning = (result as { warning?: string }).warning;
      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
      setLimitWarning(warning ?? null);
    } catch (err: unknown) {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? { ...session, messages: session.messages.filter((message) => message.id !== optimisticId) }
            : session,
        ),
      );
      setError(messageOf(err));
    } finally {
      setSending(false);
    }
  }

  async function send() {
    await sendMessage(text);
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
    setMentionIndex(0);
  }

  function insertMention(name: string) {
    setText((prev) => prev.replace(/@[\w -]*$/, () => `@${name} `));
    setMentionQuery(null);
  }

  function toggleReaction(id: string, emoji: string) {
    const next = { ...reactions };
    if (next[id] === emoji) delete next[id];
    else next[id] = emoji;
    setReactions(next);
    localStorage.setItem("botifyr.reactions", JSON.stringify(next));
    setReactFor(null);
  }

  function startReply(id: string, author: string, content: string) {
    setReplyTo({ id, author, content });
  }

  function actionsFor(message: ChatMessage, author: string, showRetry = false) {
    return (
      <div className="msg-actions">
        <button
          className="msg-action"
          type="button"
          title="Add emoji"
          aria-label="Add emoji"
          onClick={() => setReactFor((value) => (value === message.id ? null : message.id))}
        >
          <SmileyIcon size={15} />
        </button>
        <button
          className="msg-action"
          type="button"
          title="Reply"
          aria-label="Reply"
          onClick={() => startReply(message.id, author, message.content)}
        >
          <ReplyIcon size={15} />
        </button>
        <button
          className="msg-action"
          type="button"
          title="More"
          aria-label="More actions"
          onClick={() => setMoreFor((value) => (value === message.id ? null : message.id))}
        >
          <MoreIcon size={15} />
        </button>
        {moreFor === message.id && (
          <div className="msg-more">
            <button
              type="button"
              onClick={() => {
                setForwardMessage({ content: message.content });
                setMoreFor(null);
              }}
            >
              <ForwardIcon size={14} /> Forward
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(message.content);
                setMoreFor(null);
              }}
            >
              <CopyIcon size={14} /> Copy
            </button>
            {showRetry && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void retry();
                  setMoreFor(null);
                }}
              >
                <RefreshIcon size={14} /> Regenerate
              </button>
            )}
          </div>
        )}
        {reactFor === message.id && (
          <span className="react-picker">
            {["👍", "❤️", "😂", "🎉", "👀", "✅"].map((emoji) => (
              <button
                key={emoji}
                className="react-emoji"
                type="button"
                onClick={() => toggleReaction(message.id, emoji)}
              >
                {emoji}
              </button>
            ))}
          </span>
        )}
      </div>
    );
  }

  async function forwardTo(bot: Bot) {
    if (!forwardMessage) return;
    try {
      await client.sendMessage(bot.sessionId, `Forwarded message:\n${forwardMessage.content}`, useComputer);
      setForwardMessage(null);
      setActiveBotId(bot.id);
      setActiveSessionId(bot.sessionId);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  function toggleMic() {
    type SpeechCtor = new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void;
      onerror: () => void;
      start: () => void;
      stop: () => void;
    };
    const globalWindow = window as unknown as {
      SpeechRecognition?: SpeechCtor;
      webkitSpeechRecognition?: SpeechCtor;
    };
    const Recognition = globalWindow.SpeechRecognition ?? globalWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Speech input isn't available in this build.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ");
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
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

  /** Allow now and remember: turn on "Always allow" so it won't ask again. */
  async function allowAlways(task?: Task): Promise<void> {
    const target = task ?? liveTask;
    try {
      if (activeBot) {
        const targets =
          activeBot.memberIds && activeBot.memberIds.length > 0
            ? bots.filter((bot) => activeBot.memberIds?.includes(bot.id))
            : [activeBot];
        const updatedList = await Promise.all(
          targets.map((bot) => client.updateBot(bot.id, { autoApprove: true })),
        );
        setBots((prev) => prev.map((bot) => updatedList.find((u) => u.id === bot.id) ?? bot));
      }
      if (target?.approval) {
        await client.resolveApproval(target.id, target.approval.id, "allow");
      }
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Approve every pending approval at once. */
  async function approveAll(): Promise<void> {
    const pending = Object.values(tasks).filter((task) => task.approval?.status === "pending");
    for (const task of pending) {
      if (task.approval) await client.resolveApproval(task.id, task.approval.id, "allow").catch(() => {});
    }
  }

  /**
   * Resolve one approval. If the server has already moved past this task (e.g.
   * another device answered), clear the local prompt so it can't be a dead
   * button, and surface the reason.
   */
  async function resolveApprovalFor(
    taskId: string,
    approvalId: string,
    decision: "allow" | "deny",
    title = "Action",
  ): Promise<void> {
    // Show the decision on the card for a moment before it clears.
    setApprovalNotice({ title, decision });
    window.setTimeout(() => setApprovalNotice(null), 1800);
    try {
      await client.resolveApproval(taskId, approvalId, decision);
    } catch (err: unknown) {
      setTasks((prev) => {
        const task = prev[taskId];
        if (!task?.approval || task.approval.id !== approvalId) return prev;
        const next = { ...task };
        delete next.approval;
        return { ...prev, [taskId]: next };
      });
      setError(messageOf(err));
    }
  }

  /** Set the execution mode and remember it on the account (every bot) so all hosts agree. */
  async function applyExecutionMode(value: "ask" | "always_allow"): Promise<void> {
    setExecutionMode(value);
    localStorage.setItem("botifyr.execution", value);
    try {
      const autoApprove = value === "always_allow";
      const updated = await Promise.all(bots.map((bot) => client.updateBot(bot.id, { autoApprove })));
      setBots((prev) => prev.map((bot) => updated.find((entry) => entry.id === bot.id) ?? bot));
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

  async function saveDownloadCookies() {
    if (!ytCookies.trim()) {
      setError("Paste your cookies.txt contents first.");
      return;
    }
    try {
      // One cookies file covers every site (YouTube, Vimeo, short-drama sites…).
      for (const name of ["DOWNLOAD_COOKIES", "YOUTUBE_COOKIES"]) {
        const existing = secrets.find((secret) => secret.name === name);
        if (existing) await client.deleteSecret(existing.id);
      }
      await client.createSecret("DOWNLOAD_COOKIES", ytCookies);
      setSecrets(await client.listSecrets());
      setYtCookies("");
      setCheckNote("Download cookies saved.");
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function removeDownloadCookies() {
    try {
      for (const name of ["DOWNLOAD_COOKIES", "YOUTUBE_COOKIES"]) {
        const existing = secrets.find((secret) => secret.name === name);
        if (existing) await client.deleteSecret(existing.id);
      }
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
      await bridge.startLocalNode?.(token);
    } catch {
      // Not running inside the desktop app (e.g. browser preview).
    }
  }

  async function stopLocalNode() {
    try {
      await bridge.stopLocalNode?.();
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
  const findTerm = findQuery.trim().toLowerCase();
  const visibleMessages = activeSession
    ? findTerm
      ? activeSession.messages.filter((message) => message.content.toLowerCase().includes(findTerm))
      : activeSession.messages
    : [];
  const findMatches = findTerm ? visibleMessages.length : 0;
  const sessionTasks = Object.values(tasks).filter((t) => t.sessionId === activeSessionId);
  const liveTask =
    sessionTasks
      .filter((t) => t.status === "running" || t.status === "awaiting_approval" || t.status === "queued")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const latestTask = sessionTasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  // Every pending approval across tasks, oldest first — shown one at a time.
  const pendingApprovals = Object.values(tasks)
    .filter((task) => task.approval?.status === "pending")
    .sort((a, b) => (a.approval?.createdAt ?? "").localeCompare(b.approval?.createdAt ?? ""));
  const busy = Boolean(liveTask);

  /** Unread messages in a conversation (incoming, since it was last opened). */
  const unreadCount = (sessionId: string): number => {
    if (sessionId === activeSessionId) return 0;
    const session = sessions.find((entry) => entry.id === sessionId);
    if (!session) return 0;
    const since = readAt[sessionId];
    return session.messages.filter((message) => {
      if (since && message.createdAt <= since) return false;
      if (session.kind === "dm" || session.kind === "group") {
        return Boolean(message.senderId && message.senderId !== user?.id);
      }
      return message.role === "assistant";
    }).length;
  };
  const downloadUrl = (name: string, download = false): string =>
    `${CLOUD_URL}/v1/tasks/${latestTask?.id}/downloads/${encodeURIComponent(name)}?token=${encodeURIComponent(
      token(),
    )}${download ? "&download=1" : ""}`;
  const downloadStep = liveTask?.steps.find((step) => step.title === "Downloads");
  const downloadTotal = downloadStep ? downloadProgress(downloadStep.detail) : null;
  const downloadActive = Boolean(
    liveTask?.steps.some((step) => step.title === "youtube.download" || step.title === "Downloads"),
  );
  // Media downloaded by tasks in the current chat (for the bot Library).
  const sessionTaskIds = new Set(
    Object.values(tasks)
      .filter((task) => task.sessionId === activeSessionId)
      .map((task) => task.id),
  );
  const botMedia = media.filter((item) => sessionTaskIds.has(item.taskId));
  const libraryMedia =
    libraryCategory === "all"
      ? botMedia
      : botMedia.filter((item) => mediaKind(item.name) === libraryCategory);
  const downloadsMedia =
    downloadsCategory === "all" ? media : media.filter((item) => mediaKind(item.name) === downloadsCategory);

  // Billing banner: payment due, renewal soon, free tokens spent, low credits.
  const billingNotice = (() => {
    const b = billing;
    if (!b) return null;
    if (user?.role === "admin") return null;
    if (b.subStatus === "grace") return "Payment due — pay now to avoid dropping to the free plan.";
    if (b.periodEnd) {
      const days = Math.ceil((Date.parse(b.periodEnd) - Date.now()) / 86_400_000);
      if (days >= 0 && days <= 7) {
        return `Your ${b.plan} plan renews in ${days} day${days === 1 ? "" : "s"}.`;
      }
    }
    if (b.plan === "free" && b.tokensThisMonth >= b.freeMonthlyTokens) {
      return "You've used this month's free tokens — upgrade or top up credits to continue.";
    }
    if (b.walletCents > 0 && b.walletCents < b.lowBalanceCents) return "Your credits are running low.";
    return null;
  })();

  const mediaUrl = (item: MediaItem, download = false): string =>
    `${CLOUD_URL}/v1/tasks/${item.taskId}/downloads/${encodeURIComponent(item.name)}?token=${encodeURIComponent(
      token(),
    )}${download ? "&download=1" : ""}`;

  /** Permanently delete a downloaded file from the server. */
  async function deleteDownload(item: MediaItem): Promise<void> {
    try {
      await client.deleteMedia(item.id, true);
      setMedia((prev) => prev.filter((entry) => entry.id !== item.id));
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function moveToThisComputer(item: MediaItem): Promise<void> {
    // Download a copy to this machine, then record where it lives.
    void openExternal(mediaUrl(item, true));
    try {
      await client.markMediaOnDevice(item.id, computerName);
      setMedia(await client.listMedia());
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function removeFromServer(item: MediaItem): Promise<void> {
    try {
      await client.deleteMedia(item.id, true);
      setMedia(await client.listMedia());
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** P2P-send a media file to another of the user's online devices. */
  async function sendToDevice(item: MediaItem): Promise<void> {
    setError(null);
    try {
      const list = await client.listDevices();
      setDevices(list);
      const target = list.find((device) => device.id !== myDeviceId);
      if (!target) {
        setError("No other device is online — open Botifyr on another device first.");
        return;
      }
      const response = await fetch(mediaUrl(item));
      const blob = await response.blob();
      await p2p.sendFile(target.id, item.name, blob);
      setCheckNote(`Sending ${prettyFileName(item.name)} to ${target.name}…`);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function searchPeopleNow(query: string): Promise<void> {
    setPeopleQuery(query);
    if (query.trim().length < 1) {
      setPeopleResults([]);
      return;
    }
    try {
      setPeopleResults(await client.searchPeople(query.trim()));
    } catch {
      setPeopleResults([]);
    }
  }

  async function addFriend(person: Person): Promise<void> {
    try {
      await client.addFriend(person.id);
      await loadPeople();
      if (peopleQuery.trim()) setPeopleResults(await client.searchPeople(peopleQuery.trim()));
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function respondRequest(id: string, action: "accept" | "decline"): Promise<void> {
    try {
      await client.respondFriendRequest(id, action);
      await loadPeople();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function openDmWith(person: Person): Promise<void> {
    try {
      const session = await client.openDm(person.id);
      setSessions((prev) => (prev.some((entry) => entry.id === session.id) ? prev : [session, ...prev]));
      setActiveBotId(null);
      setActiveSessionId(session.id);
      setShowPeople(false);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Share a downloaded file with a friend via a signed, recipient-scoped link. */
  async function shareWith(person: Person): Promise<void> {
    const item = shareItem;
    setShareItem(null);
    if (!item) return;
    try {
      const { token: shareToken } = await client.shareMedia(item.id, person.id);
      const session = await client.openDm(person.id);
      await client.sendDm(session.id, `📎 ${prettyFileName(item.name)}\n/shared/${shareToken}`);
      setSessions((prev) => (prev.some((entry) => entry.id === session.id) ? prev : [session, ...prev]));
      setActiveBotId(null);
      setActiveSessionId(session.id);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function saveProfile(): Promise<void> {
    try {
      const updated = await client.updateProfile({
        displayName: profileName.trim(),
        handle: profileHandle.trim().replace(/^@/, ""),
        avatarEmoji: profileEmoji.trim() || "🙂",
      });
      setUser(updated);
      setCheckNote("Profile saved.");
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function createFriendGroup(): Promise<void> {
    if (groupSelection.length < 2) {
      setError("Pick at least two friends for a group.");
      return;
    }
    try {
      const session = await client.createFriendGroup(groupSelection, groupName.trim() || "New group");
      setSessions((prev) => [session, ...prev.filter((entry) => entry.id !== session.id)]);
      setGroupSelection([]);
      setGroupName("");
      setActiveBotId(null);
      setActiveSessionId(session.id);
      setShowPeople(false);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }
  const activeBot = bots.find((bot) => bot.id === activeBotId) ?? null;
  const activeScheme = BOT_SCHEMES[(activeBot?.scheme ?? 0) % BOT_SCHEMES.length];
  // A group is a container of bots, not a bot itself — keep them separate.
  const standaloneBots = bots.filter((bot) => !(bot.memberIds && bot.memberIds.length > 0));
  const groupBots = bots.filter((bot) => bot.memberIds && bot.memberIds.length > 0);
  const activeBotName = activeBot?.name ?? "Botifyr";
  const botLabel = activeBotId ? (labels[activeBotId] ?? "") : "";
  const groupMemberBots: Bot[] = activeBot?.memberIds
    ? activeBot.memberIds
        .map((id) => bots.find((bot) => bot.id === id))
        .filter((bot): bot is Bot => Boolean(bot))
    : [];
  const mentionMatches =
    mentionQuery !== null
      ? groupMemberBots
          .filter((bot) => bot.name.toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 6)
      : [];
  const inGroup = Boolean(activeBot?.memberIds && activeBot.memberIds.length > 0);
  const streamBot = stream?.botId ? (bots.find((bot) => bot.id === stream.botId) ?? null) : null;
  const streamScheme = BOT_SCHEMES[(streamBot?.scheme ?? activeBot?.scheme ?? 0) % BOT_SCHEMES.length];
  const streamActive = Boolean(stream && stream.sessionId === activeSessionId);
  // Sidebar lists bots, most recently active first.
  const lastActivity = (bot: Bot): string => {
    const session = sessions.find((entry) => entry.id === bot.sessionId);
    const last = session?.messages[session.messages.length - 1];
    return last?.createdAt ?? bot.createdAt;
  };
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const orderedBots = [...bots].sort((a, b) => {
    const ia = orderIndex.get(a.id);
    const ib = orderIndex.get(b.id);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return lastActivity(b).localeCompare(lastActivity(a));
  });
  const filteredBots = query.trim()
    ? orderedBots.filter((bot) => bot.name.toLowerCase().includes(query.trim().toLowerCase()))
    : orderedBots;
  // Companies: a bot belongs to a workspace through its role (authoritative) or,
  // for legacy rows, its `workspace` label. Grouping is keyed by workspace *id*,
  // so two companies that happen to share a name still render as separate
  // sections. See docs/company-workspace.md.
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const workspaceByName = new Map<string, WorkspaceWithRoles>();
  for (const workspace of workspaces) {
    if (!workspaceByName.has(workspace.name)) workspaceByName.set(workspace.name, workspace);
  }
  const roleByBotId = new Map<string, BotRole>();
  const workspaceIdByBotId = new Map<string, string>();
  for (const workspace of workspaces) {
    for (const role of workspace.roles) {
      roleByBotId.set(role.botId, role);
      workspaceIdByBotId.set(role.botId, workspace.id);
    }
  }
  /** The company a bot belongs to: its role's workspace, else its label. */
  function companyOf(bot: Bot): { id: string; name: string; workspace?: WorkspaceWithRoles } {
    const byRole = workspaceIdByBotId.get(bot.id);
    const workspace =
      (byRole ? workspaceById.get(byRole) : undefined) ??
      (bot.workspace ? workspaceByName.get(bot.workspace) : undefined);
    if (workspace) return { id: workspace.id, name: workspace.name, workspace };
    if (bot.workspace) return { id: `label:${bot.workspace}`, name: bot.workspace };
    return { id: "personal", name: "Personal" };
  }
  const companies = [...workspaceById.values()];
  // Names for the "Company" datalist in the bot editor (companies + legacy labels).
  const workspaceNames = [
    ...new Set([
      ...workspaces.map((workspace) => workspace.name),
      ...bots.map((bot) => bot.workspace).filter((name): name is string => Boolean(name)),
    ]),
  ];
  // Guard against a stale filter (e.g. after the last bot leaves a company).
  const activeWorkspaceFilter =
    workspaceFilter === "all" ||
    workspaceFilter === "personal" ||
    workspaceById.has(workspaceFilter)
      ? workspaceFilter
      : "all";
  const workspaceFiltered =
    activeWorkspaceFilter === "all"
      ? filteredBots
      : activeWorkspaceFilter === "personal"
        ? filteredBots.filter((bot) => companyOf(bot).id === "personal")
        : filteredBots.filter((bot) => companyOf(bot).id === activeWorkspaceFilter);
  const companyGroups = new Map<
    string,
    { name: string; workspace?: WorkspaceWithRoles; members: Bot[] }
  >();
  const ungroupedBots: Bot[] = [];
  for (const bot of workspaceFiltered) {
    const company = companyOf(bot);
    if (company.id === "personal") {
      ungroupedBots.push(bot);
      continue;
    }
    const group =
      companyGroups.get(company.id) ??
      ({ name: company.name, workspace: company.workspace, members: [] } satisfies {
        name: string;
        workspace?: WorkspaceWithRoles;
        members: Bot[];
      });
    group.members.push(bot);
    companyGroups.set(company.id, group);
  }
  // Messages you've sent in this chat, for ↑/↓ recall in the composer.
  const sentHistory = (sessions.find((entry) => entry.id === activeSessionId)?.messages ?? [])
    .filter((message) => message.role === "user")
    .map((message) => message.content);
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
    billing && billing.freeMonthlyTokens > 0
      ? Math.min(100, Math.round((billing.tokensThisMonth / billing.freeMonthlyTokens) * 100))
      : 0;
  const marketMatches = marketQuery.trim()
    ? MARKETPLACE.filter((app) =>
        `${app.name} ${app.category} ${app.desc}`.toLowerCase().includes(marketQuery.trim().toLowerCase()),
      )
    : [];

  // Fetch any files a finished task produced (e.g. a YouTube download).
  useEffect(() => {
    const task = latestTask;
    if (!task) {
      setDownloads([]);
      return;
    }
    let active = true;
    const load = () =>
      client
        .listDownloads(task.id)
        .then((files) => {
          if (active) setDownloads(files);
        })
        .catch(() => {
          if (active) setDownloads([]);
        });
    void load();
    // Keep polling while the task runs so finished files appear live.
    const running = task.status === "running" || task.status === "awaiting_approval";
    const timer = running ? window.setInterval(load, 5000) : undefined;
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestTask?.id, latestTask?.status, client]);

  // Load the media manifest whenever the Media settings tab is open.
  useEffect(() => {
    if (!showSettings || settingsTab !== "media") return;
    let active = true;
    client
      .listMedia()
      .then((items) => {
        if (active) setMedia(items);
      })
      .catch(() => {});
    client
      .listDevices()
      .then((list) => {
        if (active) setDevices(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [showSettings, settingsTab, client]);

  const loadPeople = useCallback(async (): Promise<void> => {
    try {
      const [friendList, requests, convos] = await Promise.all([
        client.listFriends(),
        client.listFriendRequests(),
        client.listConversations(),
      ]);
      setFriends(friendList);
      setFriendRequests(requests);
      const human: Conversation[] = convos;
      setSessions((prev) => {
        const byId = new Map(prev.map((session) => [session.id, session]));
        for (const convo of human) {
          if (!byId.has(convo.id)) {
            byId.set(convo.id, {
              id: convo.id,
              userId: user?.id ?? "",
              title: convo.title,
              messages: [],
              createdAt: convo.createdAt,
              kind: convo.kind,
              participants: convo.participants,
            });
          }
        }
        return [...byId.values()];
      });
    } catch {
      // best-effort
    }
  }, [client, user?.id]);

  useEffect(() => {
    if (!user) return;
    void loadPeople();
  }, [user, loadPeople]);

  // Keep the media manifest handy (bot Library + Media tab).
  useEffect(() => {
    if (!user) return;
    void client
      .listMedia()
      .then(setMedia)
      .catch(() => {});
  }, [user, client]);

  // Opening a conversation marks it read (so the unread badge clears).
  useEffect(() => {
    if (!activeSessionId) return;
    setReadAt((prev) => {
      const next = { ...prev, [activeSessionId]: new Date().toISOString() };
      localStorage.setItem("botifyr.readAt", JSON.stringify(next));
      return next;
    });
  }, [activeSessionId]);

  // Raise a toast for incoming messages in a conversation you're not viewing.
  // A session's existing history is seeded silently on first sight, so only
  // genuinely new messages notify.
  useEffect(() => {
    const seen = seenMessagesRef.current;
    const seeded = seededSessionsRef.current;
    for (const session of sessions) {
      const firstSight = !seeded.has(session.id);
      seeded.add(session.id);
      const isActive = session.id === activeSessionId;
      const bot = bots.find((entry) => entry.sessionId === session.id);
      for (const message of session.messages) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        if (firstSight || isActive || !user) continue;
        const incoming =
          session.kind === "dm" || session.kind === "group"
            ? Boolean(message.senderId && message.senderId !== user.id)
            : message.role === "assistant";
        const body = message.content.replace(/\s+/g, " ").trim();
        if (!incoming || !body) continue;
        // Never replay history on startup: only notify for messages that
        // arrived after this session of the app began.
        const created = message.createdAt ? Date.parse(message.createdAt) : 0;
        if (created && created < bootAtRef.current - 5_000) continue;
        pushToast({
          kind: "message",
          title: bot?.name ?? (session.kind === "dm" ? "New message" : session.title || "New message"),
          body: body.slice(0, 120),
          sessionId: session.id,
        });
      }
    }
    try {
      localStorage.setItem(SEEN_MESSAGES_KEY, JSON.stringify(Array.from(seen).slice(-800)));
    } catch {
      // ignore quota errors
    }
  }, [sessions, activeSessionId, user, bots, pushToast]);

  // Raise a toast when a task finishes or fails while you're elsewhere.
  useEffect(() => {
    for (const task of Object.values(tasks)) {
      const previous = taskStatusRef.current[task.id];
      taskStatusRef.current[task.id] = task.status;
      if (previous === undefined || previous === task.status) continue;
      if (task.status !== "completed" && task.status !== "failed") continue;
      if (task.sessionId === activeSessionId) continue;
      const session = sessions.find((entry) => entry.id === task.sessionId);
      const bot = bots.find((entry) => entry.id === session?.botId);
      const name = bot?.name ?? session?.title ?? "Task";
      pushToast({
        kind: "task",
        title: task.status === "completed" ? `${name} finished` : `${name} got stuck`,
        body: task.goal.replace(/\s+/g, " ").slice(0, 120),
        sessionId: task.sessionId,
      });
    }
  }, [tasks, sessions, bots, activeSessionId, pushToast]);

  // Seed the profile editor from the signed-in user.
  useEffect(() => {
    if (!user) return;
    setProfileName(user.displayName ?? "");
    setProfileHandle(user.handle ?? "");
    setProfileEmoji(user.avatarEmoji ?? "🙂");
  }, [user]);

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

  /** One bot row in the sidebar (also used under a company header). */
  /** Reorder the sidebar list (local only — never changes a bot's company). */
  function moveBot(dragId: string, targetId: string) {
    if (dragId === targetId) return;
    const ids = orderedBots.map((bot) => bot.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    setOrder(ids);
    localStorage.setItem("botifyr.order", JSON.stringify(ids));
  }

  const renderBotRow = (bot: Bot) => {
    const session = sessions.find((entry) => entry.id === bot.sessionId);
    const last = session?.messages[session.messages.length - 1];
    return (
      <div
        key={bot.id}
        className={`conv-item ${bot.id === activeBotId ? "active" : ""}${
          bot.id === draggingId ? " dragging" : ""
        }${bot.id === dragOverId && bot.id !== draggingId ? " drag-over" : ""}`}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", bot.id);
          event.dataTransfer.effectAllowed = "move";
          setDraggingId(bot.id);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDragOverId(null);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (bot.id !== draggingId) setDragOverId(bot.id);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const id = event.dataTransfer.getData("text/plain");
          if (id) moveBot(id, bot.id);
          setDraggingId(null);
          setDragOverId(null);
        }}
      >
        <button className="conv-select" type="button" onClick={() => selectBot(bot)}>
          <span className={`conv-avatar${roleByBotId.get(bot.id)?.isChair ? " chair" : ""}`}>
            <BotLogo size={34} scheme={BOT_SCHEMES[bot.scheme % BOT_SCHEMES.length]} />
          </span>
          <span className="conv-text">
            <span className="conv-name">{bot.name}</span>
            {roleByBotId.get(bot.id) && <span className="conv-role">{roleByBotId.get(bot.id)?.title}</span>}
            <span className="conv-preview">
              {last?.content?.slice(0, 42) || "No messages yet — say hello"}
            </span>
          </span>
        </button>
        <span className="conv-aside">
          {unreadCount(bot.sessionId) > 0 && (
            <span className="unread-badge">{unreadCount(bot.sessionId)}</span>
          )}
          {confirmDeleteId === bot.id ? (
            <button
              className="conv-delete confirm"
              type="button"
              title="Tap to confirm delete"
              onClick={() => void removeBot(bot)}
            >
              Delete
            </button>
          ) : (
            <button
              className="conv-delete"
              type="button"
              title="Delete bot and chat"
              aria-label="Delete bot and chat"
              onClick={() => {
                setConfirmDeleteId(bot.id);
                window.setTimeout(() => setConfirmDeleteId((cur) => (cur === bot.id ? null : cur)), 3000);
              }}
            >
              <CloseIcon size={13} />
            </button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div
      className={`app${showBotPanel && activeBot ? " with-panel" : ""}${density === "compact" ? " density-compact" : ""}`}
    >
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.kind}`}>
              <button
                className="toast-main"
                type="button"
                onClick={() => {
                  if (toast.sessionId) openSessionById(toast.sessionId);
                  dismissToast(toast.id);
                }}
              >
                <span className="toast-title">{toast.title}</span>
                {toast.body && <span className="toast-body">{toast.body}</span>}
              </button>
              <button
                className="toast-close"
                type="button"
                aria-label="Dismiss"
                onClick={() => dismissToast(toast.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
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

        {companies.length > 0 && (
          <div className="ws-tabs" role="tablist" aria-label="Filter by workspace">
            <button
              className={`ws-tab${activeWorkspaceFilter === "all" ? " active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeWorkspaceFilter === "all"}
              onClick={() => setWorkspaceFilter("all")}
            >
              All
            </button>
            <button
              className={`ws-tab${activeWorkspaceFilter === "personal" ? " active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeWorkspaceFilter === "personal"}
              onClick={() => setWorkspaceFilter("personal")}
            >
              Personal
            </button>
            {companies.map((company) => (
              <button
                key={company.id}
                className={`ws-tab${activeWorkspaceFilter === company.id ? " active" : ""}`}
                type="button"
                role="tab"
                aria-selected={activeWorkspaceFilter === company.id}
                onClick={() => setWorkspaceFilter(company.id)}
                title={company.name}
              >
                {company.name}
              </button>
            ))}
          </div>
        )}

        <div className="task-list">
          {workspaceFiltered.length === 0 && (
            <p className="empty">
              {activeWorkspaceFilter === "all"
                ? "No bots yet. Tap ＋ to create one."
                : "No bots in this workspace."}
            </p>
          )}
          {[...companyGroups.entries()].map(([id, group]) => {
            const collapsed = collapsedWorkspaces[id] === true;
            const pending = group.workspace?.pending ?? 0;
            return (
              <div key={id} className="task-section">
                <button
                  className={`task-section-head${collapsed ? " collapsed" : ""}`}
                  type="button"
                  onClick={() => setCollapsedWorkspaces((prev) => ({ ...prev, [id]: !prev[id] }))}
                  aria-expanded={!collapsed}
                >
                  <span className="task-caret">{collapsed ? "▸" : "▾"}</span>
                  {group.workspace?.avatarEmoji && (
                    <span className="task-section-emoji">{group.workspace.avatarEmoji}</span>
                  )}
                  <span className="task-section-name">{group.name}</span>
                </button>
                <div className="task-section-sub">
                  <span className={`task-section-count${pending > 0 ? " has-needs" : ""}`}>
                    {group.members.length} employee{group.members.length === 1 ? "" : "s"}
                    {pending > 0 ? ` · ${pending} need you` : ""}
                  </span>
                  {group.workspace && (
                    <button
                      className="task-section-edit"
                      type="button"
                      title="Rename or delete company"
                      aria-label="Rename or delete company"
                      onClick={() => {
                        setConfirmCompanyDelete(false);
                        setCompanyEdit({ id: group.workspace!.id, name: group.name });
                      }}
                    >
                      <GearIcon size={14} />
                    </button>
                  )}
                  {group.workspace && (
                    <button
                      className="task-section-edit"
                      type="button"
                      title="Company board"
                      aria-label="Company board"
                      onClick={() => void openBoard(group.workspace!.id, group.name)}
                    >
                      <ChartIcon size={14} />
                    </button>
                  )}
                </div>
                {!collapsed && (
                  <div className="task-section-list">{group.members.map(renderBotRow)}</div>
                )}
              </div>
            );
          })}
          {companyGroups.size > 0 && ungroupedBots.length > 0 && (
            <div className="task-section-head static" aria-hidden="true">
              <span className="task-section-name">Personal</span>
              <span className="task-section-count">{ungroupedBots.length}</span>
            </div>
          )}
          {ungroupedBots.map(renderBotRow)}
        </div>

        <footer className="sidebar-footer">
          <button
            className="sidebar-account"
            type="button"
            title={`${user.email} · ${connection === "online" ? "Connected" : connection === "connecting" ? "Connecting…" : "Offline"}`}
            onClick={() => setShowAccountMenu((value) => !value)}
          >
            <span className="user-avatar">{initials(user.email)}</span>
            <span className="sidebar-account-email">{user.email}</span>
          </button>
          <button
            className="connect-apps"
            type="button"
            onClick={() => {
              setShowPeople(true);
              void loadPeople();
            }}
          >
            <span className="connect-apps-label">
              <UsersIcon size={16} />
              People
            </span>
            {friendRequests.filter((r) => r.direction === "incoming").length > 0 && (
              <span className="settings-badge">
                {friendRequests.filter((r) => r.direction === "incoming").length} new
              </span>
            )}
          </button>
          <button className="connect-apps" type="button" onClick={() => setShowConnectApps(true)}>
            <span className="connect-apps-label">
              <PanelIcon size={16} />
              Connect apps
            </span>
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
              onClick={() =>
                setDensity((prev) => {
                  const next = prev === "compact" ? "cozy" : "compact";
                  localStorage.setItem("botifyr.density", next);
                  return next;
                })
              }
            >
              <span className="account-ico">
                <PanelIcon size={16} />
              </span>
              <span className="account-label">Compact view</span>
              <span className="account-value">{density === "compact" ? "On" : "Off"}</span>
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
            {user.role === "admin" && (
              <button
                className="account-item"
                type="button"
                onClick={() => {
                  const current = token();
                  if (current) void navigator.clipboard?.writeText(current);
                  void openExternal(`${ADMIN_URL}#token=${encodeURIComponent(current)}`);
                  setShowAccountMenu(false);
                }}
              >
                <span className="account-ico">
                  <GearIcon size={16} />
                </span>
                <span className="account-label">Admin</span>
              </button>
            )}
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

              <button className="newchat-item" type="button" onClick={openCompanySetup}>
                <span className="newchat-ico">
                  <BotLogo size={16} />
                </span>
                Start a company
              </button>

              {bots.length > 0 && <div className="newchat-sep" />}

              {standaloneBots.length > 0 && (
                <>
                  <div className="newchat-section">Bots</div>
                  {standaloneBots.map((bot) => (
                    <button
                      key={bot.id}
                      className={`newchat-item ${bot.id === activeBotId ? "active" : ""}`}
                      type="button"
                      onClick={() => selectBot(bot)}
                    >
                      <span className="conv-avatar">
                        <BotLogo size={26} scheme={BOT_SCHEMES[bot.scheme % BOT_SCHEMES.length]} />
                      </span>
                      <span className="newchat-name">
                        <span className="newchat-emoji">{cleanEmoji(bot.emoji, false)}</span>
                        {bot.name}
                      </span>
                    </button>
                  ))}
                </>
              )}

              {groupBots.length > 0 && (
                <>
                  <div className="newchat-section">Groups</div>
                  {groupBots.map((bot) => (
                    <button
                      key={bot.id}
                      className={`newchat-item ${bot.id === activeBotId ? "active" : ""}`}
                      type="button"
                      onClick={() => selectBot(bot)}
                    >
                      <span className="conv-avatar">
                        <BotLogo size={26} scheme={BOT_SCHEMES[bot.scheme % BOT_SCHEMES.length]} />
                      </span>
                      <span className="newchat-name">
                        <span className="newchat-emoji">{cleanEmoji(bot.emoji, true)}</span>
                        {bot.name}
                      </span>
                      <span className="newchat-meta">{bot.memberIds?.length ?? 0} bots</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {!showNewChat && (
          <header className="topbar">
            {findOpen ? (
              <div className="thread-search">
                <SearchIcon size={15} />
                <input
                  placeholder="Search this chat"
                  value={findQuery}
                  onChange={(event) => setFindQuery(event.target.value)}
                  autoFocus
                />
                {findQuery.trim() && <span className="thread-search-count">{findMatches}</span>}
                <button
                  className="icon-btn sm"
                  type="button"
                  aria-label="Close search"
                  onClick={() => {
                    setFindOpen(false);
                    setFindQuery("");
                  }}
                >
                  <CloseIcon size={13} />
                </button>
              </div>
            ) : (
              <span className="thread-pill">
                <BotLogo size={18} scheme={activeScheme} />
                {activeBot && (
                  <span className="newchat-emoji">
                    {cleanEmoji(activeBot.emoji, (activeBot.memberIds?.length ?? 0) > 0)}
                  </span>
                )}
                {liveTask && <span className={`status-dot status-${liveTask.status}`} />}
                <span className="thread-pill-name">{activeBotName}</span>
                {activeBot?.workspace && (
                  <span className="thread-workspace" title={`Company: ${activeBot.workspace}`}>
                    {activeBot.workspace}
                  </span>
                )}
              </span>
            )}
            <div className="topbar-right">
              <div className="notif-wrap">
                <button
                  className="bot-menu-btn"
                  type="button"
                  title="Notifications"
                  onClick={toggleNotifications}
                >
                  <BellIcon size={16} />
                  {notifications.some((entry) => !entry.read) && (
                    <span className="notif-dot">{notifications.filter((entry) => !entry.read).length}</span>
                  )}
                </button>
                {notifOpen && (
                  <div className="notif-panel">
                    <div className="notif-head">
                      <span>Notifications</span>
                      {notifications.length > 0 && (
                        <button className="link" type="button" onClick={clearNotifications}>
                          Clear
                        </button>
                      )}
                    </div>
                    {notifications.length === 0 ? (
                      <div className="notif-empty">Nothing yet.</div>
                    ) : (
                      <ul className="notif-list">
                        {notifications.map((entry) => (
                          <li key={entry.id}>
                            <button
                              className={`notif-item${entry.read ? "" : " unread"}`}
                              type="button"
                              onClick={() => {
                                if (entry.sessionId) openSessionById(entry.sessionId);
                                setNotifOpen(false);
                              }}
                            >
                              <span className="notif-title">{entry.title}</span>
                              <span className="notif-body">{entry.body}</span>
                              <span className="notif-time">
                                {new Date(entry.at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              {activeSession && (
                <button
                  className="bot-menu-btn"
                  type="button"
                  title={findOpen ? "Close search" : "Search this chat"}
                  onClick={() => {
                    setFindOpen((value) => !value);
                    setFindQuery("");
                  }}
                >
                  <SearchIcon size={16} />
                </button>
              )}
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

        {billingNotice && <div className="notice warn">{billingNotice}</div>}

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

              {findTerm && visibleMessages.length === 0 && (
                <div className="bot-panel-empty">No matches in this chat.</div>
              )}
              {visibleMessages.map((message) => {
                if (activeSession.kind === "dm" || activeSession.kind === "group") {
                  const mine = message.senderId === user.id;
                  const person = friends.find((entry) => entry.id === message.senderId);
                  const label = person?.displayName || (person?.handle ? `@${person.handle}` : "Friend");
                  if (mine) {
                    return (
                      <div key={message.id} className="msg-user">
                        <div className="msg-user-bubble">{message.content}</div>
                        <span className="msg-user-avatar">{initials(user.email)}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={message.id} className="msg-assistant">
                      <BotLogo
                        size={26}
                        scheme={BOT_SCHEMES[(person?.avatarScheme ?? 0) % BOT_SCHEMES.length]}
                        className="msg-bot-logo"
                      />
                      <div className="msg-body">
                        <div className="msg-author">
                          <span className="msg-author-emoji">{person?.avatarEmoji ?? "🙂"}</span>
                          {label}
                        </div>
                        <Markdown text={message.content} />
                        {sharedTokenOf(message.content) && (
                          <button
                            className="ghost small"
                            type="button"
                            onClick={() =>
                              void openExternal(
                                `${CLOUD_URL}/v1/shared?share=${encodeURIComponent(
                                  sharedTokenOf(message.content) as string,
                                )}&token=${encodeURIComponent(token() ?? "")}`,
                              )
                            }
                          >
                            Save file
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }
                if (message.role === "user") {
                  return (
                    <div key={message.id} className="msg-user">
                      {actionsFor(message, "You")}
                      <div className="msg-user-bubble">
                        {message.content}
                        {reactions[message.id] && <span className="reaction">{reactions[message.id]}</span>}
                      </div>
                      <span className="msg-user-avatar">{initials(user.email)}</span>
                    </div>
                  );
                }
                const msgBot =
                  (message.botId && bots.find((entry) => entry.id === message.botId)) || activeBot;
                const msgScheme = BOT_SCHEMES[(msgBot?.scheme ?? 0) % BOT_SCHEMES.length];
                const parsed = parseOptions(message.content);
                return (
                  <div key={message.id} className="msg-assistant">
                    <BotLogo size={26} scheme={msgScheme} className="msg-bot-logo" />
                    <div className="msg-body">
                      {msgBot && (
                        <div className="msg-author">
                          <span className="msg-author-emoji">{cleanEmoji(msgBot.emoji, false)}</span>
                          {msgBot.name}
                        </div>
                      )}
                      <Markdown text={parsed.body} />
                      {parsed.options.length > 0 && (
                        <div className="quick-replies">
                          {parsed.options.map((option, index) => (
                            <button
                              key={index}
                              className="quick-reply"
                              type="button"
                              disabled={busy}
                              onClick={() => void sendMessage(option)}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                      {reactions[message.id] && <span className="reaction">{reactions[message.id]}</span>}
                      {actionsFor(message, msgBot?.name ?? activeBotName, message.id === lastAssistantId)}
                    </div>
                  </div>
                );
              })}

              {streamActive && (
                <div className="msg-assistant">
                  <BotLogo size={26} scheme={streamScheme} className="msg-bot-logo" />
                  <div className="msg-body">
                    {streamBot && (
                      <div className="msg-author">
                        <span className="msg-author-emoji">{cleanEmoji(streamBot.emoji, false)}</span>
                        {streamBot.name}
                      </div>
                    )}
                    {stream && stream.text ? (
                      <span className="reveal">{stream.text.split("```options")[0]}</span>
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

              {groupWorking &&
                groupWorking.sessionId === activeSessionId &&
                groupWorking.names.length > 0 && (
                  <div className="thinking-row">
                    <span>
                      {groupWorking.names.join(", ")} {groupWorking.names.length > 1 ? "are" : "is"} replying
                    </span>
                    <span className="think-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                )}

              {thinking &&
                !streamActive &&
                !(
                  groupWorking &&
                  groupWorking.sessionId === activeSessionId &&
                  groupWorking.names.length > 0
                ) && (
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
                <div className={`activity ${activityCollapsed ? "collapsed" : ""}`}>
                  <div className="activity-head">
                    <span className="activity-title">
                      {liveTask.status === "awaiting_approval"
                        ? "Waiting for your approval"
                        : liveTask.status === "running"
                          ? "Working…"
                          : liveTask.status}
                    </span>
                    <button
                      className="icon-btn sm"
                      type="button"
                      onClick={() => setActivityCollapsed((value) => !value)}
                      title={activityCollapsed ? "Expand" : "Collapse"}
                      aria-label={activityCollapsed ? "Expand activity" : "Collapse activity"}
                    >
                      <ChevronIcon size={16} className={activityCollapsed ? "chev-collapsed" : ""} />
                    </button>
                  </div>
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
                    {liveTask.steps.map((step) => {
                      const progress = step.title === "Downloads" ? downloadProgress(step.detail) : null;
                      if (progress) {
                        const pct = Math.round((progress.done / progress.total) * 100);
                        return (
                          <li key={step.id} className="step step-download">
                            <div className="step-progress-wrap">
                              <div className="step-progress-head">
                                <span className="step-title">Downloading</span>
                                <span className="step-progress-count">
                                  {progress.done} / {progress.total}
                                </span>
                              </div>
                              <div className="step-progress-bar">
                                <span style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          </li>
                        );
                      }
                      const detail = stepDetail(step.title, step.detail);
                      return (
                        <li key={step.id} className={`step step-${step.status}`}>
                          <span className="step-icon">{iconFor(step.status)}</span>
                          <div>
                            <div className="step-title">{stepLabel(step.title)}</div>
                            {detail && <div className="step-detail">{detail}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              {(downloads.length > 0 || downloadActive || downloadStep) && (
                <div className="downloads">
                  <div className="downloads-head">
                    <span className="downloads-title">Downloads</span>
                    {downloadTotal && (
                      <span className="downloads-count">
                        {downloadTotal.done} / {downloadTotal.total}
                      </span>
                    )}
                    <span className="downloads-spacer" />
                    <button
                      className="icon-btn sm"
                      type="button"
                      onClick={() => setDownloadsExpanded((value) => !value)}
                      title={downloadsExpanded ? "Collapse list" : "Expand list"}
                      aria-label={downloadsExpanded ? "Collapse downloads" : "Expand downloads"}
                    >
                      <ChevronIcon size={15} className={downloadsExpanded ? "chev-up" : ""} />
                    </button>
                  </div>
                  {downloadStep && (
                    <div className="step-progress-bar downloads-bar">
                      <span
                        style={{
                          width: `${
                            downloadTotal ? Math.round((downloadTotal.done / downloadTotal.total) * 100) : 8
                          }%`,
                        }}
                      />
                    </div>
                  )}
                  {liveTask && (liveTask.status === "running" || liveTask.status === "awaiting_approval") && (
                    <div className="download-row download-active">
                      <span className="download-ico">↓</span>
                      <div className="download-main">
                        <div className="download-name">
                          Downloading
                          {downloadTotal ? ` ${downloadTotal.done} / ${downloadTotal.total}` : "…"}
                        </div>
                        <div className="download-bar indeterminate">
                          <span />
                        </div>
                      </div>
                    </div>
                  )}
                  <ul className={`downloads-list ${downloadsExpanded ? "expanded" : ""}`}>
                    {downloads.map((file, index) => (
                      <li key={file.name} className="download-row">
                        <span className="download-ico">{isPlayable(file.name) ? "▶" : "▢"}</span>
                        <div className="download-main">
                          <div className="download-name" title={file.name}>
                            {prettyFileName(file.name)}
                          </div>
                          <div className="download-bar">
                            <span />
                          </div>
                        </div>
                        <span className="download-size">
                          {Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB
                        </span>
                        {isPlayable(file.name) && (
                          <button
                            className="ghost small"
                            type="button"
                            onClick={() =>
                              openPlayer(
                                downloads.map((entry) => ({
                                  name: entry.name,
                                  url: downloadUrl(entry.name),
                                })),
                                index,
                              )
                            }
                          >
                            Play
                          </button>
                        )}
                        <button
                          className="ghost small"
                          type="button"
                          onClick={() => void openExternal(downloadUrl(file.name, true))}
                        >
                          Save
                        </button>
                      </li>
                    ))}
                  </ul>
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

        {(pendingApprovals.length > 0 || approvalNotice) && (
          <div className="approval-panel">
            <div className="approval-panel-head">
              <span
                className={`approval-tag${
                  approvalNotice ? (approvalNotice.decision === "allow" ? " ok" : " denied") : ""
                }`}
              >
                {approvalNotice
                  ? approvalNotice.decision === "allow"
                    ? "Approved ✓"
                    : "Denied"
                  : "Approval needed"}
                {!approvalNotice && pendingApprovals.length > 1
                  ? ` · ${pendingApprovals.length} pending`
                  : ""}
              </span>
              {!approvalNotice && pendingApprovals.length > 1 && (
                <button className="ghost small" type="button" onClick={() => void approveAll()}>
                  Approve all ({pendingApprovals.length})
                </button>
              )}
            </div>
            {pendingApprovals.length > 0
              ? (() => {
                  const task = pendingApprovals[0];
                  const approval = task.approval;
                  if (!approval) return null;
                  return (
                    <div className="approval-card">
                      <div className="approval-card-title">{approval.title}</div>
                      <div className="approval-card-desc">{approval.description}</div>
                      <div className="approval-card-actions">
                        <button
                          className="btn deny"
                          type="button"
                          onClick={() =>
                            void resolveApprovalFor(task.id, approval.id, "deny", approval.title)
                          }
                        >
                          Deny
                        </button>
                        <button
                          className="btn allow"
                          type="button"
                          onClick={() =>
                            void resolveApprovalFor(task.id, approval.id, "allow", approval.title)
                          }
                        >
                          Allow once
                        </button>
                        <button className="ghost small" type="button" onClick={() => void allowAlways(task)}>
                          Always allow
                        </button>
                      </div>
                    </div>
                  );
                })()
              : approvalNotice && (
                  <div
                    className={`approval-card approval-resolved ${
                      approvalNotice.decision === "allow" ? "is-allowed" : "is-denied"
                    }`}
                  >
                    <div className="approval-card-title">{approvalNotice.title}</div>
                  </div>
                )}
          </div>
        )}

        <form
          className="composer"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void send();
          }}
        >
          {" "}
          {mentionQuery !== null && mentionMatches.length > 0 && (
            <div className="mention-popup">
              {mentionMatches.map((bot, index) => (
                <button
                  key={bot.id}
                  type="button"
                  className={`mention-item${index === mentionIndex ? " active" : ""}`}
                  onMouseEnter={() => setMentionIndex(index)}
                  onClick={() => insertMention(bot.name)}
                >
                  <BotLogo size={18} scheme={BOT_SCHEMES[bot.scheme % BOT_SCHEMES.length]} />
                  {bot.name}
                </button>
              ))}
            </div>
          )}
          {replyTo && (
            <div className="reply-bar">
              <span className="reply-bar-text">
                ↩ {replyTo.author}: {replyTo.content.slice(0, 90)}
              </span>
              <button className="reply-bar-close" type="button" onClick={() => setReplyTo(null)}>
                ✕
              </button>
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
              onKeyDown={(event) => {
                if (mentionQuery !== null && mentionMatches.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setMentionIndex((index) => Math.min(mentionMatches.length - 1, index + 1));
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setMentionIndex((index) => Math.max(0, index - 1));
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    insertMention(mentionMatches[mentionIndex]?.name ?? mentionMatches[0].name);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMentionQuery(null);
                    return;
                  }
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                  return;
                }
                if (event.key === "ArrowUp" && (text === "" || historyIndex !== null)) {
                  if (sentHistory.length === 0) return;
                  event.preventDefault();
                  const next = historyIndex === null ? sentHistory.length - 1 : Math.max(0, historyIndex - 1);
                  setHistoryIndex(next);
                  setText(sentHistory[next]);
                  return;
                }
                if (event.key === "ArrowDown" && historyIndex !== null) {
                  event.preventDefault();
                  const next = historyIndex + 1;
                  if (next >= sentHistory.length) {
                    setHistoryIndex(null);
                    setText("");
                  } else {
                    setHistoryIndex(next);
                    setText(sentHistory[next]);
                  }
                }
              }}
            />
            <button
              className={`round mic${listening ? " on" : ""}`}
              type="button"
              title="Voice input"
              onClick={toggleMic}
            >
              <MicIcon size={16} />
            </button>
            {busy && liveTask ? (
              <button
                className="round stop"
                type="button"
                title="Stop"
                onClick={() =>
                  void client
                    .cancelSession(activeSessionId ?? "")
                    .catch((err: unknown) => setError(messageOf(err)))
                }
              >
                <StopIcon size={16} />
              </button>
            ) : (
              <button
                className="send round"
                type="submit"
                disabled={!text.trim() || !activeSessionId || sending}
              >
                <SendIcon size={16} />
              </button>
            )}
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
                <div className="library-cats">
                  {LIBRARY_CATS.map(([id, label]) => {
                    const count =
                      id === "all"
                        ? botMedia.length
                        : botMedia.filter((item) => mediaKind(item.name) === id).length;
                    return (
                      <button
                        key={id}
                        className={`library-cat ${libraryCategory === id ? "active" : ""}`}
                        type="button"
                        onClick={() => setLibraryCategory(id)}
                      >
                        {label}
                        <span className="library-cat-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
                {libraryMedia.length === 0 && (
                  <div className="bot-panel-empty">
                    {botMedia.length === 0
                      ? "Videos and audio this bot downloads show here."
                      : "Nothing in this category."}
                  </div>
                )}
                <ul className="downloads-list">
                  {libraryMedia.map((item, index) => (
                    <li key={item.id} className="download-row">
                      <span className="download-ico">{isPlayable(item.name) ? "▶" : "▢"}</span>
                      <div className="download-main">
                        <div className="download-name" title={item.name}>
                          {prettyFileName(item.name)}
                        </div>
                        <div className="download-size">
                          {Math.max(1, Math.round(item.size / 1024)).toLocaleString()} KB
                          {item.location === "device" ? " · on your computer" : " · on server"}
                        </div>
                      </div>
                      {isPlayable(item.name) && (
                        <button
                          className="ghost small"
                          type="button"
                          onClick={() =>
                            openPlayer(
                              libraryMedia.map((entry) => ({ name: entry.name, url: mediaUrl(entry) })),
                              index,
                            )
                          }
                        >
                          Play
                        </button>
                      )}
                      {mediaKind(item.name) === "image" && (
                        <button
                          className="ghost small"
                          type="button"
                          onClick={() =>
                            openPlayer(
                              libraryMedia.map((entry) => ({ name: entry.name, url: mediaUrl(entry) })),
                              index,
                            )
                          }
                        >
                          View
                        </button>
                      )}
                      {mediaKind(item.name) === "file" && (
                        <button
                          className="ghost small"
                          type="button"
                          onClick={() => void openExternal(mediaUrl(item))}
                        >
                          Open
                        </button>
                      )}
                      <button
                        className="ghost small"
                        type="button"
                        onClick={() => void openExternal(mediaUrl(item, true))}
                      >
                        Save
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="settings-section-title">Notes &amp; files</div>
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
                    <span>{activeBotName}&apos;s computer</span>
                    <button className="btn primary" type="button" onClick={() => void startComputerScreen()}>
                      Start {activeBotName}&apos;s computer
                    </button>
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
              {marketQuery && (
                <button className="market-clear" type="button" onClick={() => setMarketQuery("")}>
                  Clear
                </button>
              )}
              {marketQuery.trim() !== "" && (
                <div className="market-dropdown">
                  {marketMatches.length === 0 ? (
                    <div className="market-dropdown-empty">No plugins found</div>
                  ) : (
                    marketMatches.slice(0, 8).map((app) => (
                      <button
                        key={app.id}
                        type="button"
                        className="market-dropdown-row"
                        onClick={() => setMarketQuery(app.name)}
                      >
                        <span className="market-ico">{app.icon}</span>
                        <span className="market-dropdown-name">{app.name}</span>
                        <span className="account-chev">›</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="market-body">
              {(marketViewAll ? ["All plugins"] : MARKET_SECTIONS).map((section) => {
                const apps = (
                  section === "All plugins"
                    ? MARKETPLACE
                    : MARKETPLACE.filter((app) => app.section === section)
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
                        <button
                          className="market-viewall"
                          type="button"
                          onClick={() => setMarketViewAll(true)}
                        >
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
                                <>
                                  <span className="market-added">
                                    <CheckIcon size={13} /> Added
                                  </span>
                                  <button
                                    className="market-remove"
                                    type="button"
                                    title="Remove"
                                    onClick={() => void disconnectApp(app.provider!)}
                                  >
                                    <CloseIcon size={12} />
                                  </button>
                                </>
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
                                  {connectingApp === app.provider ? "Adding…" : "Add"}
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
        </div>
      )}

      {forwardMessage && (
        <div className="apps-overlay" onClick={() => setForwardMessage(null)}>
          <div className="apps-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">Forward to…</span>
              <button className="round small" type="button" onClick={() => setForwardMessage(null)}>
                <CloseIcon size={13} />
              </button>
            </div>
            <p className="apps-sub">Send this message to a bot or group.</p>
            <div className="market-rows">
              {bots.map((bot) => (
                <button key={bot.id} className="market-row" type="button" onClick={() => void forwardTo(bot)}>
                  <span className="market-ico">
                    <BotLogo size={24} scheme={BOT_SCHEMES[bot.scheme % BOT_SCHEMES.length]} />
                  </span>
                  <span className="market-row-text">
                    <span className="market-name">{bot.name}</span>
                    <span className="market-desc">{bot.memberIds?.length ? "Group" : "Bot"}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {companySetupOpen && (
        <div className="apps-overlay" onClick={closeCompanySetup}>
          <div className="apps-panel company-setup" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">
                {companyStep === "source"
                  ? "Start a company"
                  : companyStep === "review"
                    ? "Review the team"
                    : "Work hours & budget"}
              </span>
              <button className="round small" type="button" onClick={closeCompanySetup}>
                ✕
              </button>
            </div>

            <div className="company-setup-body">
              {companyError && (
                <p className="bot-editor-error" role="alert">
                  {companyError}
                </p>
              )}

              {companyStep === "source" && (
                <>
                  <p className="company-hint">
                    Paste a website or describe your idea. We'll analyse it and recommend a team.
                  </p>
                  <input
                    className="workspace-input"
                    placeholder="https://example.com — or “a subscription box for house plants”"
                    value={companySource}
                    onChange={(event) => setCompanySource(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void runCompanyPlan();
                    }}
                    autoFocus
                  />
                </>
              )}

              {companyStep === "review" && companyPlan && (
                <>
                  {companyPlan.dna && (
                    <p className="company-hint">
                      {companyPlan.dna.industry}
                      {companyPlan.dna.category ? ` · ${companyPlan.dna.category}` : ""} · stage:{" "}
                      {companyPlan.dna.stage}
                    </p>
                  )}
                  <div className="company-plan-name">
                    <span className="company-plan-emoji">{companyPlan.avatarEmoji ?? "🏢"}</span>
                    <input
                      className="workspace-input"
                      value={companyPlan.name}
                      onChange={(event) =>
                        setCompanyPlan((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                      }
                      aria-label="Company name"
                    />
                  </div>
                  {companyPlan.mission && <p className="company-plan-mission">{companyPlan.mission}</p>}
                  {companyPlan.rationale && companyPlan.rationale.length > 0 && (
                    <ul className="company-rationale">
                      {companyPlan.rationale.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                  )}
                  <ul className="company-plan-list">
                    {(companyPlan.members ?? []).map((member, index) => (
                      <li key={index} className="plan-member-row">
                        <span className="company-plan-emoji">{member.emoji ?? "🤖"}</span>
                        <input
                          className="plan-member-input"
                          value={member.name}
                          onChange={(event) => updatePlanMember(index, { name: event.target.value })}
                          placeholder="Name"
                          aria-label="Employee name"
                        />
                        <input
                          className="plan-member-input plan-member-title"
                          value={member.title}
                          onChange={(event) => updatePlanMember(index, { title: event.target.value })}
                          placeholder="Role"
                          aria-label="Employee role"
                        />
                        <select
                          className="plan-member-dept"
                          value={member.department ?? "ops"}
                          onChange={(event) =>
                            updatePlanMember(index, { department: event.target.value as Department })
                          }
                          aria-label="Department"
                        >
                          {DEPARTMENTS.map((dept) => (
                            <option key={dept} value={dept}>
                              {dept}
                            </option>
                          ))}
                        </select>
                        <button
                          className="plan-member-remove"
                          type="button"
                          aria-label="Remove employee"
                          onClick={() => removePlanMember(index)}
                        >
                          <CloseIcon size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button className="link" type="button" onClick={addPlanMember}>
                    + Add employee
                  </button>
                </>
              )}

              {companyStep === "confirm" && (
                <>
                  <p className="company-hint">Optional — you can change these later in the Company HQ.</p>
                  <label className="board-hours-check">
                    <input
                      type="checkbox"
                      checked={wizardUseHours}
                      onChange={(event) => setWizardUseHours(event.target.checked)}
                    />{" "}
                    Set working hours (scheduled work only runs inside them)
                  </label>
                  {wizardUseHours && (
                    <div className="board-add">
                      <input
                        className="workspace-input board-hours"
                        type="number"
                        min={0}
                        max={23}
                        value={wizardHoursStart}
                        onChange={(event) => setWizardHoursStart(event.target.value)}
                        aria-label="Start hour"
                      />
                      <span className="board-phase">to</span>
                      <input
                        className="workspace-input board-hours"
                        type="number"
                        min={1}
                        max={24}
                        value={wizardHoursEnd}
                        onChange={(event) => setWizardHoursEnd(event.target.value)}
                        aria-label="End hour"
                      />
                      <label className="board-hours-check">
                        <input
                          type="checkbox"
                          checked={wizardWeekdays}
                          onChange={(event) => setWizardWeekdays(event.target.checked)}
                        />{" "}
                        weekdays
                      </label>
                      <input
                        className="workspace-input board-tz"
                        type="text"
                        placeholder="Timezone (e.g. Asia/Phnom_Penh)"
                        value={wizardTimezone}
                        onChange={(event) => setWizardTimezone(event.target.value)}
                        aria-label="Timezone"
                      />
                    </div>
                  )}
                  <input
                    className="workspace-input"
                    type="number"
                    min={0}
                    placeholder="Token budget (0 = inherit account cap)"
                    value={wizardBudget}
                    onChange={(event) => setWizardBudget(event.target.value)}
                  />
                  <label className="board-hours-check">
                    <input
                      type="checkbox"
                      checked={wizardActivate}
                      onChange={(event) => setWizardActivate(event.target.checked)}
                    />{" "}
                    Activate now (supervised — you still approve consequential actions)
                  </label>
                </>
              )}
            </div>

            <div className="apps-actions">
              <button
                className="ghost small"
                type="button"
                onClick={closeCompanySetup}
                disabled={companyBusy}
              >
                Cancel
              </button>
              {companyStep !== "source" && (
                <button
                  className="ghost small"
                  type="button"
                  disabled={companyBusy}
                  onClick={() => setCompanyStep(companyStep === "confirm" ? "review" : "source")}
                >
                  Back
                </button>
              )}
              {companyStep === "source" && (
                <button
                  className="btn primary"
                  type="button"
                  disabled={companyBusy || !companySource.trim()}
                  onClick={() => void runCompanyPlan()}
                >
                  {companyBusy ? "Planning…" : "Plan the team"}
                </button>
              )}
              {companyStep === "review" && (
                <button
                  className="btn primary"
                  type="button"
                  disabled={companyBusy}
                  onClick={() => setCompanyStep("confirm")}
                >
                  Next
                </button>
              )}
              {companyStep === "confirm" && (
                <button
                  className="btn primary"
                  type="button"
                  disabled={companyBusy}
                  onClick={() => void createCompany()}
                >
                  {companyBusy ? "Hiring…" : "Hire the team"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {boardWorkspace && (
        <div className="apps-overlay" onClick={closeBoard}>
          <div className="apps-panel company-setup board-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">Company HQ — {boardWorkspace.name}</span>
              <button className="round small" type="button" onClick={closeBoard}>
                ✕
              </button>
            </div>
            <div className="hq-tabs" role="tablist">
              {(
                [
                  ["need", `Needs you${hqNeeds.length ? ` (${hqNeeds.length})` : ""}`],
                  ["team", "Team"],
                  ["board", "Board"],
                  ["budget", "Budget"],
                  ["standup", "Standup"],
                  ["office", "Office"],
                  ["wiki", "Wiki"],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  className={`hq-tab${hqTab === tab ? " active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={hqTab === tab}
                  onClick={() => setHqTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="company-setup-body">
              {hqTab === "need" && (
                <>
                  {hqNeeds.length === 0 && <p className="company-hint">Nothing needs you right now.</p>}
                  <ul className="board-list">
                    {hqNeeds.map((task) => (
                      <li key={task.id} className="board-item">
                        <span className="board-title">{task.goal}</span>
                        <button
                          className="ghost small"
                          type="button"
                          onClick={() => void resolveNeed(task, "deny")}
                        >
                          Deny
                        </button>
                        <button
                          className="btn primary small"
                          type="button"
                          onClick={() => void resolveNeed(task, "allow")}
                        >
                          Allow
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {hqTab === "team" && (
                <>
                <ul className="board-list">
                  {(workspaceByName.get(boardWorkspace.name)?.roles ?? []).map((role) => {
                    const caps = ROLE_CATALOG.find((entry) => entry.title === role.title)?.capabilities ?? [];
                    const subject = `role:${role.title}`;
                    return (
                      <li key={role.botId} className="team-member">
                        <div className="team-member-head">
                          <span className="board-title">{role.title}</span>
                          <span className="board-phase">{role.department}</span>
                        </div>
                        {caps.length > 0 && (
                          <div className="grant-chips">
                            {caps.map((capability) => {
                              const granted = hqGrants.some(
                                (grant) =>
                                  grant.subject === subject &&
                                  grant.capability === capability &&
                                  grant.granted,
                              );
                              return (
                                <button
                                  key={capability}
                                  className={`grant-chip${granted ? " granted" : ""}`}
                                  type="button"
                                  title="Toggle this capability"
                                  onClick={() => void toggleGrant(subject, capability, !granted)}
                                >
                                  {capability}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {(() => {
                  const personal = bots.filter((bot) => !bot.workspace);
                  if (personal.length === 0) return null;
                  return (
                    <div className="board-add">
                      <select
                        className="plan-member-dept"
                        value={addMemberBotId}
                        onChange={(event) => setAddMemberBotId(event.target.value)}
                        aria-label="Add an existing bot"
                      >
                        <option value="">Add an existing bot…</option>
                        {personal.map((bot) => (
                          <option key={bot.id} value={bot.id}>
                            {bot.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn primary small"
                        type="button"
                        disabled={!addMemberBotId || boardBusy}
                        onClick={() => void addExistingMember()}
                      >
                        Add
                      </button>
                    </div>
                  );
                })()}
                </>
              )}

              {hqTab === "board" && (
                <>
                  <div className="board-add">
                    <input
                      className="workspace-input"
                      placeholder="Add a task…"
                      value={boardTitle}
                      onChange={(event) => setBoardTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void addBoardItem();
                      }}
                    />
                    <button
                      className="btn primary small"
                      type="button"
                      disabled={boardBusy || !boardTitle.trim()}
                      onClick={() => void addBoardItem()}
                    >
                      Add
                    </button>
                  </div>
                  {boardItems.length === 0 && <p className="company-hint">No work items yet.</p>}
                  <ul className="board-list">
                    {boardItems.map((item) => (
                      <li key={item.id} className="board-item">
                        <select
                          className={`board-status board-status-${item.status}`}
                          value={item.status}
                          onChange={(event) =>
                            void setWorkStatus(item.id, event.target.value as WorkItem["status"])
                          }
                          aria-label="Status"
                        >
                          {(["todo", "in_progress", "blocked", "review", "done"] as const).map((status) => (
                            <option key={status} value={status}>
                              {status.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                        <span className="board-title">{item.title}</span>
                        <span className="board-phase">{item.phase}</span>
                        <button
                          className="plan-member-remove"
                          type="button"
                          aria-label="Delete task"
                          onClick={() => void deleteBoardItem(item.id)}
                        >
                          <CloseIcon size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {hqTab === "budget" && (
                <>
                  <p className="company-hint">
                    Company token budget · used {(hqBudget?.usedTokens ?? 0).toLocaleString()}
                    {hqBudget && hqBudget.limitTokens > 0
                      ? ` of ${hqBudget.limitTokens.toLocaleString()}`
                      : " (0 = inherit the account cap)"}
                  </p>
                  <div className="board-add">
                    <input
                      className="workspace-input"
                      type="number"
                      min={0}
                      placeholder="Token limit (0 = inherit)"
                      value={budgetInput}
                      onChange={(event) => setBudgetInput(event.target.value)}
                    />
                    <button
                      className="btn primary small"
                      type="button"
                      disabled={boardBusy}
                      onClick={() => void saveBudget()}
                    >
                      Save
                    </button>
                  </div>
                  <p className="company-hint">Work hours — scheduled work only happens inside this window.</p>
                  <div className="board-add">
                    <input
                      className="workspace-input board-hours"
                      type="number"
                      min={0}
                      max={23}
                      value={hoursStart}
                      onChange={(event) => setHoursStart(event.target.value)}
                      aria-label="Start hour"
                    />
                    <span className="board-phase">to</span>
                    <input
                      className="workspace-input board-hours"
                      type="number"
                      min={1}
                      max={24}
                      value={hoursEnd}
                      onChange={(event) => setHoursEnd(event.target.value)}
                      aria-label="End hour"
                    />
                    <label className="board-hours-check">
                      <input
                        type="checkbox"
                        checked={hoursWeekdays}
                        onChange={(event) => setHoursWeekdays(event.target.checked)}
                      />{" "}
                      weekdays
                    </label>
                    <input
                      className="workspace-input board-tz"
                      type="text"
                      placeholder="Timezone (e.g. Asia/Phnom_Penh)"
                      value={hoursTimezone}
                      onChange={(event) => setHoursTimezone(event.target.value)}
                      aria-label="Timezone"
                    />
                    <button
                      className="btn primary small"
                      type="button"
                      disabled={boardBusy}
                      onClick={() => void saveHours()}
                    >
                      Save hours
                    </button>
                  </div>
                </>
              )}

              {hqTab === "standup" && (
                <>
                  <div className="board-add">
                    <button
                      className="btn primary small"
                      type="button"
                      disabled={boardBusy}
                      onClick={() => void runStandup("standup")}
                    >
                      {boardBusy ? "Running…" : "Run standup"}
                    </button>
                    <button
                      className="ghost small"
                      type="button"
                      disabled={boardBusy}
                      onClick={() => void runStandup("weekly")}
                    >
                      Weekly report
                    </button>
                  </div>
                  {hqReports.length === 0 && <p className="company-hint">No standups yet.</p>}
                  <ul className="board-list">
                    {hqReports.map((report) => (
                      <li key={report.id} className="board-item">
                        <pre className="standup-text">{report.summary}</pre>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {hqTab === "office" && (
                <ul className="board-list">
                  {(workspaceByName.get(boardWorkspace.name)?.roles ?? []).map((role) => {
                    const bot = bots.find((entry) => entry.id === role.botId);
                    return (
                      <li key={role.botId} className="board-item">
                        <span className="board-title">{role.title}</span>
                        <span className="board-phase">{role.department}</span>
                        {bot && (
                          <button className="ghost small" type="button" onClick={() => openEmployee(bot)}>
                            Open screen
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {hqTab === "wiki" && (
                <>
                  {hqWiki.length === 0 && <p className="company-hint">The company wiki is empty.</p>}
                  <ul className="board-list">
                    {hqWiki.map((file) => (
                      <li key={file.name} className="team-member">
                        <div className="wiki-doc-name">{file.name}</div>
                        <pre className="standup-text">{file.content || "(empty)"}</pre>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="apps-actions">
              {(() => {
                const autonomy = workspaceByName.get(boardWorkspace.name)?.autonomy ?? "manual";
                if (autonomy === "manual") {
                  return (
                    <>
                      <button
                        className="btn primary small"
                        type="button"
                        disabled={boardBusy}
                        onClick={() => void setAutonomy("supervised")}
                      >
                        Activate
                      </button>
                      <button
                        className="ghost small"
                        type="button"
                        disabled={boardBusy}
                        title="Schedules + auto-approve (they act without asking, within grants and budget)"
                        onClick={() => void setAutonomy("autonomous")}
                      >
                        Autonomous
                      </button>
                    </>
                  );
                }
                return (
                  <>
                    <span className="hq-autonomy">{autonomy}</span>
                    <button
                      className="ghost small"
                      type="button"
                      disabled={boardBusy}
                      onClick={() => void setAutonomy("manual")}
                    >
                      Deactivate
                    </button>
                  </>
                );
              })()}
              <button
                className="ghost small danger"
                type="button"
                disabled={boardBusy}
                onClick={() => void stopCompany()}
              >
                Stop all
              </button>
              <button
                className="ghost small"
                type="button"
                onClick={() =>
                  void setCompanyStatus(
                    (workspaceByName.get(boardWorkspace.name)?.status ?? "active") === "paused"
                      ? "active"
                      : "paused",
                  )
                }
              >
                {(workspaceByName.get(boardWorkspace.name)?.status ?? "active") === "paused"
                  ? "Resume"
                  : "Pause"}
              </button>
              <button className="ghost small" type="button" onClick={closeBoard}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {companyEdit && (
        <div className="apps-overlay" onClick={() => setCompanyEdit(null)}>
          <div className="apps-panel company-setup" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">Company settings</span>
              <button className="round small" type="button" onClick={() => setCompanyEdit(null)}>
                ✕
              </button>
            </div>
            <div className="company-setup-body">
              <label className="workspace-field">
                <span className="workspace-field-label">Company name</span>
                <input
                  className="workspace-input"
                  value={companyEdit.name}
                  onChange={(event) =>
                    setCompanyEdit((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void renameCompany();
                  }}
                  autoFocus
                />
              </label>
              {companyError && (
                <p className="bot-editor-error" role="alert">
                  {companyError}
                </p>
              )}
            </div>
            <div className="apps-actions">
              <button
                className="ghost small danger"
                type="button"
                onClick={() => {
                  if (confirmCompanyDelete) {
                    void removeCompany();
                  } else {
                    setConfirmCompanyDelete(true);
                    window.setTimeout(() => setConfirmCompanyDelete(false), 4000);
                  }
                }}
                disabled={companyBusy}
              >
                {confirmCompanyDelete ? "Confirm — delete company + employees" : "Delete company"}
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => void renameCompany()}
                disabled={companyBusy}
              >
                {companyBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {createBotMode && (
        <div className="apps-overlay" onClick={closeBotModal}>
          <div className="apps-panel bot-editor" onClick={(event) => event.stopPropagation()}>
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

            <div className="bot-editor-body">
              <div className="bot-preview">
                <BotLogo size={64} scheme={BOT_SCHEMES[botScheme % BOT_SCHEMES.length]} />
                <input
                  className="bot-name-input"
                  placeholder={createBotMode === "group" ? "Group name" : "Bot name"}
                  value={botName}
                  onChange={(event) => setBotName(event.target.value)}
                  autoFocus
                />
                <div className="emoji-picker">
                  <button
                    type="button"
                    className={`emoji-trigger ${emojiOpen ? "open" : ""}`}
                    onClick={() => setEmojiOpen((value) => !value)}
                    title="Choose an emoji"
                    aria-label="Choose an emoji"
                    aria-expanded={emojiOpen}
                  >
                    {cleanEmoji(botEmoji, createBotMode === "group")}
                  </button>
                  {emojiOpen && (
                    <>
                      <div className="emoji-backdrop" onClick={() => setEmojiOpen(false)} />
                      <div className="emoji-pop" role="listbox">
                        {EMOJI_CHOICES.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            className={`emoji-choice ${emoji === botEmoji ? "active" : ""}`}
                            role="option"
                            aria-selected={emoji === botEmoji}
                            onClick={() => {
                              setBotEmoji(emoji);
                              setEmojiOpen(false);
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
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

              <label className="workspace-field">
                <span className="workspace-field-label">Company</span>
                <input
                  className="workspace-input"
                  type="text"
                  list="workspace-options"
                  placeholder="Group under a company (optional)"
                  value={botWorkspace}
                  onChange={(event) => setBotWorkspace(event.target.value)}
                  maxLength={60}
                />
                {workspaceNames.length > 0 && (
                  <datalist id="workspace-options">
                    {workspaceNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                )}
              </label>

              {(createBotMode === "group" || createBotMode === "edit") && (
                <>
                  {(() => {
                    // A group holds individual bots only: never itself, and never
                    // another group (no nested groups).
                    const candidates = bots.filter(
                      (bot) => bot.id !== editingBotId && !(bot.memberIds && bot.memberIds.length > 0),
                    );
                    return (
                      <>
                        <div className="member-actions">
                          <span className="member-actions-title">Members</span>
                          <button
                            className="link"
                            type="button"
                            onClick={() => setGroupMembers(candidates.map((bot) => bot.id))}
                          >
                            Add all
                          </button>
                          <button className="link" type="button" onClick={() => setGroupMembers([])}>
                            None
                          </button>
                        </div>
                        <ul className="member-list">
                          {candidates.length === 0 && (
                            <li className="muted">No bots to add yet — create a bot first.</li>
                          )}
                          {candidates.map((bot) => (
                            <li key={bot.id}>
                              <label className="member-item">
                                <input
                                  type="checkbox"
                                  checked={groupMembers.includes(bot.id)}
                                  onChange={(event) =>
                                    setGroupMembers((prev) =>
                                      event.target.checked
                                        ? [...prev, bot.id]
                                        : prev.filter((id) => id !== bot.id),
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
                    );
                  })()}
                </>
              )}

              {(createBotMode === "group" || createBotMode === "edit") && (
                <label className="settings-line">
                  <span>Autonomous — every member decides whether to reply</span>
                  <input
                    type="checkbox"
                    checked={autonomous}
                    onChange={(event) => setAutonomous(event.target.checked)}
                  />
                </label>
              )}

              <label className="settings-line">
                <span>Always allow — run consequential actions (send, pay, delete) without asking</span>
                <input
                  type="checkbox"
                  checked={autoApprove}
                  onChange={(event) => setAutoApprove(event.target.checked)}
                />
              </label>

              <div className="settings-section-title">Capability packs</div>
              <ul className="skill-list">
                {skills.length === 0 && <li className="muted">No skills available.</li>}
                {skills.map((skill) => (
                  <li key={skill.id}>
                    <label className="member-item">
                      <input
                        type="checkbox"
                        checked={selectedSkills.includes(skill.id)}
                        onChange={(event) =>
                          setSelectedSkills((prev) =>
                            event.target.checked ? [...prev, skill.id] : prev.filter((id) => id !== skill.id),
                          )
                        }
                      />
                      <span className="skill-name">{skill.name}</span>
                      <span className="skill-desc">{skill.description}</span>
                    </label>
                  </li>
                ))}
              </ul>

              {/*
                Learned skills are a shared, auto-applied library that can grow to
                thousands. We never render them all: show a searchable preview and
                send "Browse all" to the full library on the web.
              */}
              <div className="settings-section-title skill-learned-head">
                <span>Learned skills</span>
                <span className="skill-count">{learnedSkills.length}</span>
              </div>
              {learnedSkills.length > 0 && (
                <input
                  className="skill-search"
                  type="search"
                  placeholder="Search learned skills…"
                  value={skillQuery}
                  onChange={(event) => setSkillQuery(event.target.value)}
                />
              )}
              {(() => {
                const query = skillQuery.trim().toLowerCase();
                const matches = query
                  ? learnedSkills.filter(
                      (skill) =>
                        skill.name.toLowerCase().includes(query) ||
                        skill.description.toLowerCase().includes(query),
                    )
                  : learnedSkills;
                const visible = matches.slice(0, 6);
                if (learnedSkills.length === 0) {
                  return (
                    <p className="muted skill-empty">
                      No learned skills yet — your bots add them as they work.
                    </p>
                  );
                }
                if (matches.length === 0) {
                  return <p className="muted skill-empty">No skills match “{skillQuery}”.</p>;
                }
                return (
                  <>
                    <ul className="skill-list skill-list-readonly">
                      {visible.map((skill) => (
                        <li key={skill.id}>
                          <div className="member-item">
                            <span className="skill-name">{skill.name}</span>
                            <span className="skill-desc">{skill.description}</span>
                            {skill.status !== "approved" && (
                              <span className={`skill-pill ${skill.status}`}>{skill.status}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="skill-more">
                      Showing {visible.length} of {matches.length}
                      {query ? "" : " learned skills"} ·{" "}
                      <button className="link" type="button" onClick={() => void openExternal(SKILLS_URL)}>
                        Browse all skills →
                      </button>
                    </p>
                  </>
                );
              })()}

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
            </div>

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
              {botError && (
                <span className="bot-editor-error" role="alert">
                  {botError}
                </span>
              )}
              <button className="ghost small" type="button" onClick={closeBotModal} disabled={savingBot}>
                Cancel
              </button>
              <button
                className={`btn primary ${botSaved ? "saved" : ""}`}
                type="button"
                disabled={savingBot}
                onClick={() => void createBot()}
              >
                {botSaved
                  ? "✓ Saved"
                  : savingBot
                    ? "Saving…"
                    : createBotMode === "edit"
                      ? "Save changes"
                      : createBotMode === "group"
                        ? "Create group"
                        : "Create bot"}
              </button>
            </div>
          </div>
        </div>
      )}

      {screenOn && activeSessionId && (
        <div className="computer-overlay" onClick={() => stopScreen()}>
          <div
            className="computer-modal"
            ref={screenRef}
            tabIndex={0}
            onKeyDown={(event) => onScreenKeyDown(event)}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="computer-head">
              <span className="computer-title">{activeBotName}&apos;s computer</span>
              <button className="round small" type="button" onClick={() => stopScreen()}>
                ✕
              </button>
            </div>
            <img
              className="computer-screen"
              src={`${CLOUD_URL}/v1/sessions/${activeSessionId}/stream?token=${encodeURIComponent(token())}`}
              alt="Botifyr's computer"
              onMouseMove={(event) => onScreenMove(event)}
              onMouseDown={(event) => onScreenDown(event)}
              onWheel={(event) => onScreenWheel(event)}
              onContextMenu={(event) => event.preventDefault()}
            />
            <div className="computer-foot">
              <button
                className={`ghost small${recording ? " danger" : ""}`}
                type="button"
                onClick={() => void toggleRecord()}
              >
                {recording ? "● Stop recording" : "Record"}
              </button>
              {!recording && (
                <a
                  className="ghost small"
                  href={`${CLOUD_URL}/v1/sessions/${activeSessionId}/computer/recording?token=${encodeURIComponent(token())}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download recording
                </a>
              )}
              <button className="ghost small" type="button" onClick={() => void saveTask()}>
                Save as task
              </button>
              <button className="ghost small" type="button" onClick={() => stopScreen()}>
                Stop computer
              </button>
              <button
                className={`ghost small${tasksOpen ? " primary" : ""}`}
                type="button"
                onClick={() => setTasksOpen((value) => !value)}
              >
                Tasks
              </button>
              <span className="computer-hint">
                Click and type directly — the sandbox receives your mouse and keyboard.
              </span>
            </div>

            {tasksOpen && (
              <div className="computer-tasks">
                {(() => {
                  const tasks = learnedSkills.filter((skill) =>
                    (skill.description ?? "").toLowerCase().includes("demonstration"),
                  );
                  if (tasks.length === 0) {
                    return (
                      <p className="computer-hint">
                        No learned tasks yet — record a demonstration, then “Save as task”.
                      </p>
                    );
                  }
                  return (
                    <ul className="computer-task-list">
                      {tasks.map((task) => (
                        <li key={task.id}>
                          <span className="computer-task-name">{task.name}</span>
                          <button
                            className="ghost small"
                            type="button"
                            onClick={() => void replayTask(task.name)}
                          >
                            Replay
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {playerFile && player && (
        <div className="apps-overlay" onClick={() => setPlayer(null)}>
          <div className="player-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <button
                className="round small"
                type="button"
                aria-label="Previous"
                disabled={player.index <= 0}
                onClick={() =>
                  setPlayer((prev) => (prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev))
                }
              >
                ‹
              </button>
              <span className="apps-title" title={playerFile.name}>
                {prettyFileName(playerFile.name)}
              </span>
              {player.items.length > 1 && (
                <span className="player-count">
                  {player.index + 1} / {player.items.length}
                </span>
              )}
              <button
                className="round small"
                type="button"
                aria-label="Next"
                disabled={player.index >= player.items.length - 1}
                onClick={() =>
                  setPlayer((prev) =>
                    prev && prev.index < prev.items.length - 1 ? { ...prev, index: prev.index + 1 } : prev,
                  )
                }
              >
                ›
              </button>
              <button className="round small" type="button" onClick={() => setPlayer(null)}>
                ✕
              </button>
            </div>
            {/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(playerFile.name) ? (
              <img className="player-media" src={playerFile.url} alt={playerFile.name} />
            ) : /\.(mp3|m4a|aac|ogg|wav|flac)$/i.test(playerFile.name) ? (
              <audio className="player-media" src={playerFile.url} controls autoPlay />
            ) : (
              <video className="player-media" src={playerFile.url} controls autoPlay />
            )}
          </div>
        </div>
      )}

      {topUpOpen && (
        <div className="apps-overlay" onClick={() => setTopUpOpen(false)}>
          <div className="apps-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">Top up credits</span>
              <button className="icon-btn sm" type="button" onClick={() => setTopUpOpen(false)}>
                ✕
              </button>
            </div>
            <p className="apps-sub">
              Credits are used once your included tokens run out. Minimum $
              {((billing?.onDemand.minTopUpCents ?? 100) / 100).toFixed(2)}.
            </p>
            <div className="topup-amounts">
              {[100, 500, 1000, 2000]
                .filter((cents) => cents >= (billing?.onDemand.minTopUpCents ?? 100))
                .map((cents) => (
                  <button key={cents} className="btn" type="button" onClick={() => void topUp(cents)}>
                    ${(cents / 100).toFixed(2)}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {shareItem && (
        <div className="apps-overlay" onClick={() => setShareItem(null)}>
          <div className="apps-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">Send to a friend</span>
              <button className="icon-btn sm" type="button" onClick={() => setShareItem(null)}>
                ✕
              </button>
            </div>
            <p className="apps-sub">{prettyFileName(shareItem.name)}</p>
            <ul className="member-list">
              {friends.length === 0 && <li className="muted">Add a friend first.</li>}
              {friends.map((person) => (
                <li key={person.id}>
                  <button className="ghost small" type="button" onClick={() => void shareWith(person)}>
                    {person.displayName || (person.handle ? `@${person.handle}` : "Friend")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showPeople && (
        <div className="apps-overlay" onClick={() => setShowPeople(false)}>
          <div className="apps-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">People</span>
              <button className="icon-btn sm" type="button" onClick={() => setShowPeople(false)}>
                <CloseIcon size={13} />
              </button>
            </div>
            <div className="settings-section-title">Your profile</div>
            <div className="portal-row" style={{ gap: 8, marginBottom: 6 }}>
              <input
                className="settings-input"
                style={{ width: 56, textAlign: "center" }}
                value={profileEmoji}
                maxLength={4}
                aria-label="Avatar emoji"
                onChange={(event) => setProfileEmoji(event.target.value)}
              />
              <input
                className="settings-input"
                style={{ flex: 1 }}
                placeholder="Display name"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
              />
            </div>
            <div className="portal-row" style={{ gap: 8, marginBottom: 10 }}>
              <input
                className="settings-input"
                style={{ flex: 1 }}
                placeholder="@handle"
                value={profileHandle}
                onChange={(event) => setProfileHandle(event.target.value)}
              />
              <button className="ghost small" type="button" onClick={() => void saveProfile()}>
                Save
              </button>
            </div>
            <input
              className="settings-input"
              style={{ width: "100%", margin: "0 0 10px", boxSizing: "border-box" }}
              placeholder="Search people by @handle or email"
              value={peopleQuery}
              onChange={(event) => void searchPeopleNow(event.target.value)}
            />

            {peopleResults.length > 0 && (
              <>
                <div className="settings-section-title">Results</div>
                <ul className="downloads-list">
                  {peopleResults.map((person) => (
                    <li key={person.id} className="download-row">
                      <span className="download-ico">{person.avatarEmoji ?? "🙂"}</span>
                      <div className="download-main">
                        <div className="download-name">
                          {person.displayName ||
                            (person.handle ? `@${person.handle}` : person.id.slice(0, 8))}
                        </div>
                        <div className="download-size">{person.online ? "online" : "offline"}</div>
                      </div>
                      {person.friend ? (
                        <button className="ghost small" type="button" onClick={() => void openDmWith(person)}>
                          Message
                        </button>
                      ) : person.requested ? (
                        <span className="settings-note">Requested</span>
                      ) : (
                        <button className="ghost small" type="button" onClick={() => void addFriend(person)}>
                          {person.incoming ? "Accept" : "Add friend"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {friendRequests.filter((request) => request.direction === "incoming").length > 0 && (
              <>
                <div className="settings-section-title">Friend requests</div>
                <ul className="downloads-list">
                  {friendRequests
                    .filter((request) => request.direction === "incoming")
                    .map((request) => (
                      <li key={request.id} className="download-row">
                        <span className="download-ico">🙂</span>
                        <div className="download-main">
                          <div className="download-name">
                            {request.person.displayName ||
                              (request.person.handle ? `@${request.person.handle}` : "Friend")}
                          </div>
                        </div>
                        <button
                          className="ghost small"
                          type="button"
                          onClick={() => void respondRequest(request.id, "accept")}
                        >
                          Accept
                        </button>
                        <button
                          className="ghost small"
                          type="button"
                          onClick={() => void respondRequest(request.id, "decline")}
                        >
                          Decline
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}

            <div className="settings-section-title">Friends ({friends.length})</div>
            <ul className="downloads-list">
              {friends.length === 0 && (
                <li className="muted">No friends yet — search above to add someone.</li>
              )}
              {friends.map((person) => (
                <li key={person.id} className="download-row">
                  <span className="download-ico">{person.online ? "●" : "○"}</span>
                  <div className="download-main">
                    <div className="download-name">
                      {person.displayName || (person.handle ? `@${person.handle}` : "Friend")}
                    </div>
                    <div className="download-size">{person.online ? "online" : "offline"}</div>
                  </div>
                  <button className="ghost small" type="button" onClick={() => void openDmWith(person)}>
                    Message
                  </button>
                </li>
              ))}
            </ul>

            {friends.length >= 2 && (
              <>
                <div className="settings-section-title">New group</div>
                <input
                  className="settings-input"
                  style={{ width: "100%", marginBottom: 6, boxSizing: "border-box" }}
                  placeholder="Group name"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                />
                <ul className="downloads-list">
                  {friends.map((person) => (
                    <li key={person.id} className="download-row">
                      <label className="member-item" style={{ flex: 1 }}>
                        <input
                          type="checkbox"
                          checked={groupSelection.includes(person.id)}
                          onChange={(event) =>
                            setGroupSelection((prev) =>
                              event.target.checked
                                ? [...prev, person.id]
                                : prev.filter((id) => id !== person.id),
                            )
                          }
                        />
                        <span>{person.displayName || (person.handle ? `@${person.handle}` : "Friend")}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <button className="btn primary" type="button" onClick={() => void createFriendGroup()}>
                  Create group
                </button>
              </>
            )}
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

                  <div className="settings-section-title">Downloads</div>
                  <div className="settings-list">
                    <label className="settings-line">
                      <span>Download cookies (all sites)</span>
                      <span className="settings-static">
                        {secrets.some(
                          (secret) => secret.name === "DOWNLOAD_COOKIES" || secret.name === "YOUTUBE_COOKIES",
                        )
                          ? "Saved"
                          : "Not set"}
                      </span>
                    </label>
                  </div>
                  <textarea
                    className="bot-instructions"
                    placeholder="Optional: paste your cookies.txt (Netscape format) so yt-dlp can get past a site's bot check or login (YouTube, Vimeo, short-drama sites…). Leave empty to skip."
                    value={ytCookies}
                    onChange={(event) => setYtCookies(event.target.value)}
                    rows={3}
                  />
                  <div className="apps-actions">
                    {secrets.some(
                      (secret) => secret.name === "DOWNLOAD_COOKIES" || secret.name === "YOUTUBE_COOKIES",
                    ) && (
                      <button
                        className="ghost small danger"
                        type="button"
                        onClick={() => void removeDownloadCookies()}
                      >
                        Remove
                      </button>
                    )}
                    <button className="btn primary" type="button" onClick={() => void saveDownloadCookies()}>
                      Save cookies
                    </button>
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

                  <div className="settings-section-title">Approvals</div>
                  <label className="settings-line">
                    <span>Approvals</span>
                    <select
                      value={executionMode}
                      onChange={(event) => {
                        void applyExecutionMode(event.target.value as "ask" | "always_allow");
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
                  {user?.role === "admin" ? (
                    <div className="trial-card">
                      <div className="trial-head">
                        <span>Operator account</span>
                        <span>Unlimited tokens</span>
                      </div>
                      <div className="trial-foot">This account is exempt from plan limits and billing.</div>
                    </div>
                  ) : (
                    plan === "free" && (
                      <div className="trial-card">
                        <div className="trial-head">
                          <span>Free plan usage</span>
                          <span>
                            {(billing?.tokensThisMonth ?? 0).toLocaleString()} /{" "}
                            {(billing?.freeMonthlyTokens ?? 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="trial-bar">
                          <span
                            style={{
                              width: `${
                                billing?.freeMonthlyTokens
                                  ? Math.min(
                                      100,
                                      Math.round((billing.tokensThisMonth / billing.freeMonthlyTokens) * 100),
                                    )
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <div className="trial-foot">Resets at the start of each month</div>
                      </div>
                    )
                  )}

                  <div className="settings-section-title">Plan &amp; credits</div>
                  <div className="settings-row">
                    <span className="settings-row-main">
                      <span className="settings-row-name">
                        Current plan:{" "}
                        {user?.role === "admin"
                          ? "Operator (admin)"
                          : plan === "business"
                            ? "Business"
                            : plan === "pro"
                              ? "Pro"
                              : "Free"}
                      </span>
                      <span className="settings-row-sub">
                        {user?.role === "admin"
                          ? "Unlimited tokens — no billing"
                          : billing?.periodEnd
                            ? `Renews ${new Date(billing.periodEnd).toLocaleDateString()}`
                            : plan === "free"
                              ? `${(billing?.tokensThisMonth ?? 0).toLocaleString()} / ${(billing?.freeMonthlyTokens ?? 0).toLocaleString()} free tokens this month`
                              : "No active period"}
                        {(billing?.walletCents ?? 0) > 0
                          ? ` · $${((billing?.walletCents ?? 0) / 100).toFixed(2)} credits`
                          : ""}
                      </span>
                    </span>
                    {user?.role === "admin" ? (
                      <span className="settings-badge">Operator</span>
                    ) : plan === "free" ? (
                      <button className="btn primary" type="button" onClick={() => void upgradePlan("pro")}>
                        Upgrade to Pro (${((billing?.prices.proCents ?? 500) / 100).toFixed(2)})
                      </button>
                    ) : (
                      <span className="settings-badge">Active</span>
                    )}
                  </div>
                  {plan !== "free" && (
                    <div className="settings-row">
                      <span className="settings-row-main">
                        <span className="settings-row-name">Renew now</span>
                        <span className="settings-row-sub">Prepay another period up front</span>
                      </span>
                      <button
                        className="ghost small"
                        type="button"
                        onClick={() => void upgradePlan(plan === "business" ? "business" : "pro")}
                      >
                        Renew
                      </button>
                    </div>
                  )}
                  <div className="settings-row">
                    <span className="settings-row-main">
                      <span className="settings-row-name">On-demand credits</span>
                      <span className="settings-row-sub">
                        Top up to keep working past your included tokens
                      </span>
                    </span>
                    <button className="ghost small" type="button" onClick={() => setTopUpOpen(true)}>
                      Top up credits
                    </button>
                  </div>
                  {billing?.billingConfigured === false && (
                    <p className="settings-note">
                      Billing isn't configured on this server — set the CHMABA_* environment variables to
                      enable upgrades and top-ups.
                    </p>
                  )}
                  {checkNote && <p className="settings-note">{checkNote}</p>}
                </div>
              )}

              {settingsTab === "skills" && (
                <div className="settings-sections">
                  <div className="settings-section-title">Learned skills ({learnedSkills.length})</div>
                  {learnedSkills.length === 0 && (
                    <p className="settings-note">
                      Nothing learned yet — bots add skills as they figure things out.
                    </p>
                  )}
                  {learnedSkills.map((skill) => (
                    <div key={skill.id} className="settings-row">
                      <span className="settings-row-main">
                        <span className="settings-row-name">{skill.name}</span>
                        <span className="settings-row-sub">{skill.description}</span>
                      </span>
                      <span className={`skill-status skill-${skill.status}`}>{skill.status}</span>
                    </div>
                  ))}
                </div>
              )}

              {settingsTab === "media" && (
                <div className="settings-sections">
                  <div className="settings-section-title">
                    Downloads ({media.length}
                    {media.length > 0
                      ? ` · ${(media.reduce((sum, item) => sum + item.size, 0) / (1024 * 1024)).toFixed(1)} MB`
                      : ""}
                    )
                  </div>
                  <p className="settings-note">
                    Files your bots downloaded. They live on the server until you move them to a computer; the
                    list stays in sync across your devices.
                  </p>
                  <div className="settings-row">
                    <span className="settings-row-main">
                      <span className="settings-row-name">Cloud storage</span>
                      <span className="settings-row-sub">
                        {media.length} file{media.length === 1 ? "" : "s"} available
                      </span>
                    </span>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() =>
                        void client
                          .listMedia()
                          .then(setMedia)
                          .catch(() => {})
                      }
                    >
                      Refresh
                    </button>
                  </div>
                  <p className="settings-note">
                    Other devices online:{" "}
                    {devices
                      .filter((device) => device.id !== myDeviceId)
                      .map((device) => device.name)
                      .join(", ") || "none"}
                  </p>
                  <div className="library-cats">
                    {LIBRARY_CATS.map(([id, label]) => {
                      const count =
                        id === "all"
                          ? media.length
                          : media.filter((item) => mediaKind(item.name) === id).length;
                      return (
                        <button
                          key={id}
                          className={`library-cat ${downloadsCategory === id ? "active" : ""}`}
                          type="button"
                          onClick={() => setDownloadsCategory(id)}
                        >
                          {label}
                          <span className="library-cat-count">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <ul className="downloads-list">
                    {downloadsMedia.length === 0 && (
                      <li className="muted">
                        {media.length === 0 ? "Nothing downloaded yet." : "Nothing in this category."}
                      </li>
                    )}
                    {groupByDate(downloadsMedia, (entry) => entry.createdAt).map(([date, dayItems]) => (
                      <Fragment key={date}>
                        <li className="date-sep">{date}</li>
                        {dayItems.map((item) => (
                          <li key={item.id} className="download-row">
                            <span className="download-ico">{isPlayable(item.name) ? "▶" : "▢"}</span>
                            <div className="download-main">
                              <div className="download-name" title={item.name}>
                                {prettyFileName(item.name)}
                              </div>
                              <div className="download-size">
                                {Math.max(1, Math.round(item.size / 1024)).toLocaleString()} KB ·{" "}
                                {item.location === "device" ? `On ${item.device ?? "a device"}` : "On server"}
                                {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString()}` : ""}
                              </div>
                            </div>
                            {isPlayable(item.name) && (
                              <button
                                className="ghost small"
                                type="button"
                                onClick={() =>
                                  openPlayer(
                                    media.map((entry) => ({ name: entry.name, url: mediaUrl(entry) })),
                                    media.findIndex((entry) => entry.id === item.id),
                                  )
                                }
                              >
                                Play
                              </button>
                            )}
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => void openExternal(mediaUrl(item, true))}
                            >
                              Save
                            </button>
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => void sendToDevice(item)}
                            >
                              Send
                            </button>
                            <button className="ghost small" type="button" onClick={() => setShareItem(item)}>
                              Send to friend
                            </button>
                            <button
                              className="ghost small danger"
                              type="button"
                              onClick={() => void deleteDownload(item)}
                            >
                              Delete
                            </button>
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => void moveToThisComputer(item)}
                            >
                              Move to my computer
                            </button>
                            {item.location === "device" && (
                              <button
                                className="ghost small danger"
                                type="button"
                                onClick={() => void removeFromServer(item)}
                              >
                                Remove from server
                              </button>
                            )}
                          </li>
                        ))}
                      </Fragment>
                    ))}
                  </ul>
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

const MARKET_SECTIONS = [
  "For you",
  "Featured",
  "Login and Credential Management",
  "Developer",
  "Design",
  "Files",
  "Social",
];

const MARKETPLACE: MarketApp[] = [
  {
    id: "github",
    provider: "github",
    tokenApp: true,
    name: "GitHub",
    category: "Developer",
    section: "Login and Credential Management",
    desc: "Read repositories and issues",
    icon: <GithubBrand size={24} />,
  },
  {
    id: "slack",
    provider: "slack",
    tokenApp: true,
    name: "Slack",
    category: "Communication",
    section: "Login and Credential Management",
    desc: "Send and read team messages",
    icon: <SlackBrand size={24} />,
  },
  {
    id: "telegram",
    provider: "telegram",
    tokenApp: true,
    name: "Telegram",
    category: "Communication",
    section: "Login and Credential Management",
    desc: "Send messages from your Telegram bot",
    icon: <TelegramBrand size={24} />,
  },
  {
    id: "gmail",
    provider: "gmail",
    name: "Gmail",
    category: "Communication",
    section: "For you",
    desc: "Read, search, and draft email",
    icon: <GmailIcon size={26} />,
  },
  {
    id: "calendar",
    provider: "calendar",
    name: "Google Calendar",
    category: "Productivity",
    section: "For you",
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

/** Split an assistant message into its text and any trailing ```options block. */
function parseOptions(text: string): { body: string; options: string[] } {
  const match = /```options\s*\n([\s\S]*?)```/i.exec(text);
  if (!match) return { body: text, options: [] };
  const options = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
  const body = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trimEnd();
  return { body, options };
}

function iconFor(status: Task["steps"][number]["status"]): string {
  switch (status) {
    case "pending":
      return "○";
    case "running":
      return "◐";
    case "done":
      return "✓";
    case "failed":
      return "✕";
    case "skipped":
      return "–";
  }
}

/** Trim noisy tool output for display. */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Friendly labels for tool steps; media steps hide their raw JSON/output. */
const STEP_LABELS: Record<string, string> = {
  "youtube.download": "Downloading videos",
  "youtube.search": "Searching YouTube",
  "youtube.info": "Inspecting a video",
  "shell.exec": "Running a command",
  "local.shell.exec": "Using your computer",
};
function stepLabel(title: string): string {
  return STEP_LABELS[title] ?? title;
}
function stepDetail(title: string, detail: string | undefined): string | null {
  if (!detail) return null;
  if (title.startsWith("youtube.")) return null;
  // Raw tool arguments (JSON objects/arrays) are noise in the activity card.
  if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(detail)) return null;
  return truncate(detail, 220);
}

/** Parse "6/20 …" download progress from a task step's detail. */
function downloadProgress(detail: string | undefined): { done: number; total: number } | null {
  const match = /^(\d+)\s*\/\s*(\d+)\b/.exec((detail ?? "").trim());
  if (!match) return null;
  const done = Number(match[1]);
  const total = Number(match[2]);
  return total > 0 ? { done, total } : null;
}

/** Files the built-in player can handle. */
function isPlayable(name: string): boolean {
  return /\.(mp4|webm|m4v|mov|mp3|m4a|aac|ogg|wav)$/i.test(name);
}

/** "Song – Artist [id].mp4" → "Song – Artist" for a cleaner list. */
function prettyFileName(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s*\[[A-Za-z0-9_-]{6,}\]\s*$/, "")
    .trim();
}

/** A signed share token embedded in a message as `/shared/<token>`. */
function sharedTokenOf(text: string): string | null {
  const match = /\/shared\/([A-Za-z0-9._-]+)/.exec(text);
  return match ? match[1] : null;
}

/** Library category tabs (id matches `mediaKind`, plus "all"). */
const LIBRARY_CATS = [
  ["all", "All"],
  ["video", "Videos"],
  ["audio", "Audio"],
  ["image", "Images"],
  ["file", "Files"],
] as const;

/** Group items by their date label (Telegram-style date separators). */
function groupByDate<T>(items: T[], stamp: (item: T) => string | undefined): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const raw = stamp(item);
    const key = raw ? new Date(raw).toLocaleDateString() : "Unknown date";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()];
}
