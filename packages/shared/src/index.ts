/**
 * Shared contracts between the Botifyr cloud service and its clients
 * (desktop app, web, CLI). Keep this package free of DOM/Node specifics so it
 * can be imported from anywhere.
 */

/* -------------------------------------------------------------------------- */
/* Core domain                                                                 */
/* -------------------------------------------------------------------------- */

export type TaskStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface TaskStep {
  id: string;
  index: number;
  title: string;
  status: StepStatus;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

export type RiskLevel = "low" | "medium" | "high";

export type ApprovalStatus = "pending" | "allowed" | "denied";

/**
 * A decision the agent asks a human to make before taking a consequential
 * action (sending, paying, deleting, publishing...).
 */
export interface Approval {
  id: string;
  taskId: string;
  title: string;
  description: string;
  risk: RiskLevel;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface Task {
  id: string;
  sessionId: string;
  goal: string;
  status: TaskStatus;
  steps: TaskStep[];
  approval?: Approval;
  /** When the latest sandbox screenshot was captured (used to bust caches). */
  screenshotAt?: string;
  /** True while a live desktop framebuffer is available for this task. */
  liveStream?: boolean;
  result?: string;
  error?: string;
  /** How many times an interrupted batch download was auto-resumed. */
  resumeCount?: number;
  /** The company quest this task was run for, when one is active (docs/company-quests.md §10.1). */
  questId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** The task that produced this message (assistant) or that it started (user). */
  taskId?: string;
  /** The bot that authored an assistant message (set in group chats). */
  botId?: string;
  /** The user who sent a message in a human (friend) conversation. */
  senderId?: string;
}

export interface Session {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  /** The bot this thread belongs to. One bot === one conversation. */
  botId?: string;
  /** "bot" (default), a 1:1 "dm" between two users, or a friend "group". */
  kind?: "bot" | "dm" | "group";
  /** For human conversations: the user ids in the thread. */
  participants?: string[];
  /** Rolling summary of older turns, so long chats don't lose memory. */
  summary?: string;
  /** How many leading messages are already covered by `summary`. */
  summaryUpTo?: number;
}

/** A bot that runs a prompt automatically on a schedule. */
export interface BotSchedule {
  prompt: string;
  everyMinutes: number;
  enabled: boolean;
  /** When the scheduler should next fire (ISO). */
  nextRunAt?: string;
}

/** A built-in knowledge pack a bot can be taught. */
export interface Skill {
  id: string;
  name: string;
  description: string;
}

/** A skill a bot researched and saved for every bot to reuse (global). */
export interface LearnedSkill {
  id: string;
  name: string;
  description: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

/**
 * A bot is an agent the user talks to. It owns a single conversation thread,
 * has its own name, avatar colour and standing instructions.
 */
export interface Bot {
  id: string;
  userId: string;
  name: string;
  emoji: string;
  /** Index into the client's colour schemes. */
  scheme: number;
  /** Extra system guidance this bot always runs with. */
  instructions: string;
  /** Company/workspace this bot belongs to (bots with the same value group). */
  workspace?: string;
  /** For group chats: the bot ids that take turns replying. */
  memberIds?: string[];
  /** For group chats: every member reads each message and decides whether to reply. */
  autonomous?: boolean;
  /** Skill ids this bot has been taught (injected into its instructions). */
  skills?: string[];
  /** When true, consequential tools run without asking for approval. */
  autoApprove?: boolean;
  /** Optional schedule: run `prompt` every N minutes. */
  schedule?: BotSchedule;
  /** The conversation thread for this bot. */
  sessionId: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Company workspaces (see docs/company-workspace.md)                         */
/* -------------------------------------------------------------------------- */

export type WorkspaceStatus = "onboarding" | "active" | "paused" | "archived";

/** When a company may run autonomously. Hours are 0–23 in `timezone` (default UTC). */
export interface OperatingHours {
  /** Days of week (0 = Sun … 6 = Sat). Empty/undefined = every day. */
  days?: number[];
  /** Start hour, inclusive (0–23). */
  start: number;
  /** End hour, exclusive (1–24). */
  end: number;
  /** IANA timezone, e.g. "Asia/Phnom_Penh". Default UTC. */
  timezone?: string;
}

export type Department =
  | "exec"
  | "product"
  | "engineering"
  | "design"
  | "data"
  | "ai"
  | "growth"
  | "marketing"
  | "sales"
  | "support"
  | "success"
  | "ops"
  | "finance"
  | "legal"
  | "people"
  | "logistics";

/** How autonomous a company is (docs/company-os.md §22). */
export type WorkspaceAutonomy = "manual" | "supervised" | "autonomous";

/** A virtual company. Owns employees (bots), shared state, and a budget. */
/** A connected code repository the engineering team can read (read-only for now). */
export interface CodeRepo {
  id: string;
  /** Display name, e.g. "botifyr-web". */
  name: string;
  /** A local checkout path (server-local) the agents read. */
  path: string;
  /** Clone URL (reserved for managed checkouts). */
  url?: string;
  branch?: string;
  /** Secret name in the shared vault holding a clone token (never the token). */
  tokenSecret?: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  /** The CEO (a real user). */
  ownerId: string;
  name: string;
  /** The input that spawned it: a website or a free-form idea. */
  source: { kind: "url" | "idea"; value: string };
  mission: string;
  /** Structured company profile — the shared context every employee reads. */
  dna?: CompanyDNA;
  status: WorkspaceStatus;
  /** When the company may run autonomously (schedules outside this window don't fire). */
  operatingHours?: OperatingHours;
  /** manual = you drive it; supervised = schedules, approvals on; autonomous = schedules + auto-approve. */
  autonomy?: WorkspaceAutonomy;
  /** The company's operating hours; scheduled runs happen only within them. */
  hours?: OperatingHours;
  /** The chair bot that reports to the CEO. */
  ceoBotId?: string;
  /** The direction the CEO chose at setup; absent while still deciding (docs/company-quests.md). */
  directionId?: string;
  /** The current mission; at most one active quest at a time. */
  activeQuestId?: string;
  avatarEmoji?: string;
  scheme?: number;
  /** Code repositories the engineering team may read (docs/codebase-access.md). */
  repos?: CodeRepo[];
  createdAt: string;
  updatedAt: string;
}

/** The seat an employee bot fills in a workspace. */
export interface BotRole {
  workspaceId: string;
  botId: string;
  /** e.g. "CTO", "Head of Growth". */
  title: string;
  department: Department;
  /** The bot this one reports to (undefined = reports to the CEO). */
  managerBotId?: string;
  /** True for the single chair bot that aggregates standups to the CEO. */
  isChair?: boolean;
  hiredAt: string;
}

/** A workspace together with its employee roles (API shape). */
export interface WorkspaceWithRoles extends Workspace {
  roles: BotRole[];
  /** Tasks across the company waiting for the CEO's approval. */
  pending?: number;
}

export interface CreateWorkspaceRequest {
  name: string;
  source?: { kind: "url" | "idea"; value: string };
  mission?: string;
  /** Structured company profile (the business). */
  dna?: CompanyDNA;
  avatarEmoji?: string;
  scheme?: number;
  /** The bot to promote to CEO (the one that set the company up). */
  ceoBotId?: string;
  /** The direction the CEO chose at setup (docs/company-quests.md). */
  directionId?: string;
  /** The first mission to seed; when present, exactly one quest is created. */
  quest?: {
    title: string;
    objective: string;
    acceptance?: string[];
    roadmap?: Array<{ phase: WorkPhase; title: string }>;
  };
  /** New employee bots to create inside the workspace. */
  members?: Array<{
    name: string;
    emoji?: string;
    scheme?: number;
    instructions?: string;
    title: string;
    department?: Department;
    isChair?: boolean;
  }>;
  /** Existing owned bots to attach with a role. */
  memberships?: Array<{
    botId: string;
    title: string;
    department?: Department;
    isChair?: boolean;
    managerBotId?: string;
  }>;
}

/**
 * Structured company profile: the *business*, not the workforce
 * (docs/company-os.md §3). Injected into every employee's instructions.
 */
export interface CompanyDNA {
  industry: string;
  category: string;
  summary: string;
  businessModel: string;
  targetMarket: string[];
  targetCustomers: string[];
  product: { type: string; features: string[]; gaps: string[] };
  stage: "idea" | "mvp" | "launched" | "scaling";
  goal: string;
  priorities: string[];
  brand?: { tone: string; colors: string[]; logoUrl?: string; handles: Record<string, string> };
  metrics?: { arrCents?: number; customers?: number; source?: string };
}

/** How risky a capability is; money/consequential actions require approval. */
export type CapabilityRisk = "none" | "consequential" | "money";

/** A single thing an employee can do (docs/company-os.md §6, §8). */
export interface CapabilityDef {
  id: string;
  kind: "tool" | "connector";
  risk: CapabilityRisk;
  description: string;
}

/** A catalog role — what a hire is based on (docs/company-os.md §6). */
export interface RoleDefinition {
  id: string;
  title: string;
  department: Department;
  level: "ic" | "lead" | "head" | "exec";
  summary: string;
  jobDescription: string;
  skills: string[];
  capabilities: string[];
  kpis: string[];
  reportsTo?: string;
}

/** Employee lifecycle state. */
export type EmployeeStatus = "hired" | "working" | "paused" | "offboarded";

/** A unit of work on the company board (docs/company-os.md §7). */
export type WorkStatus = "todo" | "in_progress" | "blocked" | "review" | "done";

export type WorkPhase = "mvp" | "phase2" | "phase3" | "ongoing";

export interface WorkItem {
  id: string;
  workspaceId: string;
  title: string;
  detail?: string;
  /** What the work produced — the deliverable (a summary, file name, PR, report). */
  result?: string;
  phase: WorkPhase;
  status: WorkStatus;
  /** The employee (bot) it is assigned to, if any. */
  assigneeBotId?: string;
  department: Department;
  /** The quest this work belongs to, when it is part of a mission (docs/company-quests.md). */
  questId?: string;
  /** Who created it: a bot id or a user id. */
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A strategic option the CEO chooses when starting a company
 * (docs/company-quests.md §3.1). Agents propose 2–3 of these; the CEO picks one
 * and nothing is created until then.
 */
export interface CompanyDirection {
  /** Stable id, e.g. "dir_product". */
  id: string;
  /** "Ship the MVP", "Go to market", … */
  title: string;
  /** Why this direction, and why now (1–2 sentences). */
  thesis: string;
  stage: CompanyDNA["stage"];
  /** The 90-day win, in one line. */
  objective: string;
  /** 1–5 each. Lower is cheaper/safer; higher is faster/riskier. */
  tradeoffs: { speed: number; quality: number; cost: number; risk: number };
  /** `RoleDefinition` ids this direction would hire. */
  roles: string[];
  /** The proposed first backlog for the direction. */
  roadmap: Array<{ phase: WorkPhase; title: string }>;
  /** Rough token budget, so the CEO can weigh cost before choosing. */
  estimatedTokens: number;
  /** "Why these roles" — shown on the card. */
  rationale: string[];
}

export type QuestStatus = "proposed" | "active" | "blocked" | "done" | "abandoned";

/**
 * A mission: a thin goal layer above `WorkItem` (docs/company-quests.md §3.2).
 * At most one `active` quest per workspace, so attention and cost stay bounded.
 */
export interface Quest {
  id: string;
  workspaceId: string;
  directionId?: string;
  /** "Launch the cloud POS MVP". */
  title: string;
  /** What "done" delivers. */
  objective: string;
  /** Checklist the chair verifies before marking the quest done. */
  acceptance: string[];
  status: QuestStatus;
  stage: CompanyDNA["stage"];
  /** The lead role (usually the chair, `exec.ceo`). */
  ownerRoleId?: string;
  /** The autonomy dial for this quest; defaults to the workspace setting. */
  trust: WorkspaceAutonomy;
  /** Per-quest token cap; 0/undefined = inherit the workspace cap. */
  budgetTokens?: number;
  /** Work items that belong to this quest. */
  workItemIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** A company's token budget (0 limit = inherit the account cap). */
export interface WorkspaceBudget {
  workspaceId: string;
  limitTokens: number;
  usedTokens: number;
  updatedAt: string;
}

/** A per-subject capability grant within a company (docs/company-os.md §8). */
export interface CapabilityGrant {
  workspaceId: string;
  /** "bot:<id>" or "role:<title>". */
  subject: string;
  capability: string;
  granted: boolean;
  /** How far up the trust ladder this capability is (docs/product-plan.md §3). */
  state?: CapabilityTrust;
  /** Successful uses in the recent window (drives promotion). */
  successes?: number;
  /** Failed uses; any failure demotes the capability one step. */
  failures?: number;
  lastUsedAt?: string;
  updatedAt: string;
}

/** The trust ladder for a capability: approve every time → auto but watched → auto. */
export type CapabilityTrust = "gated" | "probation" | "trusted";

/** A report the company produces — e.g. a standup (docs/company-os.md §5). */
export type ReportKind = "standup" | "weekly" | "incident";

export interface CompanyReport {
  id: string;
  workspaceId: string;
  kind: ReportKind;
  summary: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Accounts, secrets, audit                                                    */
/* -------------------------------------------------------------------------- */

export interface User {
  id: string;
  email: string;
  createdAt: string;
  role: "user" | "admin";
  plan?: "free" | "pro" | "business";
  /** Public @handle for finding people. */
  handle?: string;
  displayName?: string;
  avatarEmoji?: string;
  avatarScheme?: number;
  /** Uploaded profile photo (small base64 data URL). */
  avatarUrl?: string;
}

export interface AuthResponse {
  token: string;
  /** Long-lived, rotating token used to mint a fresh access token. */
  refreshToken?: string;
  /** When the access token (`token`) expires. */
  expiresAt?: string;
  user: User;
}

export interface SecretSummary {
  id: string;
  name: string;
  createdAt: string;
}

/** A third-party app (Gmail, Calendar, Drive) the user has connected. */
export interface ConnectionInfo {
  provider: string;
  connectedAt: string;
}

/** A file saved to a bot's Library (text artifacts the agent can write/read). */
export interface BotFile {
  id: string;
  botId: string;
  name: string;
  size: number;
  updatedAt: string;
  /** Optional department/category the file belongs to. */
  department?: Department;
}

export interface CreateSecretRequest {
  name: string;
  value: string;
}

export type AuditEventType = "tool" | "approval" | "task";

export interface AuditEvent {
  id: string;
  taskId: string | null;
  userId: string | null;
  type: AuditEventType;
  toolName: string | null;
  detail: string;
  createdAt: string;
}

/** Runtime configuration the app shows so the user knows what is active. */
export interface RuntimeConfig {
  provider: string;
  capabilities: string[];
  sandbox: string;
  store: string;
  /** True when the keyless scripted demo model is in use. */
  demo: boolean;
  /** True when a local node (on the user's machine) is connected. */
  nodeOnline: boolean;
  /** Cost-control limits enforced by the cloud. */
  limits?: {
    rateLimitPerHour: number;
    maxOutputTokens: number;
    maxHistoryTurns: number;
    dailyTokenBudget: number;
  };
  /** The user's token usage since midnight. */
  usage?: {
    tokensToday: number;
    requestsToday: number;
  };
  /** ICE servers (STUN/TURN) for device-to-device transfer. */
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}

/* -------------------------------------------------------------------------- */
/* Billing (prepaid plans + on-demand credits)                                 */
/* -------------------------------------------------------------------------- */

export type BillingPlan = "free" | "pro" | "business";

/** Admin-editable billing policy (single `platform_settings` row). */
export interface PlatformSettings {
  plans: {
    proPriceCents: number;
    businessPriceCents: number;
    proPeriodDays: number;
    includedTokens: { pro: number; business: number };
    currency: string;
  };
  freeMonthlyTokens: number;
  lowBalanceCents: number;
  graceDays: number;
  reminderDays: number[];
  reminderChannels: { os: boolean; email: boolean; telegram: boolean };
  onDemand: {
    enabled: boolean;
    markupPercent: number;
    minTopUpCents: number;
    allowPro: boolean;
    onEmpty: "block" | "free";
  };
  fallbackPlan: BillingPlan;
}

/** Per-model provider cost; user price = cost × (1 + markup%). */
export interface ModelPricingRecord {
  model: string;
  provider?: string;
  inputCentsPerM: number;
  outputCentsPerM: number;
  markupPercent?: number;
  enabled: boolean;
  updatedAt: string;
}

/** Roles in the media pipeline that each route to their own provider/model. */
export type ProviderRole = "brain" | "translator" | "asr" | "tts" | "lipsync";

/**
 * One role's provider configuration (video translation, docs/video-translation.md).
 * Admin-managed; `keyRef` names an encrypted vault secret holding the API key.
 */
export interface ProviderRoleConfig {
  role: ProviderRole;
  provider: string;
  baseUrl?: string;
  model?: string;
  keyRef?: string;
  enabled: boolean;
  isDefault: boolean;
  /** Per-media-minute price in cents, used for billing. */
  pricing?: { perMinuteCents: number };
  updatedAt: string;
}

/**
 * A device's public identity key, published so peers can derive a shared key and
 * encrypt DMs to it. The private key never leaves the device.
 */
export interface DeviceKey {
  id: string;
  userId: string;
  deviceId: string;
  /** JWK of the device's public ECDH key. */
  publicKey: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * A self-learned extraction recipe for a domain yt-dlp doesn't support: how to
 * find the media URL on that site, learned once and reused deterministically.
 */
export interface MediaRecipe {
  domain: string;
  /** Regex matched against the page source / API body to find the stream URL. */
  pattern: string;
  /** Headers to send when fetching (Referer / User-Agent / cookies). */
  headers?: Record<string, string>;
  status: "pending" | "approved" | "rejected";
  createdBy?: string;
  /** Free-form note from the learner (e.g. the sample page used). */
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Realtime events (cloud -> client over the websocket stream)                 */
/* -------------------------------------------------------------------------- */

export type ServerEvent =
  | { type: "session.created"; session: Session }
  | { type: "session.updated"; session: Session }
  | { type: "bot.deleted"; botId: string; userId: string; sessionId?: string }
  | { type: "assistant.delta"; sessionId: string; taskId: string; botId?: string; text: string }
  | { type: "assistant.reset"; sessionId: string; taskId: string; botId?: string }
  | { type: "group.working"; sessionId: string; names: string[] }
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task }
  | { type: "approval.requested"; taskId: string; approval: Approval }
  | { type: "approval.resolved"; taskId: string; approval: Approval }
  | { type: "presence"; userId: string; online: boolean; toUserId: string }
  | { type: "friend.request"; requestId: string; fromUserId: string; toUserId: string }
  | { type: "feed.post"; postId: string; authorId: string }
  | { type: "feed.like"; postId: string; fromUserId: string; fromName?: string; toUserId: string }
  | { type: "feed.comment"; postId: string; fromUserId: string; fromName?: string; toUserId: string }
  | { type: "feed.share"; postId: string; fromUserId: string; fromName?: string; toUserId: string }
  | { type: "feed.mention"; postId: string; fromUserId: string; fromName?: string; toUserId: string }
  | { type: "p2p.signal"; toUserId: string; to: string; from: string; data: unknown }
  | { type: "task.completed"; task: Task }
  | { type: "task.failed"; task: Task };

/* -------------------------------------------------------------------------- */
/* Request payloads                                                            */
/* -------------------------------------------------------------------------- */

export interface CreateTaskRequest {
  goal: string;
}

export interface ResolveApprovalRequest {
  decision: "allow" | "deny";
}

/* The capability catalog (departments, roles, skills, capabilities). */
export * from "./catalog.js";
