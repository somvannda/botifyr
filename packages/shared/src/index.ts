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
}

export interface Session {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  /** The bot this thread belongs to. One bot === one conversation. */
  botId?: string;
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
/* Accounts, secrets, audit                                                    */
/* -------------------------------------------------------------------------- */

export interface User {
  id: string;
  email: string;
  createdAt: string;
  role: "user" | "admin";
  plan?: "trial" | "pro";
}

export interface AuthResponse {
  token: string;
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
}

/* -------------------------------------------------------------------------- */
/* Realtime events (cloud -> client over the websocket stream)                 */
/* -------------------------------------------------------------------------- */

export type ServerEvent =
  | { type: "session.created"; session: Session }
  | { type: "session.updated"; session: Session }
  | { type: "assistant.delta"; sessionId: string; taskId: string; botId?: string; text: string }
  | { type: "group.working"; sessionId: string; names: string[] }
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task }
  | { type: "approval.requested"; taskId: string; approval: Approval }
  | { type: "approval.resolved"; taskId: string; approval: Approval }
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
