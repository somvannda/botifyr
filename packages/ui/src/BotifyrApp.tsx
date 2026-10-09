import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  LearnedSkill,
  Quest,
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
import {
  AuthError,
  BotifyrClient,
  deriveSharedKey,
  isSealedMessage,
  loadOrCreateDeviceKeys,
  openMessage,
  type Conversation,
  type DeviceKeyPair,
  type MediaItem,
  type Person,
  type SealedMessage,
} from "@botifyr/client";
import { CalendarIcon, DriveIcon, GmailIcon } from "./AppIcons";
import { GithubBrand, NotionBrand, SlackBrand, TelegramBrand } from "./BrandIcons";
import { BOT_SCHEMES, BotLogo } from "./BotLogo";
import {
  BellIcon,
  CameraIcon,
  ChartIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  CopyIcon,
  CubeIcon,
  DownloadIcon,
  ForwardIcon,
  GearIcon,
  HelpIcon,
  LockIcon,
  LogoutIcon,
  MenuIcon,
  MessageIcon,
  MicIcon,
  MobileIcon,
  MonitorIcon,
  MoonIcon,
  MoreIcon,
  PanelIcon,
  PauseIcon,
  PhoneIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  ReplyIcon,
  SparkIcon,
  SearchIcon,
  SendIcon,
  SmileyIcon,
  StopIcon,
  SunIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
} from "./Icons";
import { Markdown } from "./Markdown";
import { FeedRail, FeedView } from "./FeedView";
import { CompanyWorkspace } from "./CompanyWorkspace";
import { ErrorBoundary } from "./ErrorBoundary";
import { P2P, deviceId, saveBlob, setIceServers } from "./p2p";
import { defaultBridge, type BotBridge } from "./bridge";
import { mergeTask } from "./taskMerge";
import { attachmentBucket, mediaKind, type MediaKind } from "./mediaUtils";
import type { AgentActivity } from "./office3d/layout";
import type { OfficeAgent } from "./office3d/OfficeView";
import "./styles.css";

/** The 3D office pulls in three.js — load it only when the CEO opens it. */
const LazyOfficeView = lazy(() => import("./office3d/OfficeView"));

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

/** Local calendar day key (YYYY-MM-DD) used to group messages by date. */
export function dayKeyOf(iso: string | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** "Today" / "Yesterday" / a readable date, for thread date separators. */
export function dayLabelOf(iso: string | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKeyOf(iso) === dayKeyOf(today.toISOString())) return "Today";
  if (dayKeyOf(iso) === dayKeyOf(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Wall-clock time for a message (e.g. "09:03"). */
export function clockOf(iso: string | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Index of the first incoming message newer than the read boundary, or -1 when
 * there is no boundary or nothing new. Used to place the "New messages" divider.
 */
export function firstUnreadIndex(
  messages: Array<{ senderId?: string; createdAt?: string }>,
  boundary: string | undefined,
  selfId: string | undefined,
): number {
  if (!boundary) return -1;
  return messages.findIndex(
    (message) =>
      Boolean(message.senderId && message.senderId !== selfId) &&
      Boolean(message.createdAt && message.createdAt > boundary),
  );
}

type ConnectionState = "connecting" | "online" | "offline";

/** A transient in-app notification (incoming message or finished task). */
interface Toast {
  id: string;
  kind: "message" | "task";
  title: string;
  body: string;
  sessionId?: string;
  /** For message notifications: the source message, so a later decrypt can update the body. */
  messageId?: string;
  /** For friend-request notifications: the request to accept or decline. */
  requestId?: string;
  /** For feed notifications: clicking opens the Feed tab. */
  feed?: boolean;
}

/** A stored notification shown in the header notification centre. */
interface AppNotification extends Toast {
  at: string;
  read: boolean;
}

/**
 * DOM id of the optional OS title-bar slot. Hosts that render a custom title
 * bar (the desktop app) expose this element so the shared app can teleport the
 * notification centre into it; hosts without a title bar leave it absent and
 * the bell stays in the chat topbar. See AGENTS.md §7.
 */
export const TITLEBAR_SLOT_ID = "botifyr-titlebar-slot";

const NOTIFICATIONS_KEY = "botifyr.notifications";
const SEEN_MESSAGES_KEY = "botifyr.seenMessages";

/** Marker prefix for an end-to-end encrypted DM body (E2E1:<sealed json>). */
const E2E_PREFIX = "E2E1:";

function parseSealed(content: string): SealedMessage | null {
  if (!content.startsWith(E2E_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(content.slice(E2E_PREFIX.length));
    return isSealedMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Human-readable body: decrypted plaintext when available, else a placeholder. */
function displayText(decryptedContent: Record<string, string>, content: string, id: string): string {
  const value = decryptedContent[id] ?? content;
  return parseSealed(value) ? "🔒 Encrypted message" : value;
}

const SETTINGS_TABS = [
  { id: "profile", label: "Profile", icon: <UserIcon size={16} /> },
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
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  void modelNotice; // referenced; surfaced in the UI as that work lands
  const [limitWarning, setLimitWarning] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [useComputer, setUseComputer] = useState(() => localStorage.getItem("botifyr.useComputer") === "1");

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  /** On narrow screens the conversation list becomes an off-canvas drawer. */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavBtnRef = useRef<HTMLButtonElement | null>(null);
  const wasMobileNavOpen = useRef(false);
  const [newChatTab, setNewChatTab] = useState<"contacts" | "chats" | "calls">("chats");
  const [newChatQuery, setNewChatQuery] = useState("");
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
  /** readAt as it was when each open conversation was entered — the boundary
      above which a "New messages" divider is drawn. */
  const [newMsgSince, setNewMsgSince] = useState<Record<string, string>>({});
  /** Ephemeral peer-typing state per conversation (userId + when last seen). */
  const [typing, setTyping] = useState<Record<string, { userId: string; at: number }>>({});
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
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [contactMediaFilter, setContactMediaFilter] = useState<"all" | "photo" | "video" | "voice" | "file">(
    "all",
  );
  // Per-chat auto-translate: sessionId -> target language (absent = off).
  const [translateLangs, setTranslateLangs] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("botifyr.translate") ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [groupTitleDraft, setGroupTitleDraft] = useState("");
  const [addMemberId, setAddMemberId] = useState("");
  // conversationId -> (userId -> last-read ISO) for read receipts.
  const [readReceipts, setReadReceipts] = useState<Record<string, Record<string, string>>>({});
  // Referenced (wired into the UI as that work lands).
  void readReceipts;
  void openBoard;
  const [lightbox, setLightbox] = useState<{
    items: { token: string; name: string }[];
    index: number;
  } | null>(null);
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
  const hasConnectedRef = useRef(false);
  /** Friend-request ids already surfaced (or seeded) so we never double-notify. */
  const seenRequestsRef = useRef<Set<string>>(new Set());
  const requestsSeededRef = useRef(false);
  const notifWrapRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountBtnRef = useRef<HTMLButtonElement | null>(null);
  const dmKeysRef = useRef<Map<string, CryptoKey>>(new Map());
  const myKeysRef = useRef<DeviceKeyPair | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** Message ids that already failed to translate (don't retry — avoids hammering). */
  const translateFailedRef = useRef<Set<string>>(new Set());
  /** The group whose title was last seeded into the rename input. */
  const seededGroupRef = useRef<string | null>(null);
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  // When the host renders an OS title bar with a slot, the notification centre
  // is teleported there; otherwise it renders inline in the chat topbar.
  const [titlebarSlot, setTitlebarSlot] = useState<HTMLElement | null>(null);
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
  /** Bumped to open the Startup Workspace's inline "new company" flow. */
  const [companyCreateNonce, setCompanyCreateNonce] = useState(0);
  const [companyBusy, setCompanyBusy] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companyEdit, setCompanyEdit] = useState<{ id: string; name: string } | null>(null);
  const [confirmCompanyDelete, setConfirmCompanyDelete] = useState(false);
  const [confirmClearBoard, setConfirmClearBoard] = useState(false);
  const [boardWorkspace, setBoardWorkspace] = useState<{ id: string; name: string } | null>(null);
  /** Company the Startup Workspace should focus (set by the sidebar board button). */
  const [startupFocusId, setStartupFocusId] = useState<string | null>(null);
  // The Company HQ opens as a full main area by default; "Float" turns it into a
  // smaller, movable panel over the chat.
  const [, setHqFloating] = useState(false);
  const [, setHqPos] = useState({ x: 0, y: 0 });
  /** Company shown in the 3D office. Kept separate from the HQ dialog. */
  const [officeCompany, setOfficeCompany] = useState<{ id: string; name: string } | null>(null);
  const [showOffice3d, setShowOffice3d] = useState(false);
  const [office3dDock, setOffice3dDock] = useState(true);
  const [boardItems, setBoardItems] = useState<Array<WorkItem>>([]);
  const [, setBoardTitle] = useState("");
  const [, setBoardBusy] = useState(false);
  const [, setHqTab] = useState<
    "briefing" | "need" | "team" | "board" | "budget" | "standup" | "plans" | "changes" | "office" | "wiki"
  >("briefing");
  const [, setHqNeeds] = useState<Array<Task>>([]);
  const [, setHqBudget] = useState<WorkspaceBudget | null>(null);
  const [, setBudgetInput] = useState("");
  const [, setHqGrants] = useState<Array<CapabilityGrant>>([]);
  const [hqReports, setHqReports] = useState<Array<CompanyReport>>([]);
  const [, setHqQuests] = useState<Array<Quest>>([]);
  /** When the CEO last opened this company's HQ — drives the "since your last visit" delta. */
  const [lastVisitAt, setLastVisitAt] = useState<string | null>(null);
  const [, setHqWiki] = useState<Array<{ id: string; name: string; content: string; department?: string }>>(
    [],
  );
  const [filePreview, setFilePreview] = useState<{ name: string; content: string } | null>(null);
  const [, setHqChanges] = useState<
    Array<{ repo: string; path: string; content: string; diff: string; exists: boolean }>
  >([]);
  const [, setAddMemberBotId] = useState("");
  const [, setHoursStart] = useState("9");
  const [, setHoursEnd] = useState("18");
  const [, setHoursWeekdays] = useState(true);
  const [, setHoursTimezone] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  /** Composer emoji picker (separate from the bot-editor picker). */
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);
  const [botName, setBotName] = useState("");
  const [botEmoji, setBotEmoji] = useState("🤖");
  const [botScheme, setBotScheme] = useState(0);
  const [botIntro, setBotIntro] = useState("");
  const [botWorkspace, setBotWorkspace] = useState("");
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>({});
  const [workspaceFilter, setWorkspaceFilter] = useState("personal");
  /** Permalink target from `#post=<id>`; the Feed scrolls to and highlights it. */
  const [feedFocusPost, setFeedFocusPost] = useState<string | null>(null);

  // Open a shared post link (`#post=<id>`) directly in the Feed.
  useEffect(() => {
    function readHash() {
      const match = /(?:^#|[#&])post=([^&]+)/.exec(window.location.hash);
      if (!match) return;
      const id = decodeURIComponent(match[1]);
      if (!id) return;
      setWorkspaceFilter("feed");
      setFeedFocusPost(id);
    }
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);
  /** Bumped on any feed event so an open Feed reloads (Phase 3 realtime). */
  const [feedRefresh, setFeedRefresh] = useState(0);
  /** When set, the Feed area shows this Page's timeline instead of the feed. */
  const [feedPage, setFeedPage] = useState<string | null>(null);
  /** When set, the Feed area shows this Group's stream instead of the feed. */
  const [feedGroup, setFeedGroup] = useState<string | null>(null);
  /** When set, the Feed area shows this album instead of the feed. */
  const [feedAlbum, setFeedAlbum] = useState<string | null>(null);
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
  const [peopleTab, setPeopleTab] = useState<"contacts" | "chats" | "calls">("contacts");
  const [groupName, setGroupName] = useState("");
  const [groupSelection, setGroupSelection] = useState<string[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileHandle, setProfileHandle] = useState("");
  const [profileEmoji, setProfileEmoji] = useState("🙂");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | undefined>(undefined);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
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
  /** Provenance: tokens spent on the shown task. */
  const [taskUsage, setTaskUsage] = useState<{ tokens: number; requests: number } | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findPos, setFindPos] = useState(0);

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeSessionId;
  const activeBotIdRef = useRef<string | null>(null);
  activeBotIdRef.current = activeBotId;
  const botsRef = useRef<Bot[]>([]);
  botsRef.current = bots;
  const sidebarRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardWorkspaceRef = useRef<{ id: string; name: string } | null>(null);
  boardWorkspaceRef.current = boardWorkspace;

  /**
   * Employees for the 3D office: the latest task per bot decides live activity.
   * Derived from state we already hold, so opening the office costs no requests.
   */
  const officeAgents = useMemo<OfficeAgent[]>(() => {
    if (!officeCompany) return [];
    const workspace = workspaces.find((entry) => entry.name === officeCompany.name);
    if (!workspace) return [];

    const latestBySession = new Map<string, Task>();
    for (const task of Object.values(tasks)) {
      const current = latestBySession.get(task.sessionId);
      if (!current || current.updatedAt < task.updatedAt) latestBySession.set(task.sessionId, task);
    }

    return workspace.roles.flatMap((role) => {
      const bot = bots.find((entry) => entry.id === role.botId);
      if (!bot) return [];
      const task = latestBySession.get(bot.sessionId);
      const activity: AgentActivity = task && task.status !== "cancelled" ? task.status : "idle";
      return [
        {
          botId: bot.id,
          name: bot.name,
          emoji: bot.emoji,
          title: role.title,
          department: role.department,
          activity,
        },
      ];
    });
  }, [officeCompany, workspaces, tasks, bots]);

  /** The 3D office, rendered either as a docked side panel or a floating overlay. */
  const renderOffice = (docked: boolean) => (
    <ErrorBoundary
      fallback={
        <div className={docked ? "office3d-dock-root" : "office3d-overlay"} role="presentation">
          <div className="office3d-panel">
            <div className="office3d-head">
              <span className="office3d-title">3D office unavailable</span>
              <button
                className="round small"
                type="button"
                onClick={() => setShowOffice3d(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="company-hint">
              The 3D office failed to render. The Office tab still lists every employee.
            </p>
          </div>
        </div>
      }
    >
      <LazyOfficeView
        company={officeCompany?.name ?? ""}
        agents={officeAgents}
        paused={
          (workspaces.find((entry) => entry.name === officeCompany?.name)?.status ?? "active") === "paused"
        }
        docked={docked}
        onToggleDock={() => setOffice3dDock((value) => !value)}
        onClose={() => setShowOffice3d(false)}
        onSelect={(botId) => {
          const bot = bots.find((entry) => entry.id === botId);
          if (bot) {
            setShowOffice3d(false);
            openEmployee(bot);
          }
        }}
      />
    </ErrorBoundary>
  );

  /** The same employee list the office uses, for any company (not just the open one). */
  function agentsForCompany(companyName: string): OfficeAgent[] {
    const workspace = workspaces.find((entry) => entry.name === companyName);
    if (!workspace) return [];
    const latestBySession = new Map<string, Task>();
    for (const task of Object.values(tasks)) {
      const current = latestBySession.get(task.sessionId);
      if (!current || current.updatedAt < task.updatedAt) latestBySession.set(task.sessionId, task);
    }
    return workspace.roles.flatMap((role) => {
      const bot = bots.find((entry) => entry.id === role.botId);
      if (!bot) return [];
      const task = latestBySession.get(bot.sessionId);
      const activity: AgentActivity = task && task.status !== "cancelled" ? task.status : "idle";
      return [
        {
          botId: bot.id,
          name: bot.name,
          emoji: bot.emoji,
          title: role.title,
          department: role.department,
          activity,
        },
      ];
    });
  }

  /** The 3D office embedded inside the Startup Workspace pane (no dock/close chrome). */
  const renderOfficeEmbedded = (company: { id: string; name: string }) => (
    <ErrorBoundary
      fallback={
        <div className="office3d-dock-root" role="presentation">
          <div className="office3d-panel">
            <div className="office3d-head">
              <span className="office3d-title">3D office unavailable</span>
            </div>
            <p className="company-hint">The Office tab still lists every employee.</p>
          </div>
        </div>
      }
    >
      <LazyOfficeView
        company={company.name}
        agents={agentsForCompany(company.name)}
        paused={(workspaces.find((entry) => entry.name === company.name)?.status ?? "active") === "paused"}
        docked
        onClose={() => undefined}
        onSelect={(botId) => {
          const bot = bots.find((entry) => entry.id === botId);
          if (bot) openEmployee(bot);
        }}
      />
    </ErrorBoundary>
  );

  /**
   * The office is "open" only when it also has a company to show. Deriving this
   * once keeps the grid class and the rendered aside in lock-step — a mismatch
   * here is what previously collapsed the chat column to a sliver.
   */
  const officeOpen = showOffice3d && officeCompany !== null;
  const officeDocked = officeOpen && office3dDock;

  const nodeStartedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cancelSigninRef = useRef(false);
  /** Whether the transcript is pinned to the newest message (avoids yanking
      readers to the bottom when a new message arrives while they scroll up). */
  const atBottomRef = useRef(true);
  /** Throttle for outbound typing signals, keyed by conversation. */
  const typingSentAtRef = useRef<Record<string, number>>({});
  const [atBottom, setAtBottom] = useState(true);
  const [newWhileAway, setNewWhileAway] = useState(0);

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

  // Pull anything missed while the realtime socket was down (offline/reconnect):
  // refresh bot threads and human conversations and merge them in.
  const resyncConversations = useCallback(async (): Promise<void> => {
    try {
      const [sessionList, convos] = await Promise.all([
        client.listSessions(),
        client.listConversations().catch(() => [] as Conversation[]),
      ]);
      setSessions((prev) => {
        const byId = new Map(prev.map((session) => [session.id, session]));
        for (const session of sessionList) byId.set(session.id, session);
        for (const convo of convos) {
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
        onOpen: () => {
          if (!mounted) return;
          setConnection("online");
          // On a reconnect (not the first connect), catch up on anything we
          // missed while the socket was down.
          if (hasConnectedRef.current) void resyncConversations();
          hasConnectedRef.current = true;
        },
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

    // Publish this device's public E2E key so peers can encrypt DMs to us.
    void (async () => {
      try {
        const keys = await loadOrCreateDeviceKeys(localStorage);
        await client.registerDeviceKey(myDeviceId, keys.publicKey);
      } catch {
        // DM encryption is best-effort; never block the app.
      }
    })();

    return () => {
      mounted = false;
      window.clearInterval(configTimer);
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, client]);

  // Pin the transcript to the newest message — but only when the reader is
  // already at the bottom, so scrolling back through history isn't interrupted.
  const activeMessageCount = sessions.find((session) => session.id === activeSessionId)?.messages.length ?? 0;

  const onContentScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    atBottomRef.current = nearBottom;
    setAtBottom(nearBottom);
    if (nearBottom) setNewWhileAway(0);
  };

  const jumpToLatest = () => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
    setNewWhileAway(0);
    // Reaching the newest message clears the "New messages" marker.
    if (activeSessionId) {
      setNewMsgSince((prev) => {
        if (!(activeSessionId in prev)) return prev;
        const next = { ...prev };
        delete next[activeSessionId];
        return next;
      });
    }
  };

  // Opening a conversation always starts at the newest message.
  useEffect(() => {
    atBottomRef.current = true;
    setAtBottom(true);
    setNewWhileAway(0);
  }, [activeSessionId]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (atBottomRef.current) {
      element.scrollTop = element.scrollHeight;
    } else {
      setNewWhileAway((count) => count + 1);
    }
  }, [activeSessionId, activeMessageCount]);

  useEffect(() => {
    localStorage.setItem("botifyr.useComputer", useComputer ? "1" : "0");
  }, [useComputer]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    setHistoryIndex(null);
    // Picking a conversation closes the narrow-screen drawer.
    setMobileNavOpen(false);
  }, [activeSessionId]);

  // Escape closes the narrow-screen conversation drawer.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  // Return focus to the menu button when the drawer closes.
  useEffect(() => {
    if (wasMobileNavOpen.current && !mobileNavOpen) mobileNavBtnRef.current?.focus();
    wasMobileNavOpen.current = mobileNavOpen;
  }, [mobileNavOpen]);

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
          // A delivered message ends the peer's "typing" indicator immediately.
          if (last?.senderId && last.senderId !== user?.id) {
            setTyping((prev) => {
              if (!(event.session.id in prev)) return prev;
              const next = { ...prev };
              delete next[event.session.id];
              return next;
            });
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
        // The company's roles/roster changed, so pull workspaces too.
        scheduleSidebarRefresh();
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
        // Keep an open Company HQ board live as agents move items.
        if (event.type === "task.completed" || event.type === "task.failed") {
          const board = boardWorkspaceRef.current;
          if (board) {
            void refreshBoard(board.id);
            void refreshNeeds(board.id);
          }
        }
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
      case "typing": {
        const key = event.sessionId;
        setTyping((prev) => ({ ...prev, [key]: { userId: event.userId, at: Date.now() } }));
        // Expire the indicator if no fresh signal arrives within a few seconds.
        window.setTimeout(
          () =>
            setTyping((prev) => {
              const current = prev[key];
              if (!current || Date.now() - current.at < 3500) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            }),
          4000,
        );
        break;
      }
      case "feed.post":
        setFeedRefresh((prev) => prev + 1);
        break;
      case "feed.mention": {
        setFeedRefresh((prev) => prev + 1);
        if (event.toUserId !== user?.id) break;
        const who = event.fromName?.trim() || "Someone";
        pushToast({
          kind: "message",
          title: "New mention",
          body: `${who} mentioned you in a post.`,
          feed: true,
        });
        break;
      }
      case "feed.like":
      case "feed.comment":
      case "feed.share": {
        setFeedRefresh((prev) => prev + 1);
        if (event.toUserId !== user?.id) break;
        const who = event.fromName?.trim() || "Someone";
        const title =
          event.type === "feed.like"
            ? "New like"
            : event.type === "feed.comment"
              ? "New comment"
              : "New share";
        const verb =
          event.type === "feed.like" ? "liked" : event.type === "feed.comment" ? "commented on" : "shared";
        pushToast({ kind: "message", title, body: `${who} ${verb} your post.`, feed: true });
        break;
      }
    }
  }

  /** Open the conversation a notification points at. */
  function openSessionById(sessionId: string): void {
    const bot = bots.find((entry) => entry.sessionId === sessionId);
    if (bot) {
      selectBot(bot);
      return;
    }
    exitFeed();
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

  function dismissNotification(id: string): void {
    setNotifications((prev) => {
      const next = prev.filter((entry) => entry.id !== id);
      try {
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  /** Mark one notification read (so opening it clears it from the bell badge). */
  function markNotificationRead(id: string): void {
    setNotifications((prev) => {
      let changed = false;
      const next = prev.map((entry) => {
        if (entry.id !== id || entry.read) return entry;
        changed = true;
        return { ...entry, read: true };
      });
      if (!changed) return prev;
      try {
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Close the notification panel when clicking anywhere outside it.
  useEffect(() => {
    if (!notifOpen) return;
    const onDown = (event: MouseEvent) => {
      if (notifWrapRef.current && !notifWrapRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [notifOpen]);

  // Close the account menu when clicking anywhere outside it (or its trigger).
  useEffect(() => {
    if (!showAccountMenu) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (accountMenuRef.current?.contains(target)) return;
      if (accountBtnRef.current?.contains(target)) return;
      setShowAccountMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showAccountMenu]);

  const getDmKey = useCallback(
    async (session: { id: string; participants?: string[] }): Promise<CryptoKey | null> => {
      const cached = dmKeysRef.current.get(session.id);
      if (cached) return cached;
      const peerId = (session.participants ?? []).find((id) => id !== user?.id);
      if (!peerId) return null;
      const keys = await client.listDeviceKeys(peerId).catch(() => []);
      const peer = keys[0]?.publicKey;
      if (!peer) return null;
      if (!myKeysRef.current) myKeysRef.current = await loadOrCreateDeviceKeys(localStorage);
      const key = await deriveSharedKey(myKeysRef.current.privateKey, peer as JsonWebKey);
      dmKeysRef.current.set(session.id, key);
      return key;
    },
    [client, user?.id],
  );

  // Decrypt end-to-end encrypted DM bodies. We decrypt every DM (not just the
  // open one) so notifications and conversation previews can show plaintext.
  useEffect(() => {
    if (!user) return;
    const pending: Array<{ session: Session; message: Session["messages"][number] }> = [];
    for (const session of sessions) {
      if (session.kind !== "dm") continue;
      for (const message of session.messages) {
        if (parseSealed(message.content) && !decrypted[message.id]) {
          pending.push({ session, message });
        }
      }
    }
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const entries: Record<string, string> = {};
        for (const { session, message } of pending) {
          const envelope = parseSealed(message.content);
          if (!envelope) continue;
          try {
            const key = await getDmKey(session);
            if (!key) continue;
            entries[message.id] = await openMessage(key, envelope);
          } catch {
            // wrong key / tampered — leave the ciphertext as-is
          }
        }
        if (!cancelled && Object.keys(entries).length > 0) {
          setDecrypted((prev) => ({ ...prev, ...entries }));
        }
      } catch {
        // DM encryption is best-effort.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions, user, decrypted, getDmKey]);

  // Persist the per-chat translate language choices.
  useEffect(() => {
    try {
      localStorage.setItem("botifyr.translate", JSON.stringify(translateLangs));
    } catch {
      // ignore
    }
  }, [translateLangs]);

  // Auto-translate incoming messages in the open chat when a language is set.
  useEffect(() => {
    const lang = activeSessionId ? translateLangs[activeSessionId] : undefined;
    const session = sessions.find((entry) => entry.id === activeSessionId);
    if (!lang || !session || !user || (session.kind !== "dm" && session.kind !== "group")) return;
    let cancelled = false;
    void (async () => {
      for (const message of session.messages) {
        if (!message.senderId || message.senderId === user.id) continue;
        if (translations[message.id]) continue;
        if (translateFailedRef.current.has(message.id)) continue;
        const text = displayText(decrypted, message.content, message.id).trim();
        if (!text || sharedTokenOf(text)) continue;
        try {
          const result = await client.translate(text.slice(0, 2000), lang);
          if (cancelled) return;
          setTranslations((prev) => ({ ...prev, [message.id]: result.text }));
        } catch (err: unknown) {
          // The model is unavailable — stop, don't retry, and tell the user.
          translateFailedRef.current.add(message.id);
          noteModelError(err);
          setError(`Translation unavailable: ${messageOf(err)}`);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, translateLangs, sessions, user, decrypted, translations, client]);

  // Pick up the host's title-bar slot once it is mounted (desktop only).
  useEffect(() => {
    if (typeof document === "undefined") return;
    setTitlebarSlot(document.getElementById(TITLEBAR_SLOT_ID));
  }, []);

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

    // On the web, open the sign-in window *synchronously*, still inside the
    // click, so popup blockers allow it — we point it at the cloud once config
    // is checked. Desktop opens the system browser instead and returns by
    // polling (later focusing its own window).
    const isWeb = bridge.kind === "web";
    let popup: Window | null = null;
    if (isWeb) {
      try {
        popup = window.open("about:blank", "botifyr-signin", "popup,width=520,height=680");
      } catch {
        popup = null;
      }
    }

    try {
      const cfg = await client.authConfig();
      if (!cfg.google) {
        setAuthError(
          "Google sign-in isn't configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the cloud.",
        );
        popup?.close();
        return;
      }

      // The host prefix tells the cloud who started sign-in, so its callback
      // page can send a browser user back to the portal instead of the desktop
      // app. The admin console uses the same trick with `admin:`.
      const state = `${isWeb ? "web" : "desktop"}:${crypto.randomUUID()}`;
      localStorage.setItem(PENDING_KEY, state);
      const url = `${CLOUD_URL}/auth/google?state=${encodeURIComponent(state)}`;
      setSigninUrl(url);
      if (popup) popup.location.href = url;
      else await openExternal(url);

      const ok = await pollForToken(state);
      if (!ok) setAuthError("Sign-in timed out. Please try again.");
    } catch (err: unknown) {
      popup?.close();
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

  /** Leave the Feed workspace when a conversation is picked from the sidebar. */
  function exitFeed(): void {
    setWorkspaceFilter((current) => (current === "feed" ? "personal" : current));
  }

  function selectBot(bot: Bot) {
    exitFeed();
    setActiveBotId(bot.id);
    setActiveSessionId(bot.sessionId);
    setShowAudit(false);
    setShowNewChat(false);
  }

  /** Open the Startup Workspace and start its inline "new company" flow. */
  function startCompanyFlow() {
    setCompanyCreateNonce((nonce) => nonce + 1);
    setWorkspaceFilter("startups");
    setShowNewChat(false);
  }

  /** A company was created inside the Startup Workspace → refresh and focus it. */
  async function handleCompanyCreated(created: WorkspaceWithRoles) {
    const [botList, workspaceList] = await Promise.all([client.listBots(), client.listWorkspaces()]);
    setBots(botList);
    setWorkspaces(workspaceList);
    setStartupFocusId(created.id);
    setWorkspaceFilter("startups");
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
      if (officeCompany?.id === companyEdit.id) {
        setOfficeCompany(null);
        setShowOffice3d(false);
      }
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
    setHqTab("briefing");
    // Remember when the CEO last visited, to compute the "since your last visit" delta.
    try {
      const key = `botifyr.lastVisit.${workspaceId}`;
      setLastVisitAt(localStorage.getItem(key));
      localStorage.setItem(key, new Date().toISOString());
    } catch {
      setLastVisitAt(null);
    }
    setHqFloating(false);
    setHqPos({ x: 0, y: 0 });
    setAddMemberBotId("");
    try {
      const [items, needs, budget, grants, reports, quests] = await Promise.all([
        client.listWorkItems(workspaceId).catch(() => []),
        client.listWorkspaceNeeds(workspaceId).catch(() => []),
        client.getWorkspaceBudget(workspaceId).catch(() => null),
        client.listCapabilityGrants(workspaceId).catch(() => []),
        client.listCompanyReports(workspaceId).catch(() => []),
        client.listQuests(workspaceId).catch(() => []),
      ]);
      setBoardItems(items);
      setHqNeeds(needs);
      setHqBudget(budget);
      setBudgetInput(budget && budget.limitTokens > 0 ? String(budget.limitTokens) : "");
      setHqGrants(grants);
      setHqReports(reports);
      setHqQuests(quests);
      const hours = workspaces.find((entry) => entry.id === workspaceId)?.operatingHours;
      setHoursStart(hours ? String(hours.start) : "9");
      setHoursEnd(hours ? String(hours.end) : "18");
      setHoursWeekdays(hours ? Boolean(hours.days && hours.days.length > 0) : true);
      setHoursTimezone(hours?.timezone ?? "");

      // Company wiki: the chair bot's Library (BRIEF / OKRS / BACKLOG).
      const wiki = await client.listWorkspaceFiles(workspaceId).catch(() => []);
      setHqWiki(
        wiki.map((file) => ({
          id: file.id,
          name: file.name,
          content: file.content,
          department: file.department,
        })),
      );
      setHqChanges(await client.listProposals(workspaceId).catch(() => []));
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
    setHqChanges([]);
    setAddMemberBotId("");
  }

  /** Open the 3D office for a company, docked beside the chat — without the HQ dialog. */
  function openOffice(company: { id: string; name: string }) {
    closeBoard();
    setOfficeCompany(company);
    setShowOffice3d(true);
  }

  /** Open an employee's live screen (their sandbox desktop) from the Office tab. */
  function openEmployee(bot: Bot) {
    closeBoard();
    selectBot(bot);
    setShowBotPanel(true);
    setBotPanelTab("computer");
    void client.startComputer(bot.sessionId).catch(() => {});
  }

  /** Open a file referenced in chat: company wiki first, else the bot's Library. */
  async function openFileRef(name: string) {
    setFilePreview({ name, content: "Loading…" });
    const company = activeBot?.workspace
      ? workspaces.find((entry) => entry.name === activeBot.workspace)
      : undefined;
    if (company) {
      const wiki = await client.listWorkspaceFiles(company.id).catch(() => []);
      const hit = wiki.find((file) => file.name.toLowerCase() === name.toLowerCase());
      if (hit) {
        setFilePreview({ name: hit.name, content: hit.content });
        return;
      }
    }
    if (activeBotId) {
      const files = await client.listFiles(activeBotId).catch(() => []);
      const hit = files.find((file) => file.name.toLowerCase() === name.toLowerCase());
      if (hit) {
        const full = await client.getFile(hit.id).catch(() => null);
        setFilePreview({ name: hit.name, content: full?.content ?? "(no content)" });
        return;
      }
    }
    setFilePreview({
      name,
      content: `"${name}" isn't in the company wiki or this bot's Library yet.`,
    });
  }

  /** Remove every task from the company board. */
  async function clearBoard() {
    const workspace = boardWorkspace;
    if (!workspace) return;
    setBoardBusy(true);
    try {
      await client.clearWorkItems(workspace.id).catch(() => null);
      setBoardItems(await client.listWorkItems(workspace.id).catch(() => []));
    } finally {
      setBoardBusy(false);
    }
  }

  async function refreshNeeds(workspaceId: string) {
    setHqNeeds(await client.listWorkspaceNeeds(workspaceId).catch(() => []));
  }

  async function refreshBoard(workspaceId: string) {
    setBoardItems(await client.listWorkItems(workspaceId).catch(() => []));
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

  /** Delete a personal conversation from the sidebar and the server. */
  async function removeChat(session: Session): Promise<void> {
    setConfirmDeleteId(null);
    const dropLocally = () => {
      setSessions((prev) => prev.filter((entry) => entry.id !== session.id));
      setActiveSessionId((cur) => (cur === session.id ? null : cur));
    };
    try {
      await client.deleteConversation(session.id);
      dropLocally();
    } catch (err: unknown) {
      // A conversation that is already gone still needs to leave the sidebar.
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
      const session = sessions.find((entry) => entry.id === sessionId);
      const activeKind = session?.kind;
      // Direct messages are sent in plaintext so conversations stay readable
      // across devices and after key rotation (E2E for DMs was dropped).
      const result =
        activeKind === "dm" || activeKind === "group"
          ? await client.sendDm(sessionId, payload)
          : await client.sendMessage(sessionId, payload, useComputer);
      const updated = result.session;
      const warning = (result as { warning?: string }).warning;
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setLimitWarning(warning ?? null);
    } catch (err: unknown) {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? { ...session, messages: session.messages.filter((message) => message.id !== optimisticId) }
            : session,
        ),
      );
      noteModelError(err);
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

  /** Tell the other participants (throttled) that this user is typing. */
  function pingTyping() {
    const session = sessions.find((entry) => entry.id === activeSessionId);
    if (!session || (session.kind !== "dm" && session.kind !== "group")) return;
    const now = Date.now();
    if (now - (typingSentAtRef.current[session.id] ?? 0) < 2500) return;
    typingSentAtRef.current[session.id] = now;
    void client.sendTyping(session.id).catch(() => {});
  }

  function onComposerChange(value: string) {
    setText(value);
    if (value.trim()) pingTyping();
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

  /** Aggregate a message's reactions into chips (emoji + count + whether ours). */
  function reactionChips(message: ChatMessage): { emoji: string; count: number; mine: boolean }[] {
    const byEmoji = new Map<string, { count: number; mine: boolean }>();
    for (const [uid, emoji] of Object.entries(message.reactions ?? {})) {
      const entry = byEmoji.get(emoji) ?? { count: 0, mine: false };
      entry.count += 1;
      if (uid === user?.id) entry.mine = true;
      byEmoji.set(emoji, entry);
    }
    return [...byEmoji.entries()].map(([emoji, entry]) => ({ emoji, ...entry }));
  }

  async function toggleReaction(id: string, emoji: string) {
    setReactFor(null);
    const session = sessions.find((entry) => entry.messages.some((message) => message.id === id));
    if (!session || !user) return;
    const message = session.messages.find((entry) => entry.id === id);
    if (!message) return;
    const next = message.reactions?.[user.id] === emoji ? "" : emoji;
    // Optimistic update, then persist server-side so peers see it.
    setSessions((prev) =>
      prev.map((entry) =>
        entry.id !== session.id
          ? entry
          : {
              ...entry,
              messages: entry.messages.map((m) => {
                if (m.id !== id) return m;
                const reactions = { ...(m.reactions ?? {}) };
                if (next) reactions[user.id] = next;
                else delete reactions[user.id];
                return { ...m, reactions };
              }),
            },
      ),
    );
    try {
      const updated = await client.setMessageReaction(session.id, id, next);
      setSessions((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (err: unknown) {
      setError(messageOf(err));
    }
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
          onClick={() => {
            setMoreFor(null);
            setReactFor((value) => (value === message.id ? null : message.id));
          }}
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
          onClick={() => {
            setReactFor(null);
            setMoreFor((value) => (value === message.id ? null : message.id));
          }}
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
      const [events, usage] = await Promise.all([
        client.listAudit(task.id),
        client.usageForTask(task.id).catch(() => null),
      ]);
      setAudit(events);
      setTaskUsage(usage);
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
  const firstNewIndex = activeSession
    ? firstUnreadIndex(visibleMessages, newMsgSince[activeSession.id], user?.id)
    : -1;

  // Reset the match position whenever the query changes.
  useEffect(() => {
    setFindPos(0);
  }, [findQuery]);

  // Scroll the current match into view while searching within the open chat.
  useEffect(() => {
    if (!findOpen || !findTerm || findMatches === 0) return;
    const nodes = document.querySelectorAll(".msg-user, .msg-assistant");
    const node = nodes[Math.min(findPos, nodes.length - 1)];
    node?.scrollIntoView({ block: "center" });
  }, [findPos, findTerm, findOpen, findMatches]);
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
    exitFeed();
    try {
      const session = await client.openDm(person.id);
      setSessions((prev) => {
        const exists = prev.some((entry) => entry.id === session.id);
        // Adopt the freshly fetched session (with its full history) instead of
        // keeping the empty summary placeholder from the conversation list.
        return exists ? prev.map((entry) => (entry.id === session.id ? session : entry)) : [session, ...prev];
      });
      setActiveBotId(null);
      setActiveSessionId(session.id);
      setShowPeople(false);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** After replying to a story, open that DM (docs/feed-next.md §FR-13). */
  function openStoryConversation(session: Session): void {
    exitFeed();
    setSessions((prev) => {
      const exists = prev.some((entry) => entry.id === session.id);
      return exists ? prev.map((entry) => (entry.id === session.id ? session : entry)) : [session, ...prev];
    });
    setActiveBotId(null);
    setActiveSessionId(session.id);
    setShowPeople(false);
  }

  /** Open an existing human conversation from the Chats list. */
  function openChat(session: Session): void {
    exitFeed();
    setActiveBotId(null);
    setActiveSessionId(session.id);
    setShowPeople(false);
  }

  /** Open the "start a chat" panel fresh (clear search, reset to Chats). */
  function openNewChat(): void {
    setNewChatQuery("");
    setNewChatTab("chats");
    setShowNewChat(true);
  }

  /** Share a downloaded file with a friend via a signed, recipient-scoped link. */
  async function shareWith(person: Person): Promise<void> {
    const item = shareItem;
    setShareItem(null);
    if (!item) return;
    try {
      const { token: shareToken } = await client.shareMedia(item.id, person.id);
      const session = await client.openDm(person.id);
      await client.sendDm(session.id, `📎 ${item.name}\n/shared/${shareToken}`);
      setSessions((prev) => (prev.some((entry) => entry.id === session.id) ? prev : [session, ...prev]));
      setActiveBotId(null);
      setActiveSessionId(session.id);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Attach one or more files to the open conversation (sent as an album). */
  async function attachFiles(items: MediaItem[]): Promise<void> {
    setAttachOpen(false);
    if (items.length === 0) return;
    const session = activeSession;
    if (!session || (session.kind !== "dm" && session.kind !== "group")) {
      setError("Files can be attached in personal chats (direct messages and groups).");
      return;
    }
    const recipients = (session.participants ?? []).filter((id) => id !== user?.id);
    if (recipients.length === 0) {
      setError("There is no one to share with in this chat.");
      return;
    }
    // Any text already typed in the composer becomes the album's caption.
    const caption = text.trim();
    try {
      for (const recipient of recipients) {
        const parts: string[] = [];
        for (const item of items) {
          const { token: shareToken } = await client.shareMedia(item.id, recipient);
          parts.push(`📎 ${item.name}\n/shared/${shareToken}`);
        }
        const body = `${parts.join("\n")}${caption ? `\n${caption}` : ""}`;
        const result = await client.sendDm(session.id, body);
        setSessions((prev) => prev.map((entry) => (entry.id === result.session.id ? result.session : entry)));
      }
      if (caption) setText("");
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Upload one or more local files, then attach them as an album. */
  async function uploadAndAttach(files: File[]): Promise<void> {
    setAttachOpen(false);
    if (files.length === 0) return;
    const tooBig = files.find((file) => file.size > 15 * 1024 * 1024);
    if (tooBig) {
      setError(`"${tooBig.name}" is too large — the limit is 15MB.`);
      return;
    }
    try {
      const items: MediaItem[] = [];
      for (const file of files) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("could not read the file"));
          reader.readAsDataURL(file);
        });
        items.push(await client.uploadFile({ name: file.name, mime: file.type, data: dataUrl }));
      }
      await attachFiles(items);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Record a voice note and send it as an audio attachment (Telegram-style). */
  async function toggleRecording(): Promise<void> {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Voice notes aren't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        recorderRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        const reader = new FileReader();
        reader.onload = () => {
          void (async () => {
            try {
              const item = await client.uploadFile({
                name: `voice-${Date.now()}.webm`,
                mime: blob.type,
                data: String(reader.result ?? ""),
              });
              await attachFiles([item]);
            } catch (err: unknown) {
              setError(messageOf(err));
            }
          })();
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Could not access the microphone.");
    }
  }

  /** Show a persistent notice when the model provider is down or out of credit. */
  function noteModelError(err: unknown): void {
    const text = messageOf(err);
    if (
      /insufficient balance|out of credit|\b(402|429|5\d\d)\b|model request failed|translation failed/i.test(
        text,
      )
    ) {
      setModelNotice(
        "The AI model is unavailable or out of credit. Chat and files still work, but translation and tasks are paused.",
      );
    }
  }

  async function saveProfile(): Promise<void> {
    try {
      const updated = await client.updateProfile({
        displayName: profileName.trim(),
        handle: profileHandle.trim().replace(/^@/, ""),
        avatarEmoji: profileEmoji.trim() || "🙂",
        avatarUrl: profileAvatarUrl ?? null,
      });
      setUser(updated);
      // Refresh the directory so the new name appears in conversations.
      void loadPeople();
      setCheckNote("Profile saved.");
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Downscale a chosen image to a small square data URL we can store on the profile. */
  async function chooseAvatar(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("That image is too large (max 10 MB).");
      return;
    }
    try {
      setProfileAvatarUrl(await downscaleImage(file, 256));
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
  // Human conversations (DMs and friend groups), most recently active first.
  const chatActivity = (session: Session): string =>
    session.messages[session.messages.length - 1]?.createdAt ?? session.createdAt;
  const humanChats = sessions
    .filter((session) => session.kind === "dm" || session.kind === "group")
    .sort((a, b) => chatActivity(b).localeCompare(chatActivity(a)));
  // One search box serves every tab of the "start a chat" panel.
  const newChatQ = newChatQuery.trim().toLowerCase();
  const matchingBots = newChatQ ? bots.filter((bot) => bot.name.toLowerCase().includes(newChatQ)) : bots;
  const matchingFriends = newChatQ
    ? friends.filter(
        (person) =>
          (person.displayName ?? "").toLowerCase().includes(newChatQ) ||
          (person.handle ?? "").toLowerCase().includes(newChatQ),
      )
    : friends;
  /** Display name for a human conversation (peer name for DMs, title for groups). */
  const humanChatName = (session: Session): string => {
    if (session.kind === "group") return session.title || "Group";
    const peerId = (session.participants ?? []).find((id) => id !== user?.id);
    const peer = friends.find((person) => person.id === peerId);
    return peer?.displayName || (peer?.handle ? `@${peer.handle}` : "") || session.title || "Conversation";
  };
  const activePeer =
    activeSession && activeSession.kind === "dm"
      ? friends.find(
          (person) => person.id === (activeSession.participants ?? []).find((id) => id !== user?.id),
        )
      : undefined;
  const activeBotName = activeBot?.name ?? (activeSession ? humanChatName(activeSession) : "Botifyr");
  // Files shared in the open human conversation (📎 name … /shared/<token>).
  const activeSharedFiles =
    activeSession && (activeSession.kind === "dm" || activeSession.kind === "group")
      ? activeSession.messages.flatMap(
          (message) => sharedFilesOf(displayText(decrypted, message.content, message.id)).files,
        )
      : [];
  const sharedFileCounts = activeSharedFiles.reduce(
    (acc, file) => {
      acc[attachmentBucket(file.name)] += 1;
      return acc;
    },
    { photo: 0, video: 0, voice: 0, file: 0 },
  );
  const contactMedia =
    contactMediaFilter === "all"
      ? activeSharedFiles
      : activeSharedFiles.filter((file) => attachmentBucket(file.name) === contactMediaFilter);
  const addableFriends =
    activeSession && activeSession.kind === "group"
      ? friends.filter((person) => !(activeSession.participants ?? []).includes(person.id))
      : [];
  // Read receipts: the latest read time of any other participant, and the id of
  // our most recent outbound message (where "Seen" is shown).
  const peerReadAt =
    activeSession && (activeSession.kind === "dm" || activeSession.kind === "group")
      ? Object.entries(readReceipts[activeSession.id] ?? {})
          .filter(([id]) => id !== user?.id)
          .map(([, at]) => at)
          .sort()
          .pop()
      : undefined;
  const lastOwnMessageId =
    activeSession && (activeSession.kind === "dm" || activeSession.kind === "group")
      ? [...activeSession.messages].reverse().find((message) => message.senderId === user?.id)?.id
      : undefined;

  // Seed the rename input when the open group changes (not on every message).
  useEffect(() => {
    if (!activeSession || activeSession.kind !== "group") return;
    if (seededGroupRef.current === activeSession.id) return;
    seededGroupRef.current = activeSession.id;
    setGroupTitleDraft(activeSession.title);
  }, [activeSession]);

  async function renameGroup(): Promise<void> {
    if (!activeSession || activeSession.kind !== "group") return;
    const title = groupTitleDraft.trim();
    if (!title) return;
    try {
      const updated = await client.renameConversation(activeSession.id, title);
      setSessions((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function addGroupMember(): Promise<void> {
    if (!activeSession || !addMemberId) return;
    try {
      const updated = await client.addConversationMember(activeSession.id, addMemberId);
      setSessions((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      setAddMemberId("");
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function removeGroupMember(userId: string): Promise<void> {
    if (!activeSession) return;
    try {
      const updated = await client.removeConversationMember(activeSession.id, userId);
      setSessions((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function leaveGroup(): Promise<void> {
    if (!activeSession || !user) return;
    const id = activeSession.id;
    try {
      await client.removeConversationMember(id, user.id);
      setSessions((prev) => prev.filter((entry) => entry.id !== id));
      setActiveSessionId(null);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  /** Signed, owner/recipient-scoped URL for a shared file. */
  function sharedUrl(shareToken: string): string {
    return `${CLOUD_URL}/v1/shared?share=${encodeURIComponent(shareToken)}&token=${encodeURIComponent(token() ?? "")}`;
  }

  /** Open the media viewer at the given item, across all media in the chat. */
  function openLightbox(file: { token: string; name: string }): void {
    const media = activeSharedFiles.filter((entry) =>
      /\.(png|jpe?g|webp|gif|svg|mp4|webm)$/i.test(entry.name),
    );
    if (media.length === 0) return;
    const index = Math.max(
      0,
      media.findIndex((entry) => entry.token === file.token),
    );
    setLightbox({ items: media, index });
  }

  /** Render a message's attachment(s) if it has any, else null. */
  function dmFileCard(text: string) {
    return sharedFilesOf(text).files.length > 0 ? (
      <AttachmentMessage
        text={text}
        onOpenImage={openLightbox}
        onOpenFile={(url) => void openExternal(url)}
        onTranscribe={(tok) => {
          // Cache transcripts per media token so reloads don't recompute them.
          const cacheKey = `botifyr.transcript.${tok}`;
          try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) return Promise.resolve(cached);
          } catch {
            // ignore storage errors
          }
          return client
            .transcribe(tok)
            .then((result) => {
              try {
                localStorage.setItem(cacheKey, result.text);
              } catch {
                // ignore quota errors
              }
              return result.text;
            })
            .catch((err: unknown) => {
              noteModelError(err);
              throw err;
            });
        }}
      />
    ) : null;
  }

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
  // Cross-chat message search (Telegram-style): match message text across every
  // conversation. Shown in the sidebar while the search box has a query.
  const searchTerm = query.trim().toLowerCase();
  const messageHits =
    searchTerm.length >= 2
      ? sessions
          .flatMap((session) => {
            const bot = bots.find((entry) => entry.sessionId === session.id);
            const title =
              bot?.name ??
              (session.kind === "dm" || session.kind === "group" ? humanChatName(session) : session.title);
            return session.messages
              .map((message) => {
                const text = displayText(decrypted, message.content, message.id).replace(/\s+/g, " ").trim();
                const idx = text.toLowerCase().indexOf(searchTerm);
                if (idx < 0) return null;
                const snippet = text.slice(Math.max(0, idx - 30), idx + 60);
                return {
                  id: `${session.id}:${message.id}`,
                  sessionId: session.id,
                  title,
                  snippet,
                };
              })
              .filter((hit): hit is { id: string; sessionId: string; title: string; snippet: string } =>
                Boolean(hit),
              );
          })
          .slice(0, 30)
      : [];
  // Companies: a bot belongs to a workspace through its role (authoritative) or,
  // for legacy rows, its `workspace` label. Grouping is keyed by workspace *id*,
  // so two companies that happen to share a name still render as separate
  // sections. See docs/company-workspace.md.
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const workspaceByName = new Map<string, WorkspaceWithRoles>();
  for (const workspace of workspaces) {
    if (!workspaceByName.has(workspace.name)) workspaceByName.set(workspace.name, workspace);
  }
  /** "Since your last visit" — computed from local visit state + the loaded data. */
  const sinceMs = lastVisitAt ? new Date(lastVisitAt).getTime() : 0;
  const hqShippedSince = sinceMs
    ? boardItems.filter((item) => item.status === "done" && new Date(item.updatedAt).getTime() > sinceMs)
    : [];
  const hqNewReports = sinceMs
    ? hqReports.filter((report) => new Date(report.createdAt).getTime() > sinceMs)
    : [];
  // Referenced so the compiler keeps them (wired into the HQ "since last visit"
  // badge as that work lands).
  void hqShippedSince;
  void hqNewReports;
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
  // Names for the "Company" datalist in the bot editor (companies + legacy labels).
  const workspaceNames = [
    ...new Set([
      ...workspaces.map((workspace) => workspace.name),
      ...bots.map((bot) => bot.workspace).filter((name): name is string => Boolean(name)),
    ]),
  ];
  // Guard against a stale filter (e.g. an old company id left in state).
  const activeWorkspaceFilter =
    workspaceFilter === "feed" || workspaceFilter === "startups" ? workspaceFilter : "personal";
  // Feed is a view, not a workspace filter: the left list keeps showing the
  // chats while the main area swaps to the social timeline.
  const feedActive = activeWorkspaceFilter === "feed";
  // The Startup Workspace is a full-pane view in the main area (like the Feed).
  const startupsActive = activeWorkspaceFilter === "startups";
  const workspaceFiltered = feedActive
    ? filteredBots
    : activeWorkspaceFilter === "startups"
      ? filteredBots.filter((bot) => companyOf(bot).id !== "personal")
      : filteredBots.filter((bot) => companyOf(bot).id === "personal");
  // Human conversations live in the Chat tab; the Feed shows them too.
  const personalChats = activeWorkspaceFilter === "personal" || feedActive ? humanChats : [];
  const companyGroups = new Map<string, { name: string; workspace?: WorkspaceWithRoles; members: Bot[] }>();
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
      setReadReceipts((prev) => {
        const next = { ...prev };
        for (const convo of human) next[convo.id] = convo.readAt ?? {};
        return next;
      });
      setSessions((prev) => {
        const byId = new Map(prev.map((session) => [session.id, session]));
        for (const convo of human) {
          if (byId.has(convo.id)) continue;
          // Seed the last message from the summary so the list shows a preview
          // before the full thread is loaded. Opening the chat replaces this
          // placeholder with the real session.
          const last = convo.last;
          byId.set(convo.id, {
            id: convo.id,
            userId: user?.id ?? "",
            title: convo.title,
            messages: last
              ? [
                  {
                    id: last.id,
                    role: last.role === "assistant" ? "assistant" : "user",
                    content: last.content,
                    createdAt: last.createdAt,
                    senderId: last.senderId,
                  },
                ]
              : [],
            createdAt: convo.createdAt,
            kind: convo.kind,
            participants: convo.participants,
          });
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
    // Keep friends/requests fresh so name changes and new requests show up
    // without a reload (there is no realtime event for the directory yet).
    const refresh = () => void loadPeople();
    const timer = window.setInterval(refresh, 30_000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, loadPeople]);

  // Raise a notification for new incoming friend requests. Existing requests are
  // seeded silently on first load so a refresh doesn't spam the bell.
  useEffect(() => {
    if (!user) return;
    const seen = seenRequestsRef.current;
    if (!requestsSeededRef.current) {
      for (const request of friendRequests) seen.add(request.id);
      requestsSeededRef.current = true;
      return;
    }
    for (const request of friendRequests) {
      if (request.direction !== "incoming" || seen.has(request.id)) continue;
      seen.add(request.id);
      const name =
        request.person.displayName || (request.person.handle ? `@${request.person.handle}` : "Someone");
      pushToast({
        kind: "message",
        title: "Friend request",
        body: `${name} wants to connect.`,
        requestId: request.id,
      });
    }
  }, [friendRequests, user, pushToast]);

  // Keep the media manifest handy (bot Library + Media tab).
  useEffect(() => {
    if (!user) return;
    void client
      .listMedia()
      .then(setMedia)
      .catch(() => {});
  }, [user, client]);

  // Remember where reading left off when a conversation is opened, so incoming
  // messages that arrive afterwards can be marked "New messages".
  useEffect(() => {
    if (!activeSessionId) return;
    setNewMsgSince((prev) => {
      const boundary = readAt[activeSessionId];
      if (!boundary || prev[activeSessionId] === boundary) return prev;
      return { ...prev, [activeSessionId]: boundary };
    });
    // Intentionally runs only when the conversation changes; `readAt` is read
    // at open time before the mark-read effect below advances it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // Opening a conversation marks it read (so the unread badge clears) and
  // records a read receipt on the server for the other participants.
  useEffect(() => {
    if (!activeSessionId) return;
    const now = new Date().toISOString();
    setReadAt((prev) => {
      const next = { ...prev, [activeSessionId]: now };
      localStorage.setItem("botifyr.readAt", JSON.stringify(next));
      return next;
    });
    const session = sessions.find((entry) => entry.id === activeSessionId);
    if (session && (session.kind === "dm" || session.kind === "group")) {
      void client.markConversationRead(session.id).catch(() => {});
      if (user) {
        setReadReceipts((prev) => ({
          ...prev,
          [session.id]: { ...(prev[session.id] ?? {}), [user.id]: now },
        }));
      }
    }
  }, [activeSessionId, sessions, client, user]);

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
        const body = previewText(displayText(decrypted, message.content, message.id));
        if (!incoming || !body) continue;
        // Never replay history on startup: only notify for messages that
        // arrived after this session of the app began.
        const created = message.createdAt ? Date.parse(message.createdAt) : 0;
        if (created && created < bootAtRef.current - 5_000) continue;
        const sender =
          session.kind === "dm" ? friends.find((person) => person.id === message.senderId) : undefined;
        const title =
          bot?.name ??
          (session.kind === "dm"
            ? sender?.displayName || (sender?.handle ? `@${sender.handle}` : "New message")
            : session.title || "New message");
        pushToast({
          kind: "message",
          title,
          body: body.slice(0, 120),
          sessionId: session.id,
          messageId: message.id,
        });
      }
    }
    try {
      localStorage.setItem(SEEN_MESSAGES_KEY, JSON.stringify(Array.from(seen).slice(-800)));
    } catch {
      // ignore quota errors
    }
  }, [sessions, activeSessionId, user, bots, friends, decrypted, pushToast]);

  // Once a DM body is decrypted, replace the placeholder text in any live toast
  // or stored notification that was raised before the plaintext was available.
  useEffect(() => {
    function bodyFor(entry: Toast): string | null {
      if (!entry.messageId) return null;
      const text = decrypted[entry.messageId];
      if (!text) return null;
      const body = text.replace(/\s+/g, " ").trim().slice(0, 120);
      return body && body !== entry.body ? body : null;
    }
    function updateList<T extends Toast>(list: T[]): T[] {
      let changed = false;
      const next = list.map((entry) => {
        const body = bodyFor(entry);
        if (!body) return entry;
        changed = true;
        return { ...entry, body };
      });
      return changed ? next : list;
    }
    setToasts((prev) => updateList(prev));
    setNotifications((prev) => {
      const next = updateList(prev);
      if (next === prev) return prev;
      try {
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [decrypted]);

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
    setProfileAvatarUrl(user.avatarUrl);
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
              {last
                ? displayText(decrypted, last.content ?? "", last.id).slice(0, 42) ||
                  "No messages yet — say hello"
                : "No messages yet — say hello"}
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

  /** One human conversation (DM / group) row in the sidebar. */
  const renderChatRow = (chat: Session) => {
    const last = chat.messages[chat.messages.length - 1];
    const peer =
      chat.kind === "dm"
        ? friends.find((person) => person.id === (chat.participants ?? []).find((id) => id !== user?.id))
        : undefined;
    const active = chat.id === activeSessionId && !activeBotId;
    return (
      <div key={chat.id} className={`conv-item${active ? " active" : ""}`}>
        <button className="conv-select" type="button" onClick={() => openChat(chat)}>
          <span className="conv-avatar">
            {peer ? (
              <PersonAvatar person={peer} size={34} />
            ) : (
              <span className="newchat-emoji">{chat.kind === "group" ? "👥" : "💬"}</span>
            )}
          </span>
          <span className="conv-text">
            <span className="conv-name">{humanChatName(chat)}</span>
            <span className="conv-preview">
              {last
                ? previewText(displayText(decrypted, last.content ?? "", last.id)).slice(0, 42) ||
                  "No messages yet"
                : "No messages yet"}
            </span>
          </span>
        </button>
        <span className="conv-aside">
          {unreadCount(chat.id) > 0 && <span className="unread-badge">{unreadCount(chat.id)}</span>}
          {confirmDeleteId === chat.id ? (
            <button
              className="conv-delete confirm"
              type="button"
              title="Tap to confirm delete"
              onClick={() => void removeChat(chat)}
            >
              Delete
            </button>
          ) : (
            <button
              className="conv-delete"
              type="button"
              title="Delete chat"
              aria-label="Delete chat"
              onClick={() => {
                setConfirmDeleteId(chat.id);
                window.setTimeout(() => setConfirmDeleteId((cur) => (cur === chat.id ? null : cur)), 3000);
              }}
            >
              <CloseIcon size={13} />
            </button>
          )}
        </span>
      </div>
    );
  };

  /** Resolve "system" to the effective scheme so the toggle reflects what's on screen. */
  const effectiveDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  /** Light/dark switch shown in the header, immediately before the bell. */
  const themeToggle = (
    <button
      className="bot-menu-btn"
      type="button"
      title={effectiveDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={effectiveDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next = effectiveDark ? "light" : "dark";
        setTheme(next);
        localStorage.setItem("botifyr.theme", next);
      }}
    >
      {effectiveDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );

  /** The bell + dropdown; teleported into the OS title bar when the host provides a slot. */
  const notificationCentre = (
    <div className="notif-wrap" ref={notifWrapRef}>
      <button className="bot-menu-btn" type="button" title="Notifications" onClick={toggleNotifications}>
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
              {notifications.map((entry) => {
                const requestId = entry.requestId;
                return (
                  <li key={entry.id} className="notif-row">
                    {requestId ? (
                      <div className={`notif-item${entry.read ? "" : " unread"}`}>
                        <span className="notif-title">{entry.title}</span>
                        <span className="notif-body">{entry.body}</span>
                        <span className="notif-time">
                          {new Date(entry.at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="notif-actions">
                          <button
                            className="btn primary small"
                            type="button"
                            onClick={() =>
                              void respondRequest(requestId, "accept").then(() =>
                                dismissNotification(entry.id),
                              )
                            }
                          >
                            Accept
                          </button>
                          <button
                            className="btn small"
                            type="button"
                            onClick={() =>
                              void respondRequest(requestId, "decline").then(() =>
                                dismissNotification(entry.id),
                              )
                            }
                          >
                            Decline
                          </button>
                        </span>
                      </div>
                    ) : (
                      <button
                        className={`notif-item${entry.read ? "" : " unread"}`}
                        type="button"
                        onClick={() => {
                          markNotificationRead(entry.id);
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
                    )}
                    <button
                      className="notif-x"
                      type="button"
                      title="Dismiss"
                      onClick={() => dismissNotification(entry.id)}
                    >
                      <CloseIcon size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`app${feedActive || (!startupsActive && showBotPanel && (activeBot || (activeSession && (activeSession.kind === "dm" || activeSession.kind === "group")))) ? " with-panel" : ""}${officeDocked ? " with-office" : ""}${density === "compact" ? " density-compact" : ""}${mobileNavOpen ? " mobile-nav-open" : ""}`}
    >
      {titlebarSlot &&
        createPortal(
          <>
            {themeToggle}
            {notificationCentre}
          </>,
          titlebarSlot,
        )}
      {modelNotice && (
        <div className="model-banner" role="status">
          <span>{modelNotice}</span>
          <button
            className="model-banner-close"
            type="button"
            aria-label="Dismiss"
            onClick={() => setModelNotice(null)}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      {lightbox && lightbox.items[lightbox.index] && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <button className="lightbox-close" type="button" title="Close" onClick={() => setLightbox(null)}>
            <CloseIcon size={18} />
          </button>
          {lightbox.items.length > 1 && (
            <button
              className="lightbox-nav prev"
              type="button"
              aria-label="Previous"
              onClick={(event) => {
                event.stopPropagation();
                setLightbox((current) =>
                  current
                    ? {
                        ...current,
                        index: (current.index - 1 + current.items.length) % current.items.length,
                      }
                    : current,
                );
              }}
            >
              ‹
            </button>
          )}
          {/\.(mp4|webm)$/i.test(lightbox.items[lightbox.index].name) ? (
            <video
              className="lightbox-img"
              src={sharedUrl(lightbox.items[lightbox.index].token)}
              controls
              autoPlay
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <img
              className="lightbox-img"
              src={sharedUrl(lightbox.items[lightbox.index].token)}
              alt={lightbox.items[lightbox.index].name}
              onClick={(event) => event.stopPropagation()}
            />
          )}
          {lightbox.items.length > 1 && (
            <button
              className="lightbox-nav next"
              type="button"
              aria-label="Next"
              onClick={(event) => {
                event.stopPropagation();
                setLightbox((current) =>
                  current ? { ...current, index: (current.index + 1) % current.items.length } : current,
                );
              }}
            >
              ›
            </button>
          )}
          <div className="lightbox-caption">{lightbox.items[lightbox.index].name}</div>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.kind}`}>
              <button
                className="toast-main"
                type="button"
                onClick={() => {
                  markNotificationRead(toast.id);
                  if (toast.feed) setWorkspaceFilter("feed");
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
      {mobileNavOpen && (
        <div className="mobile-nav-overlay" role="presentation" onClick={() => setMobileNavOpen(false)} />
      )}
      <aside className="sidebar" aria-label="Chats and contacts">
        <div className="sidebar-top">
          <button className="round" type="button" title="Search" onClick={() => setSearchOpen((v) => !v)}>
            <SearchIcon size={16} />
          </button>
          <button className="round" type="button" title="New chat" onClick={openNewChat}>
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

        <div className="ws-tabs" role="tablist" aria-label="Filter by workspace">
          <button
            className={`ws-tab${activeWorkspaceFilter === "personal" ? " active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeWorkspaceFilter === "personal"}
            onClick={() => {
              setWorkspaceFilter("personal");
              setMobileNavOpen(false);
            }}
          >
            Chat
          </button>
          <button
            className={`ws-tab${feedActive ? " active" : ""}`}
            type="button"
            role="tab"
            aria-selected={feedActive}
            onClick={() => {
              setWorkspaceFilter("feed");
              setMobileNavOpen(false);
            }}
          >
            Feed
          </button>
          <button
            className={`ws-tab${activeWorkspaceFilter === "startups" ? " active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeWorkspaceFilter === "startups"}
            onClick={() => {
              setWorkspaceFilter("startups");
              setMobileNavOpen(false);
            }}
          >
            Startup Workspace
          </button>
        </div>

        <div className="task-list">
          {messageHits.length > 0 && (
            <div className="task-section">
              <div className="task-section-head static" aria-hidden="true">
                <span className="task-section-name">Messages</span>
                <span className="task-section-count">{messageHits.length}</span>
              </div>
              <div className="task-section-list">
                {messageHits.map((hit) => (
                  <button
                    key={hit.id}
                    className="search-hit"
                    type="button"
                    onClick={() => {
                      openSessionById(hit.sessionId);
                      setQuery("");
                      setSearchOpen(false);
                    }}
                  >
                    <span className="search-hit-title">{hit.title}</span>
                    <span className="search-hit-snippet">{hit.snippet}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {workspaceFiltered.length === 0 && personalChats.length === 0 && (
            <p className="empty">
              {activeWorkspaceFilter === "startups"
                ? "No startup yet. Tap ＋ → Start a company."
                : "No chats yet. Tap ＋ to create a bot."}
            </p>
          )}
          {[...companyGroups.entries()].map(([id, group]) => {
            const collapsed = collapsedWorkspaces[id] === true;
            const pending = group.workspace?.pending ?? 0;
            return (
              <div key={id} className="task-section">
                <div className="task-section-headrow">
                  <button
                    className={`task-section-head${collapsed ? " collapsed" : ""}`}
                    type="button"
                    onClick={() => setCollapsedWorkspaces((prev) => ({ ...prev, [id]: !prev[id] }))}
                    aria-expanded={!collapsed}
                    aria-label={`${group.name} — ${group.members.length} employee${group.members.length === 1 ? "" : "s"}${pending > 0 ? `, ${pending} need you` : ""}`}
                  >
                    <span className="task-caret">{collapsed ? "▸" : "▾"}</span>
                    {group.workspace?.avatarEmoji && (
                      <span className="task-section-emoji">{group.workspace.avatarEmoji}</span>
                    )}
                    <span className="task-section-name">
                      {group.name}
                      <span
                        className={`task-section-count${pending > 0 ? " has-needs" : ""}`}
                        aria-hidden="true"
                      >
                        {pending > 0
                          ? ` (${group.members.length} · ${pending} need you)`
                          : ` (${group.members.length})`}
                      </span>
                    </span>
                  </button>
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
                      <GearIcon size={16} />
                    </button>
                  )}
                  {group.workspace && (
                    <button
                      className="task-section-edit"
                      type="button"
                      title="Company board"
                      aria-label="Company board"
                      onClick={() => {
                        setStartupFocusId(group.workspace!.id);
                        setWorkspaceFilter("startups");
                      }}
                    >
                      <ChartIcon size={16} />
                    </button>
                  )}
                  {group.workspace && (
                    <button
                      className="task-section-edit"
                      type="button"
                      title="3D Workspace — see the office live"
                      aria-label="Open 3D workspace"
                      onClick={() => openOffice({ id: group.workspace!.id, name: group.name })}
                    >
                      <CubeIcon size={16} />
                    </button>
                  )}
                </div>
                {!collapsed && <div className="task-section-list">{group.members.map(renderBotRow)}</div>}
              </div>
            );
          })}
          {companyGroups.size > 0 && (ungroupedBots.length > 0 || personalChats.length > 0) && (
            <div className="task-section-head static" aria-hidden="true">
              <span className="task-section-name">Chats</span>
              <span className="task-section-count">{ungroupedBots.length + personalChats.length}</span>
            </div>
          )}
          {personalChats.map(renderChatRow)}
          {ungroupedBots.map(renderBotRow)}
        </div>

        <footer className="sidebar-footer">
          <button
            className="sidebar-account"
            ref={accountBtnRef}
            type="button"
            title={`${user.email} · ${connection === "online" ? "Connected" : connection === "connecting" ? "Connecting…" : "Offline"}`}
            onClick={() => setShowAccountMenu((value) => !value)}
          >
            <SelfAvatar user={user} email={user.email} className="user-avatar" />
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
          <div className="account-menu" ref={accountMenuRef}>
            <button
              className="account-item"
              type="button"
              onClick={() => {
                setSettingsTab("profile");
                setShowSettings(true);
                setShowAccountMenu(false);
              }}
            >
              <span className="account-ico">
                <UserIcon size={16} />
              </span>
              <span className="account-label">Profile</span>
              <span className="account-chev">›</span>
            </button>
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
        {feedActive && (
          <FeedView
            client={client}
            viewerId={user?.id}
            cloudUrl={CLOUD_URL}
            refreshKey={feedRefresh}
            pageHandle={feedPage}
            onOpenPage={setFeedPage}
            groupHandle={feedGroup}
            onOpenGroup={setFeedGroup}
            albumName={feedAlbum}
            onOpenAlbum={setFeedAlbum}
            onOpenNav={() => setMobileNavOpen(true)}
            onOpenMarketplace={() => setShowConnectApps(true)}
            onStoryReplySent={openStoryConversation}
            focusPostId={feedFocusPost}
          />
        )}
        {startupsActive && (
          <CompanyWorkspace
            client={client}
            companies={workspaces}
            bots={bots}
            focusCompanyId={startupFocusId}
            createNonce={companyCreateNonce}
            onOpenOffice={openOffice}
            renderOfficeEmbedded={renderOfficeEmbedded}
            onCreated={handleCompanyCreated}
          />
        )}
        {((!feedActive && !startupsActive) || showNewChat) && (
          <>
            {showNewChat && (
              <div className="newchat-overlay" onClick={() => setShowNewChat(false)}>
                <span className="newchat-title">To: Start a chat with…</span>
                <div className="newchat-panel" onClick={(event) => event.stopPropagation()}>
                  <div className="newchat-actions">
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
                    <button className="newchat-item" type="button" onClick={startCompanyFlow}>
                      <span className="newchat-ico">
                        <BotLogo size={16} />
                      </span>
                      Start a company
                    </button>
                  </div>

                  <div className="newchat-search">
                    <SearchIcon size={15} />
                    <input
                      placeholder="Search bots, groups, and people"
                      value={newChatQuery}
                      autoFocus
                      onChange={(event) => setNewChatQuery(event.target.value)}
                    />
                  </div>

                  <nav className="people-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={newChatTab === "contacts"}
                      className={`people-tab ${newChatTab === "contacts" ? "active" : ""}`}
                      onClick={() => setNewChatTab("contacts")}
                    >
                      <UserIcon size={15} />
                      Contacts
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={newChatTab === "chats"}
                      className={`people-tab ${newChatTab === "chats" ? "active" : ""}`}
                      onClick={() => setNewChatTab("chats")}
                    >
                      <MessageIcon size={15} />
                      Chats
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={newChatTab === "calls"}
                      className={`people-tab ${newChatTab === "calls" ? "active" : ""}`}
                      onClick={() => setNewChatTab("calls")}
                    >
                      <PhoneIcon size={15} />
                      Calls
                    </button>
                  </nav>

                  {newChatTab === "contacts" && (
                    <div className="newchat-list">
                      {matchingFriends.length === 0 ? (
                        <div className="newchat-empty">
                          {friends.length === 0
                            ? "No contacts yet — add friends from People."
                            : "No contacts match your search."}
                        </div>
                      ) : (
                        matchingFriends.map((person) => (
                          <button
                            key={person.id}
                            className="newchat-item"
                            type="button"
                            onClick={() => {
                              setShowNewChat(false);
                              void openDmWith(person);
                            }}
                          >
                            <PersonAvatar person={person} size={30} />
                            <span className="newchat-name">
                              {person.displayName || (person.handle ? `@${person.handle}` : "Friend")}
                            </span>
                            <span className="newchat-meta">{person.online ? "online" : "offline"}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {newChatTab === "chats" && (
                    <div className="newchat-list">
                      {matchingBots.length === 0 ? (
                        <div className="newchat-empty">
                          {bots.length === 0 ? "No chats yet — create a bot." : "No chats match your search."}
                        </div>
                      ) : (
                        matchingBots.map((bot) => {
                          const isGroup = Boolean(bot.memberIds && bot.memberIds.length > 0);
                          return (
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
                                <span className="newchat-emoji">{cleanEmoji(bot.emoji, isGroup)}</span>
                                {bot.name}
                              </span>
                              {isGroup && (
                                <span className="newchat-meta">{bot.memberIds?.length ?? 0} bots</span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}

                  {newChatTab === "calls" && (
                    <div className="newchat-list">
                      <div className="people-empty">
                        <span className="people-empty-ico">
                          <PhoneIcon size={26} />
                        </span>
                        <div className="people-empty-title">Calls are coming soon</div>
                        <div className="people-empty-sub">Voice and video calls aren't available yet.</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!showNewChat && (
              <header className="topbar">
                <button
                  ref={mobileNavBtnRef}
                  className="mobile-nav-btn"
                  type="button"
                  title="Show chats"
                  aria-label="Show chats"
                  aria-expanded={mobileNavOpen}
                  onClick={() => setMobileNavOpen((value) => !value)}
                >
                  <MenuIcon size={18} />
                </button>
                {findOpen ? (
                  <div className="thread-search">
                    <SearchIcon size={15} />
                    <input
                      placeholder="Search this chat"
                      value={findQuery}
                      onChange={(event) => setFindQuery(event.target.value)}
                      autoFocus
                    />
                    {findQuery.trim() && (
                      <span className="thread-search-count">
                        {findMatches ? `${findPos + 1}/${findMatches}` : 0}
                      </span>
                    )}
                    {findMatches > 0 && (
                      <>
                        <button
                          className="icon-btn sm"
                          type="button"
                          aria-label="Previous match"
                          onClick={() => setFindPos((pos) => (pos - 1 + findMatches) % findMatches)}
                        >
                          <ChevronIcon size={13} />
                        </button>
                        <button
                          className="icon-btn sm"
                          type="button"
                          aria-label="Next match"
                          onClick={() => setFindPos((pos) => (pos + 1) % findMatches)}
                        >
                          <ChevronIcon size={13} />
                        </button>
                      </>
                    )}
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
                    {activePeer ? (
                      <PersonAvatar person={activePeer} size={18} />
                    ) : activeSession?.kind === "group" ? (
                      <span className="newchat-emoji">👥</span>
                    ) : (
                      <BotLogo size={18} scheme={activeScheme} />
                    )}
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
                  {!titlebarSlot && (
                    <>
                      {themeToggle}
                      {notificationCentre}
                    </>
                  )}
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

            {(limitWarning ?? budgetNotice) && (
              <div className="notice warn">{limitWarning ?? budgetNotice}</div>
            )}

            {billingNotice && <div className="notice warn">{billingNotice}</div>}

            <section className="content" ref={scrollRef} onScroll={onContentScroll}>
              {error && <div className="error">{error}</div>}

              {!activeSession && (
                <div className="hero">
                  <h1>Start a conversation</h1>
                  <p>
                    Ask Botifyr to do something. It plans, works inside an isolated sandbox, and asks before
                    risky steps.
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
                  {visibleMessages.map((message, msgIndex) => {
                    const prevMsg = visibleMessages[msgIndex - 1];
                    // Consecutive messages from the same sender (within 5 min)
                    // read as one block: repeated names/avatars are dropped and
                    // the shared corner is flattened.
                    const sameRun = (a: typeof message | undefined, b: typeof message | undefined) =>
                      a !== undefined &&
                      b !== undefined &&
                      a.role === b.role &&
                      a.senderId === b.senderId &&
                      a.botId === b.botId &&
                      Math.abs(new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()) <
                        5 * 60 * 1000;
                    const groupedWithPrev = sameRun(prevMsg, message);
                    return (
                      <Fragment key={message.id}>
                        {(msgIndex === 0 ||
                          dayKeyOf(visibleMessages[msgIndex - 1]?.createdAt) !==
                            dayKeyOf(message.createdAt)) && (
                          <div className="date-sep-thread" role="separator">
                            {dayLabelOf(message.createdAt)}
                          </div>
                        )}
                        {msgIndex === firstNewIndex && (
                          <div className="new-msg-divider" role="separator">
                            New messages
                          </div>
                        )}
                        {(() => {
                          if (activeSession.kind === "dm" || activeSession.kind === "group") {
                            const mine = message.senderId === user.id;
                            const person = friends.find((entry) => entry.id === message.senderId);
                            const label =
                              person?.displayName || (person?.handle ? `@${person.handle}` : "Friend");
                            if (mine) {
                              return (
                                <div
                                  key={message.id}
                                  className={`msg-user${groupedWithPrev ? " grouped" : ""}`}
                                >
                                  {actionsFor(message, user.displayName || "You")}
                                  <div className="msg-user-bubble">
                                    <div className="msg-author">
                                      {user.displayName || (user.handle ? `@${user.handle}` : "You")}
                                    </div>
                                    {dmFileCard(displayText(decrypted, message.content, message.id)) ??
                                      displayText(decrypted, message.content, message.id)}
                                    {reactionChips(message).map((chip) => (
                                      <span
                                        key={chip.emoji}
                                        className={`reaction${chip.mine ? " mine" : ""}`}
                                      >
                                        {chip.emoji}
                                        {chip.count > 1 ? ` ${chip.count}` : ""}
                                      </span>
                                    ))}
                                    {message.id === lastOwnMessageId &&
                                      peerReadAt &&
                                      message.createdAt <= peerReadAt && (
                                        <div className="read-receipt">Seen</div>
                                      )}
                                    <time className="msg-time out">{clockOf(message.createdAt)}</time>
                                  </div>
                                  <SelfAvatar user={user} email={user.email} className="msg-user-avatar" />
                                </div>
                              );
                            }
                            return (
                              <div
                                key={message.id}
                                className={`msg-assistant${groupedWithPrev ? " grouped" : ""}`}
                              >
                                {person?.avatarUrl ? (
                                  <img
                                    className="msg-bot-logo person-avatar"
                                    src={person.avatarUrl}
                                    alt=""
                                    style={{ width: 26, height: 26 }}
                                  />
                                ) : (
                                  <BotLogo
                                    size={26}
                                    scheme={BOT_SCHEMES[(person?.avatarScheme ?? 0) % BOT_SCHEMES.length]}
                                    className="msg-bot-logo"
                                  />
                                )}
                                <div className="msg-body">
                                  <div className="msg-author">{label}</div>
                                  {dmFileCard(displayText(decrypted, message.content, message.id)) ?? (
                                    <Markdown
                                      text={displayText(decrypted, message.content, message.id)}
                                      onFileRef={openFileRef}
                                    />
                                  )}
                                  {translations[message.id] && (
                                    <div className="msg-translation">{translations[message.id]}</div>
                                  )}
                                  {reactionChips(message).map((chip) => (
                                    <span key={chip.emoji} className={`reaction${chip.mine ? " mine" : ""}`}>
                                      {chip.emoji}
                                      {chip.count > 1 ? ` ${chip.count}` : ""}
                                    </span>
                                  ))}
                                  {actionsFor(message, label)}
                                  <time className="msg-time">{clockOf(message.createdAt)}</time>
                                </div>
                              </div>
                            );
                          }
                          if (message.role === "user") {
                            return (
                              <div
                                key={message.id}
                                className={`msg-user${groupedWithPrev ? " grouped" : ""}`}
                              >
                                {actionsFor(message, "You")}
                                <div className="msg-user-bubble">
                                  {displayText(decrypted, message.content, message.id)}
                                  {reactionChips(message).map((chip) => (
                                    <span key={chip.emoji} className={`reaction${chip.mine ? " mine" : ""}`}>
                                      {chip.emoji}
                                      {chip.count > 1 ? ` ${chip.count}` : ""}
                                    </span>
                                  ))}
                                  <time className="msg-time out">{clockOf(message.createdAt)}</time>
                                </div>
                                <SelfAvatar user={user} email={user.email} className="msg-user-avatar" />
                              </div>
                            );
                          }
                          const msgBot =
                            (message.botId && bots.find((entry) => entry.id === message.botId)) || activeBot;
                          const msgScheme = BOT_SCHEMES[(msgBot?.scheme ?? 0) % BOT_SCHEMES.length];
                          const parsed = parseOptions(message.content);
                          return (
                            <div
                              key={message.id}
                              className={`msg-assistant${groupedWithPrev ? " grouped" : ""}`}
                            >
                              <BotLogo size={26} scheme={msgScheme} className="msg-bot-logo" />
                              <div className="msg-body">
                                {msgBot && (
                                  <div className="msg-author">
                                    <span className="msg-author-emoji">
                                      {cleanEmoji(msgBot.emoji, false)}
                                    </span>
                                    {msgBot.name}
                                  </div>
                                )}
                                <Markdown text={parsed.body} onFileRef={openFileRef} />
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
                                {reactionChips(message).map((chip) => (
                                  <span key={chip.emoji} className={`reaction${chip.mine ? " mine" : ""}`}>
                                    {chip.emoji}
                                    {chip.count > 1 ? ` ${chip.count}` : ""}
                                  </span>
                                ))}
                                {actionsFor(
                                  message,
                                  msgBot?.name ?? activeBotName,
                                  message.id === lastAssistantId,
                                )}
                                <time className="msg-time">{clockOf(message.createdAt)}</time>
                              </div>
                            </div>
                          );
                        })()}
                      </Fragment>
                    );
                  })}

                  {activeSession &&
                    (activeSession.kind === "dm" || activeSession.kind === "group") &&
                    (() => {
                      const entry = typing[activeSession.id];
                      if (!entry || entry.userId === user?.id || Date.now() - entry.at > 3500) {
                        return null;
                      }
                      const typer = friends.find((person) => person.id === entry.userId);
                      const name = typer?.displayName || (typer?.handle ? `@${typer.handle}` : "Someone");
                      return (
                        <div className="typing-row" aria-live="polite">
                          <span className="typing-dots">
                            <i />
                            <i />
                            <i />
                          </span>
                          {name} is typing
                        </div>
                      );
                    })()}

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
                          {groupWorking.names.join(", ")} {groupWorking.names.length > 1 ? "are" : "is"}{" "}
                          replying
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
                                downloadTotal
                                  ? Math.round((downloadTotal.done / downloadTotal.total) * 100)
                                  : 8
                              }%`,
                            }}
                          />
                        </div>
                      )}
                      {liveTask &&
                        (liveTask.status === "running" || liveTask.status === "awaiting_approval") && (
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
                      <div className="audit-head">
                        Audit log · {audit.length} events
                        {taskUsage && taskUsage.tokens > 0
                          ? ` · ${taskUsage.tokens.toLocaleString()} tokens`
                          : ""}
                      </div>
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

            {activeSession && !atBottom && (
              <button
                className="jump-latest"
                type="button"
                onClick={jumpToLatest}
                aria-label="Jump to the latest messages"
              >
                {newWhileAway > 0 ? `${newWhileAway} new message${newWhileAway > 1 ? "s" : ""}` : "Latest"}
                <ChevronIcon size={15} className="chev-down" />
              </button>
            )}

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
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => void allowAlways(task)}
                            >
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
              {attachOpen && (
                <div className="attach-menu">
                  <div className="attach-head">Attach a file</div>
                  <button
                    className="attach-item"
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    ⬆ Upload from this device
                  </button>
                  <button
                    className="attach-item"
                    type="button"
                    onClick={() => {
                      setAttachOpen(false);
                      void toggleRecording();
                    }}
                  >
                    🎤 Record a voice note
                  </button>
                  <div className="attach-head">From downloads</div>
                  {media.length === 0 ? (
                    <div className="attach-empty">No files yet. Ask a bot to download something first.</div>
                  ) : (
                    <ul className="attach-list">
                      {[...media]
                        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
                        .slice(0, 5)
                        .map((item) => (
                          <li key={item.id}>
                            <button
                              className="attach-item"
                              type="button"
                              onClick={() => void attachFiles([item])}
                            >
                              {prettyFileName(item.name)}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      event.target.value = "";
                      if (files.length > 0) void uploadAndAttach(files);
                    }}
                  />
                </div>
              )}
              {composerEmojiOpen && (
                <>
                  <div className="emoji-backdrop" onClick={() => setComposerEmojiOpen(false)} />
                  <div className="emoji-pop composer-emoji-pop" role="listbox" aria-label="Insert emoji">
                    {EMOJI_CHOICES.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="emoji-choice"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setText((prev) => prev + emoji);
                          setComposerEmojiOpen(false);
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="composer-bar">
                <button
                  className={`round${recording ? " recording" : ""}`}
                  type="button"
                  title={recording ? "Stop recording" : "Attach a file"}
                  onClick={() => {
                    if (recording) {
                      void toggleRecording();
                      return;
                    }
                    setAttachOpen((value) => !value);
                  }}
                >
                  {recording ? <StopIcon size={16} /> : <PlusIcon size={18} />}
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
                      const next =
                        historyIndex === null ? sentHistory.length - 1 : Math.max(0, historyIndex - 1);
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
                  className="round emoji-btn"
                  type="button"
                  title="Emoji"
                  aria-label="Insert emoji"
                  aria-expanded={composerEmojiOpen}
                  onClick={() => setComposerEmojiOpen((value) => !value)}
                >
                  <SmileyIcon size={17} />
                </button>
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
                    title="Send message"
                    aria-label="Send message"
                    disabled={!text.trim() || !activeSessionId || sending}
                  >
                    <SendIcon size={16} />
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </main>

      {officeDocked && (
        <aside className="office3d-docked">
          <Suspense fallback={<div className="office3d-loading">Building the office…</div>}>
            {renderOffice(true)}
          </Suspense>
        </aside>
      )}

      {!feedActive &&
        !startupsActive &&
        showBotPanel &&
        !activeBot &&
        activeSession &&
        (activeSession.kind === "dm" || activeSession.kind === "group") && (
          <aside className="bot-panel contact-panel">
            <div className="contact-head">
              {activePeer ? (
                <PersonAvatar person={activePeer} size={96} />
              ) : (
                <span className="person-avatar emoji" style={{ width: 96, height: 96, fontSize: 44 }}>
                  {activeSession.kind === "group" ? "👥" : "💬"}
                </span>
              )}
              <div className="contact-name">{humanChatName(activeSession)}</div>
              <div className="contact-status">
                {activeSession.kind === "group"
                  ? `${activeSession.participants?.length ?? 0} members`
                  : activePeer?.online
                    ? "Online"
                    : "Offline"}
              </div>
            </div>

            <div className="contact-actions">
              <button className="contact-action" type="button" onClick={() => setFindOpen(true)}>
                <span className="contact-action-ico">
                  <SearchIcon size={18} />
                </span>
                Search
              </button>
              <button className="contact-action" type="button" onClick={() => setShowBotPanel(false)}>
                <span className="contact-action-ico">
                  <PanelIcon size={18} />
                </span>
                Hide
              </button>
              <button
                className="contact-action danger"
                type="button"
                onClick={() => void removeChat(activeSession)}
              >
                <span className="contact-action-ico">
                  <CloseIcon size={18} />
                </span>
                Delete
              </button>
            </div>

            <div className="contact-info">
              {activePeer && (
                <div className="contact-row">
                  <span className="contact-row-label">Username</span>
                  <span className="contact-row-value">
                    {activePeer.handle ? `@${activePeer.handle}` : "—"}
                  </span>
                </div>
              )}
              {activeSession.kind === "group" && (
                <div className="contact-row">
                  <span className="contact-row-label">Members</span>
                  <span className="contact-row-value">{activeSession.participants?.length ?? 0}</span>
                </div>
              )}
              <div className="contact-row">
                <span className="contact-row-label">Status</span>
                <span className="contact-row-value">
                  {activePeer ? (activePeer.online ? "Online" : "Offline") : "—"}
                </span>
              </div>
              <div className="contact-row">
                <span className="contact-row-label">Messages</span>
                <span className="contact-row-value">{activeSession.messages.length}</span>
              </div>
              {activeSession.kind === "dm" && (
                <div className="contact-row">
                  <span className="contact-row-label">Translate to</span>
                  <select
                    className="contact-select"
                    value={translateLangs[activeSession.id] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setTranslateLangs((prev) => {
                        const next = { ...prev };
                        if (value) next[activeSession.id] = value;
                        else delete next[activeSession.id];
                        return next;
                      });
                    }}
                  >
                    <option value="">Off</option>
                    <option value="Khmer">Khmer</option>
                    <option value="English">English</option>
                    <option value="Thai">Thai</option>
                    <option value="Vietnamese">Vietnamese</option>
                    <option value="Chinese">Chinese</option>
                    <option value="Japanese">Japanese</option>
                    <option value="Korean">Korean</option>
                    <option value="Spanish">Spanish</option>
                    <option value="French">French</option>
                  </select>
                </div>
              )}
            </div>

            {activeSession.kind === "group" && (
              <div className="group-admin">
                <div className="bot-panel-section-head">Group</div>
                <div className="group-row">
                  <input
                    className="contact-input"
                    value={groupTitleDraft}
                    onChange={(event) => setGroupTitleDraft(event.target.value)}
                    placeholder="Group name"
                    maxLength={60}
                  />
                  <button className="ghost small" type="button" onClick={() => void renameGroup()}>
                    Rename
                  </button>
                </div>
                <ul className="downloads-list">
                  {(activeSession.participants ?? [])
                    .filter((id) => id !== user?.id)
                    .map((id) => {
                      const person = friends.find((entry) => entry.id === id);
                      return (
                        <li key={id} className="download-row">
                          <div className="download-main">
                            <div className="download-name">
                              {person?.displayName || (person?.handle ? `@${person.handle}` : "Member")}
                            </div>
                          </div>
                          <button
                            className="ghost small"
                            type="button"
                            onClick={() => void removeGroupMember(id)}
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                </ul>
                {addableFriends.length > 0 && (
                  <div className="group-row">
                    <select
                      className="contact-select"
                      value={addMemberId}
                      onChange={(event) => setAddMemberId(event.target.value)}
                    >
                      <option value="">Add a friend…</option>
                      {addableFriends.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.displayName || person.handle || "Friend"}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ghost small"
                      type="button"
                      disabled={!addMemberId}
                      onClick={() => void addGroupMember()}
                    >
                      Add
                    </button>
                  </div>
                )}
                <button className="btn danger small" type="button" onClick={() => void leaveGroup()}>
                  Leave group
                </button>
              </div>
            )}

            <div className="contact-media">
              {[
                { id: "all", label: "All", icon: <PanelIcon size={18} />, count: activeSharedFiles.length },
                {
                  id: "photo",
                  label: "Photos",
                  icon: <CameraIcon size={18} />,
                  count: sharedFileCounts.photo,
                },
                { id: "video", label: "Videos", icon: <PlayIcon size={18} />, count: sharedFileCounts.video },
                {
                  id: "voice",
                  label: "Voice messages",
                  icon: <MicIcon size={18} />,
                  count: sharedFileCounts.voice,
                },
                { id: "file", label: "Files", icon: <LockIcon size={18} />, count: sharedFileCounts.file },
              ].map((opt) => (
                <button
                  key={opt.id}
                  className={`contact-media-row${contactMediaFilter === opt.id ? " active" : ""}`}
                  type="button"
                  onClick={() =>
                    setContactMediaFilter(opt.id as "all" | "photo" | "video" | "voice" | "file")
                  }
                >
                  <span className="contact-media-ico">{opt.icon}</span>
                  {opt.label}
                  <span className="contact-media-count">{opt.count}</span>
                </button>
              ))}
            </div>

            <div className="bot-panel-section-head">
              {contactMediaFilter === "all" ? "Shared media" : "Shared files"}
            </div>
            {contactMedia.length === 0 ? (
              <div className="bot-panel-empty">Nothing shared yet.</div>
            ) : contactMediaFilter === "photo" || contactMediaFilter === "video" ? (
              <div className="contact-media-grid">
                {contactMedia.map((file) => (
                  <button
                    key={file.token}
                    className="contact-media-cell"
                    type="button"
                    title={file.name}
                    onClick={() => openLightbox(file)}
                  >
                    {attachmentBucket(file.name) === "video" ? (
                      <video src={sharedUrl(file.token)} preload="metadata" muted />
                    ) : (
                      <img src={sharedUrl(file.token)} alt={file.name} loading="lazy" />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <ul className="downloads-list">
                {contactMedia.map((file) => (
                  <li key={file.token} className="download-row">
                    <div className="download-main">
                      <div className="download-name">{file.name}</div>
                    </div>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => void openExternal(sharedUrl(file.token))}
                    >
                      Save
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

      {feedActive && (
        <aside className="bot-panel feed-rail">
          <div className="feed-rail-title">Discover</div>
          <FeedRail
            client={client}
            onOpenPage={setFeedPage}
            onOpenGroup={setFeedGroup}
            onOpenAlbum={setFeedAlbum}
          />
        </aside>
      )}

      {!feedActive && !startupsActive && showBotPanel && activeBot && (
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

      {filePreview && (
        <div className="apps-overlay" onClick={() => setFilePreview(null)}>
          <div className="apps-panel board-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">{filePreview.name}</span>
              <button className="round small" type="button" onClick={() => setFilePreview(null)}>
                ✕
              </button>
            </div>
            <div className="file-preview">
              <Markdown text={filePreview.content} onFileRef={openFileRef} />
            </div>
          </div>
        </div>
      )}

      {confirmClearBoard && (
        <div className="apps-overlay" onClick={() => setConfirmClearBoard(false)}>
          <div className="apps-panel company-setup" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">Delete all tasks?</span>
              <button className="round small" type="button" onClick={() => setConfirmClearBoard(false)}>
                ✕
              </button>
            </div>
            <p className="company-hint">
              {`This removes all ${boardItems.length} task${
                boardItems.length === 1 ? "" : "s"
              } from the ${boardWorkspace?.name ?? "company"} board. It can't be undone.`}
            </p>
            <div className="apps-actions">
              <button className="ghost small" type="button" onClick={() => setConfirmClearBoard(false)}>
                Cancel
              </button>
              <button
                className="ghost small danger"
                type="button"
                onClick={() => {
                  setConfirmClearBoard(false);
                  void clearBoard();
                }}
              >
                Delete all
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

      {officeOpen && !office3dDock && (
        <Suspense
          fallback={
            <div className="office3d-overlay">
              <div className="office3d-panel office3d-loading">Building the office…</div>
            </div>
          }
        >
          {renderOffice(false)}
        </Suspense>
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
          <div className="apps-panel people-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">People</span>
              <button className="icon-btn sm" type="button" onClick={() => setShowPeople(false)}>
                <CloseIcon size={13} />
              </button>
            </div>

            <nav className="people-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={peopleTab === "contacts"}
                className={`people-tab ${peopleTab === "contacts" ? "active" : ""}`}
                onClick={() => setPeopleTab("contacts")}
              >
                <UsersIcon size={15} />
                Contacts
                {friendRequests.filter((request) => request.direction === "incoming").length > 0 && (
                  <span className="people-tab-badge">
                    {friendRequests.filter((request) => request.direction === "incoming").length}
                  </span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={peopleTab === "chats"}
                className={`people-tab ${peopleTab === "chats" ? "active" : ""}`}
                onClick={() => {
                  setPeopleTab("chats");
                  void resyncConversations();
                }}
              >
                <MessageIcon size={15} />
                Chats
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={peopleTab === "calls"}
                className={`people-tab ${peopleTab === "calls" ? "active" : ""}`}
                onClick={() => setPeopleTab("calls")}
              >
                <PhoneIcon size={15} />
                Calls
              </button>
            </nav>

            {peopleTab === "contacts" && (
              <div className="people-pane">
                <input
                  className="settings-input field-full"
                  style={{ marginBottom: 12 }}
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
                          <PersonAvatar person={person} />
                          <div className="download-main">
                            <div className="download-name">
                              {person.displayName ||
                                (person.handle ? `@${person.handle}` : person.id.slice(0, 8))}
                            </div>
                            <div className="download-size">{person.online ? "online" : "offline"}</div>
                          </div>
                          {person.friend ? (
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => void openDmWith(person)}
                            >
                              Message
                            </button>
                          ) : person.requested ? (
                            <span className="settings-note">Requested</span>
                          ) : (
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => void addFriend(person)}
                            >
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
                            <PersonAvatar person={request.person} />
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
                      <PersonAvatar person={person} />
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
                      className="settings-input field-full"
                      style={{ marginBottom: 6 }}
                      placeholder="Group name"
                      value={groupName}
                      onChange={(event) => setGroupName(event.target.value)}
                    />
                    <ul className="downloads-list">
                      {friends.map((person) => (
                        <li key={person.id} className="download-row">
                          <label className="member-item grow">
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
                            <span>
                              {person.displayName || (person.handle ? `@${person.handle}` : "Friend")}
                            </span>
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
            )}

            {peopleTab === "chats" && (
              <div className="people-pane">
                {humanChats.length === 0 ? (
                  <div className="people-empty">
                    <span className="people-empty-ico">
                      <MessageIcon size={26} />
                    </span>
                    <div className="people-empty-title">No conversations yet</div>
                    <div className="people-empty-sub">Start a chat from Contacts.</div>
                  </div>
                ) : (
                  <ul className="downloads-list">
                    {humanChats.map((chat) => {
                      const last = chat.messages[chat.messages.length - 1];
                      const peer =
                        chat.kind === "dm"
                          ? friends.find(
                              (person) => person.id === chat.participants?.find((id) => id !== user?.id),
                            )
                          : undefined;
                      return (
                        <li key={chat.id} className="download-row">
                          {peer ? (
                            <PersonAvatar person={peer} size={30} />
                          ) : (
                            <span
                              className="person-avatar emoji"
                              style={{ width: 30, height: 30, fontSize: 15 }}
                            >
                              {chat.kind === "group" ? "👥" : "💬"}
                            </span>
                          )}
                          <div className="download-main">
                            <div className="download-name">{humanChatName(chat)}</div>
                            <div className="download-size">
                              {last
                                ? displayText(decrypted, last.content, last.id)
                                    .replace(/\s+/g, " ")
                                    .slice(0, 60)
                                : "No messages yet"}
                            </div>
                          </div>
                          <button className="ghost small" type="button" onClick={() => openChat(chat)}>
                            Open
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {peopleTab === "calls" && (
              <div className="people-pane">
                <div className="people-empty">
                  <span className="people-empty-ico">
                    <PhoneIcon size={26} />
                  </span>
                  <div className="people-empty-title">Calls are coming soon</div>
                  <div className="people-empty-sub">Voice and video calls aren't available yet.</div>
                </div>
              </div>
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

              {settingsTab === "profile" && (
                <div className="settings-sections">
                  <div className="profile-pane">
                    <div className="profile-photo-row">
                      <button
                        type="button"
                        className="avatar-upload"
                        title="Upload a profile photo"
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        {profileAvatarUrl ? (
                          <img src={profileAvatarUrl} alt="Your profile" />
                        ) : (
                          <span className="avatar-upload-emoji">{profileEmoji || "🙂"}</span>
                        )}
                        <span className="avatar-upload-edit">
                          <CameraIcon size={13} />
                        </span>
                      </button>
                      <div className="profile-photo-info">
                        <div className="profile-photo-name">{profileName.trim() || "Your profile"}</div>
                        <div className="profile-photo-hint">
                          {profileAvatarUrl
                            ? "JPG or PNG — resized automatically."
                            : "Add a photo so people can recognise you."}
                        </div>
                        <div className="profile-photo-actions">
                          <button
                            className="ghost small"
                            type="button"
                            onClick={() => avatarInputRef.current?.click()}
                          >
                            {profileAvatarUrl ? "Change photo" : "Upload photo"}
                          </button>
                          {profileAvatarUrl && (
                            <button
                              className="link"
                              type="button"
                              onClick={() => setProfileAvatarUrl(undefined)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void chooseAvatar(file);
                        }}
                      />
                    </div>

                    <label className="profile-field">
                      <span className="profile-field-label">Display name</span>
                      <input
                        className="settings-input field-full"
                        placeholder="e.g. Somvannda"
                        maxLength={40}
                        value={profileName}
                        onChange={(event) => setProfileName(event.target.value)}
                      />
                    </label>

                    <label className="profile-field">
                      <span className="profile-field-label">Handle</span>
                      <div className="profile-handle-wrap">
                        <span className="profile-handle-at">@</span>
                        <input
                          className="settings-input field-full"
                          placeholder="yourhandle"
                          value={profileHandle}
                          onChange={(event) =>
                            setProfileHandle(event.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))
                          }
                        />
                      </div>
                    </label>

                    <label className="profile-field">
                      <span className="profile-field-label">Avatar emoji</span>
                      <div className="profile-emoji-row">
                        <input
                          className="settings-input emoji-input"
                          value={profileEmoji}
                          maxLength={4}
                          aria-label="Avatar emoji"
                          onChange={(event) => setProfileEmoji(event.target.value)}
                        />
                        <span className="profile-emoji-hint">Shown when you have no photo.</span>
                      </div>
                    </label>

                    <div className="people-actions">
                      <button className="btn primary" type="button" onClick={() => void saveProfile()}>
                        Save profile
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === "general" && (
                <div className="settings-sections">
                  <div className="settings-section-title">Account</div>
                  <div className="settings-row">
                    <SelfAvatar user={user} email={user.email} className="user-avatar" />
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

/** Resize an image file to a small JPEG data URL (longest edge = size). */
async function downscaleImage(file: File, size: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** A person's avatar: their uploaded photo, else their emoji. */
function PersonAvatar({ person, size = 26 }: { person: Person; size?: number }) {
  if (person.avatarUrl) {
    return (
      <img className="person-avatar" src={person.avatarUrl} alt="" style={{ width: size, height: size }} />
    );
  }
  return (
    <span className="person-avatar emoji" style={{ width: size, height: size, fontSize: size * 0.55 }}>
      {person.avatarEmoji ?? "🙂"}
    </span>
  );
}

/** The signed-in user's avatar inside an existing avatar class. */
function SelfAvatar({
  user,
  email,
  className,
}: {
  user: { avatarUrl?: string; avatarEmoji?: string };
  email: string;
  className: string;
}) {
  if (user.avatarUrl) return <img className={`${className} photo`} src={user.avatarUrl} alt="" />;
  return <span className={className}>{user.avatarEmoji ?? initials(email)}</span>;
}

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

/** Split an attachment message (`📎 name\n/shared/<token>`) into name + token. */
export interface SharedAttachment {
  name: string;
  token: string;
  size?: number;
}

/** Decode the (unverified) payload of a signed share token: name + size. */
export function decodeShare(token: string): { n?: string; s?: number } | null {
  try {
    const body = token.split(".")[0];
    if (!body) return null;
    const b64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as { n?: string; s?: number };
  } catch {
    return null;
  }
}

/** Human-readable byte size, e.g. "1.2 MB". */
export function formatSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** Parse every attachment (`📎 name` + `/shared/<token>` pairs) in a message. */
export function sharedFilesOf(text: string): { files: SharedAttachment[]; caption: string } {
  const lines = text.split("\n");
  const files: SharedAttachment[] = [];
  let lastTokenLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const token = sharedTokenOf(lines[i]);
    if (!token) continue;
    const prev = (lines[i - 1] ?? "").replace(/^📎\s*/, "").trim();
    // Guard against a bare `/shared/<token>` line becoming the display name.
    const name = prev && !prev.startsWith("/shared/") ? prev : "Shared file";
    const decoded = decodeShare(token);
    const size = typeof decoded?.s === "number" ? decoded.s : undefined;
    files.push({ name, token, size });
    lastTokenLine = i;
  }
  // No attachments → nothing to report (don't treat the whole message as a caption).
  if (files.length === 0) return { files, caption: "" };
  // Anything after the last token line is the caption (Telegram-style).
  const caption = lines
    .slice(lastTokenLine + 1)
    .join("\n")
    .trim();
  return { files, caption };
}

export function sharedFileOf(text: string): { name: string; token: string; caption: string } | null {
  const { files, caption } = sharedFilesOf(text);
  if (files.length === 0) return null;
  return { name: files[0].name, token: files[0].token, caption };
}

/** One-line preview text for a message: shows the file name, never the raw token. */
export function previewText(text: string): string {
  const file = sharedFileOf(text);
  if (file) return (file.caption || `📎 ${file.name}`).replace(/\s+/g, " ").trim();
  return text.replace(/\s+/g, " ").trim();
}

/** A small type icon for a document row, chosen from the file extension. */
export function fileIconFor(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "📕";
  if (ext === "doc" || ext === "docx" || ext === "rtf" || ext === "odt") return "📘";
  if (ext === "xls" || ext === "xlsx" || ext === "csv" || ext === "ods") return "📗";
  if (ext === "ppt" || ext === "pptx" || ext === "odp") return "📙";
  if (ext === "zip" || ext === "rar" || ext === "7z" || ext === "tar" || ext === "gz") return "🗜️";
  if (ext === "txt" || ext === "md" || ext === "log") return "📄";
  if (ext === "json" || ext === "xml" || ext === "yml" || ext === "yaml") return "🧾";
  if (ext === "html" || ext === "htm" || ext === "css" || ext === "js" || ext === "ts") return "🧩";
  return "📎";
}

/** A voice note: play/pause + a waveform drawn from the decoded audio peaks. */
function VoiceNotePlayer({ src, onTranscribe }: { src: string; onTranscribe?: () => Promise<string> }) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(src);
        const buf = await res.arrayBuffer();
        const Ctor =
          typeof AudioContext !== "undefined"
            ? AudioContext
            : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        const audio = await ctx.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const buckets = 40;
        const size = Math.max(1, Math.floor(data.length / buckets));
        const out: number[] = [];
        for (let i = 0; i < buckets; i += 1) {
          let peak = 0;
          for (let j = 0; j < size; j += 1) {
            const value = Math.abs(data[i * size + j] ?? 0);
            if (value > peak) peak = value;
          }
          out.push(peak);
        }
        void ctx.close();
        if (!cancelled) {
          setPeaks(out.some((p) => p > 0) ? out : new Array(buckets).fill(0.2));
          setDuration(audio.duration);
        }
      } catch {
        if (!cancelled) setPeaks(new Array(40).fill(0.2));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play();
  }

  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  async function runTranscribe() {
    if (!onTranscribe || transcribing) return;
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const text = await onTranscribe();
      setTranscript(text || "(no speech detected)");
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : "transcription failed");
    } finally {
      setTranscribing(false);
    }
  }

  const bars = peaks.length > 0 ? peaks : new Array(40).fill(0.2);
  return (
    <div className="voice-note-wrap">
      <div className="voice-note">
        <button
          className="voice-note-play"
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={toggle}
        >
          {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
        </button>
        <div className="voice-note-wave">
          {bars.map((peak, index) => (
            <span
              key={index}
              className={`voice-note-bar${index / bars.length <= progress ? " played" : ""}`}
              style={{ height: `${Math.max(12, Math.round(peak * 100))}%` }}
            />
          ))}
        </div>
        <span className="voice-note-time">{formatTime(duration)}</span>
        {onTranscribe && (
          <button
            className="voice-note-transcribe"
            type="button"
            title="Transcribe"
            aria-label="Transcribe"
            disabled={transcribing}
            onClick={() => void runTranscribe()}
          >
            {transcribing ? "…" : "Aa"}
          </button>
        )}
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(event) => {
            const el = event.currentTarget;
            if (el.duration) setProgress(el.currentTime / el.duration);
          }}
        />
      </div>
      {transcript && <div className="voice-note-text">{transcript}</div>}
      {transcribeError && <div className="voice-note-error">{transcribeError}</div>}
    </div>
  );
}

/**
 * Render a message's attachment(s): inline media, a file chip, or an album grid
 * (multiple `📎 name` + `/shared/<token>` pairs), with an optional caption.
 * Pure presentational component so it can be unit-tested without the whole app.
 */
export function AttachmentMessage({
  text,
  onOpenImage,
  onOpenFile,
  onTranscribe,
}: {
  text: string;
  onOpenImage?: (file: SharedAttachment) => void;
  onOpenFile?: (url: string) => void;
  onTranscribe?: (token: string) => Promise<string>;
}) {
  const { files, caption } = sharedFilesOf(text);
  if (files.length === 0) return null;
  const urlFor = (shareToken: string): string =>
    `${CLOUD_URL}/v1/shared?share=${encodeURIComponent(shareToken)}&token=${encodeURIComponent(token() ?? "")}`;
  const media = (file: SharedAttachment) => {
    const url = urlFor(file.token);
    const lower = file.name.toLowerCase();
    // Voice notes (recorded clips) get the waveform player.
    if (/^voice-/i.test(file.name)) {
      return (
        <VoiceNotePlayer src={url} onTranscribe={onTranscribe ? () => onTranscribe(file.token) : undefined} />
      );
    }
    if (/\.(png|jpe?g|webp|gif|svg)$/.test(lower)) {
      return (
        <img
          className="dm-preview-img"
          src={url}
          alt={file.name}
          loading="lazy"
          onClick={() => onOpenImage?.(file)}
        />
      );
    }
    if (/\.(mp4|webm)$/.test(lower)) {
      return <video className="dm-preview-video" src={url} controls preload="metadata" />;
    }
    if (/\.(mp3|wav|ogg)$/.test(lower)) {
      return <audio className="dm-preview-audio" src={url} controls preload="metadata" />;
    }
    return (
      <button className="dm-file" type="button" onClick={() => onOpenFile?.(url)}>
        <span className="dm-file-ico">{fileIconFor(file.name)}</span>
        <span className="dm-file-name">{file.name}</span>
        {file.size ? <span className="dm-file-size">{formatSize(file.size)}</span> : null}
        <span className="dm-file-save">Save</span>
      </button>
    );
  };
  const captionNode = caption ? <div className="dm-caption">{caption}</div> : null;
  if (files.length === 1) {
    return (
      <div className="dm-media-wrap">
        {media(files[0])}
        {captionNode}
      </div>
    );
  }
  return (
    <div className="dm-album">
      <div className="dm-album-grid">
        {files.map((file) => (
          <div key={file.token} className="dm-album-cell">
            {media(file)}
          </div>
        ))}
      </div>
      {captionNode}
    </div>
  );
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
