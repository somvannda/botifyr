import type {
  BotSchedule,
  ChatMessage,
  CompanyDNA,
  Department,
  MediaRecipe,
  ModelPricingRecord,
  PlatformSettings,
  Task,
  WorkItem,
  WorkspaceBudget,
} from "@botifyr/shared";

export type { MediaRecipe, ModelPricingRecord, PlatformSettings };

/** Persistence contracts shared by the memory and Postgres stores. */

/** Subscription plan. "trial" is the free tier. */
export type Plan = "free" | "pro" | "business";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: "user" | "admin";
  plan?: Plan;
  /** Public @handle (unique, lower-case) for finding people. */
  handle?: string;
  displayName?: string;
  avatarEmoji?: string;
  avatarScheme?: number;
  /** Billing: free | plan | payg. */
  billingMode?: "free" | "plan" | "payg";
  /** Current paid period (prepaid plans). */
  periodStart?: string;
  periodEnd?: string;
  /** Grace deadline after an unpaid period end. */
  graceUntil?: string;
  /** active | grace | expired | free. */
  subStatus?: "active" | "grace" | "expired" | "free";
  /** Telegram chat to send billing reminders to (set when the user links it). */
  telegramChatId?: string;
  createdAt: string;
}

/** A pending/accepted friend request between two users. */
export interface FriendRequestRecord {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  updatedAt: string;
}

/** A conversation: id + owner + title + transcript. */
export interface SessionRecord {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  botId?: string;
  /** "bot" (default), a 1:1 "dm" between users, or a friend "group". */
  kind?: "bot" | "dm" | "group";
  /** For human conversations: the user ids in the thread. */
  participants?: string[];
  summary?: string;
  summaryUpTo?: number;
}

/** A bot: a named agent that owns one conversation thread. */
export interface BotRecord {
  id: string;
  userId: string;
  name: string;
  emoji: string;
  scheme: number;
  instructions: string;
  /** Company/workspace this bot belongs to (bots with the same value group). */
  workspace?: string;
  memberIds?: string[];
  autonomous?: boolean;
  skills?: string[];
  autoApprove?: boolean;
  schedule?: BotSchedule;
  sessionId: string;
  createdAt: string;
}

/** A virtual company (see docs/company-workspace.md). */
export interface WorkspaceRecord {
  id: string;
  ownerId: string;
  name: string;
  source: { kind: "url" | "idea"; value: string };
  mission: string;
  dna?: CompanyDNA;
  status: "onboarding" | "active" | "paused" | "archived";
  ceoBotId?: string;
  avatarEmoji?: string;
  scheme?: number;
  createdAt: string;
  updatedAt: string;
}

/** An employee's seat in a workspace. */
export interface BotRoleRecord {
  workspaceId: string;
  botId: string;
  title: string;
  department: Department;
  managerBotId?: string;
  isChair?: boolean;
  hiredAt: string;
}

/** A unit of work on the company board. */
export type WorkItemRecord = WorkItem;

/** A company's token budget. */
export type WorkspaceBudgetRecord = WorkspaceBudget;

export interface SecretRecord {
  id: string;
  userId: string;
  name: string;
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  taskId: string | null;
  userId: string | null;
  type: string;
  toolName: string | null;
  detail: string;
  createdAt: string;
}

/** Encrypted OAuth tokens for a connected third-party app. */
export interface ConnectionRecord {
  id: string;
  userId: string;
  provider: string;
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: string;
}

/** One model call's token usage, for cost control. */
export interface UsageRecord {
  id: string;
  userId: string;
  taskId: string | null;
  promptTokens: number;
  completionTokens: number;
  /** The model that produced this usage (for per-model pricing). */
  model?: string;
  createdAt: string;
}

/** A text file in a bot's Library. */
export interface FileRecord {
  id: string;
  botId: string;
  userId: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** A learned skill, shared across all users (self-trained capability library). */
export interface LearnedSkillRecord {
  id: string;
  name: string;
  description: string;
  content: string;
  source: string;
  createdBy: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

/** A hashed developer API key for the public API platform. */
export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  /** First few characters, shown in the UI so a key can be identified. */
  prefix: string;
  keyHash: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** Where a downloaded media item currently lives. */
export type MediaLocation = "server" | "device";

/** A downloadable file (video/audio/document), tracked so devices can sync. */
export interface MediaRecord {
  id: string;
  userId: string;
  taskId: string;
  name: string;
  size: number;
  mime: string;
  /** "server" = in the downloads volume; "device" = copied onto a device. */
  location: MediaLocation;
  /** Which device holds it (a stored device name / id). */
  device?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;

  createUser(record: UserRecord): Promise<void>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(id: string): Promise<UserRecord | null>;
  getUserByHandle(handle: string): Promise<UserRecord | null>;
  searchUsers(query: string, excludeId: string, limit: number): Promise<UserRecord[]>;
  updateUserProfile(
    id: string,
    profile: { handle?: string; displayName?: string; avatarEmoji?: string; avatarScheme?: number },
  ): Promise<void>;
  listUsers(): Promise<UserRecord[]>;
  setUserRole(id: string, role: "user" | "admin"): Promise<void>;
  setUserPlan(id: string, plan: Plan): Promise<void>;

  createFriendRequest(record: FriendRequestRecord): Promise<void>;
  getFriendRequest(id: string): Promise<FriendRequestRecord | null>;
  listFriendRequests(userId: string): Promise<FriendRequestRecord[]>;
  updateFriendRequest(record: FriendRequestRecord): Promise<void>;
  createFriendship(a: string, b: string): Promise<void>;
  /** User ids of this user's friends. */
  listFriends(userId: string): Promise<string[]>;
  areFriends(a: string, b: string): Promise<boolean>;
  deleteFriendship(a: string, b: string): Promise<boolean>;

  createToken(tokenHash: string, userId: string, expiresAt: string, kind?: string): Promise<void>;
  getUserIdByTokenHash(tokenHash: string, kind?: string): Promise<string | null>;
  deleteToken(tokenHash: string): Promise<void>;

  createSession(record: SessionRecord): Promise<void>;
  updateSession(record: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  listSessions(userId: string): Promise<SessionRecord[]>;
  /** Sessions the user owns or participates in (human/DM chats). */
  listConversations(userId: string): Promise<SessionRecord[]>;

  createBot(record: BotRecord): Promise<void>;
  getBot(id: string): Promise<BotRecord | null>;
  listBots(userId: string): Promise<BotRecord[]>;
  /** All bots that have a schedule (for the scheduler ticker). */
  listScheduledBots(): Promise<BotRecord[]>;
  updateBot(record: BotRecord): Promise<void>;
  deleteBot(userId: string, id: string): Promise<boolean>;

  /* Company workspaces */
  createWorkspace(record: WorkspaceRecord): Promise<void>;
  getWorkspace(id: string): Promise<WorkspaceRecord | null>;
  listWorkspaces(ownerId: string): Promise<WorkspaceRecord[]>;
  updateWorkspace(record: WorkspaceRecord): Promise<void>;
  deleteWorkspace(ownerId: string, id: string): Promise<boolean>;

  setBotRole(record: BotRoleRecord): Promise<void>;
  getBotRole(workspaceId: string, botId: string): Promise<BotRoleRecord | null>;
  listBotRoles(workspaceId: string): Promise<BotRoleRecord[]>;
  deleteBotRole(workspaceId: string, botId: string): Promise<boolean>;

  /* Company board (work items) */
  createWorkItem(record: WorkItemRecord): Promise<void>;
  getWorkItem(id: string): Promise<WorkItemRecord | null>;
  listWorkItems(workspaceId: string): Promise<WorkItemRecord[]>;
  updateWorkItem(record: WorkItemRecord): Promise<void>;
  deleteWorkItem(workspaceId: string, id: string): Promise<boolean>;

  /* Per-workspace budget */
  getWorkspaceBudget(workspaceId: string): Promise<WorkspaceBudgetRecord | null>;
  saveWorkspaceBudget(record: WorkspaceBudgetRecord): Promise<void>;

  createTask(task: Task): Promise<void>;
  updateTask(task: Task): Promise<void>;
  getTask(id: string): Promise<Task | null>;
  /** Tasks left in a non-terminal state (used to reconcile after a restart). */
  listActiveTasks(): Promise<Task[]>;
  /** All tasks the user owns (for a complete downloads history). */
  listTasksForUser(userId: string): Promise<Task[]>;

  appendAudit(record: AuditRecord): Promise<void>;
  listAudit(taskId: string): Promise<AuditRecord[]>;
  /** Most recent audit events across the whole platform (for the admin console). */
  listAuditRecent(limit: number): Promise<AuditRecord[]>;

  createSecret(record: SecretRecord): Promise<void>;
  listSecrets(userId: string): Promise<SecretRecord[]>;
  getSecret(userId: string, name: string): Promise<SecretRecord | null>;
  deleteSecret(userId: string, id: string): Promise<boolean>;

  upsertConnection(record: ConnectionRecord): Promise<void>;
  listConnections(userId: string): Promise<ConnectionRecord[]>;
  getConnection(userId: string, provider: string): Promise<ConnectionRecord | null>;
  deleteConnection(userId: string, provider: string): Promise<boolean>;

  addUsage(record: UsageRecord): Promise<void>;
  /** Total tokens + request count for a user since an ISO timestamp. */
  usageSince(userId: string, sinceIso: string): Promise<{ tokens: number; requests: number }>;

  upsertFile(record: FileRecord): Promise<void>;
  listFiles(botId: string): Promise<FileRecord[]>;
  getFile(userId: string, id: string): Promise<FileRecord | null>;
  deleteFile(userId: string, id: string): Promise<boolean>;

  upsertLearnedSkill(record: LearnedSkillRecord): Promise<void>;
  listLearnedSkills(): Promise<LearnedSkillRecord[]>;
  getLearnedSkill(id: string): Promise<LearnedSkillRecord | null>;
  getLearnedSkillByName(name: string): Promise<LearnedSkillRecord | null>;
  deleteLearnedSkill(userId: string, id: string): Promise<boolean>;

  createApiKey(record: ApiKeyRecord): Promise<void>;
  listApiKeys(userId: string): Promise<ApiKeyRecord[]>;
  getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  touchApiKey(id: string): Promise<void>;
  revokeApiKey(userId: string, id: string): Promise<boolean>;

  upsertMedia(record: MediaRecord): Promise<void>;
  listMedia(userId: string): Promise<MediaRecord[]>;
  getMedia(userId: string, id: string): Promise<MediaRecord | null>;
  updateMedia(record: MediaRecord): Promise<void>;
  deleteMedia(userId: string, id: string): Promise<boolean>;
  /** Remove every media record a task produced (used by retention cleanup). */
  deleteMediaByTask(taskId: string): Promise<number>;

  /* Billing */
  getPlatformSettings(): Promise<PlatformSettings>;
  savePlatformSettings(settings: PlatformSettings): Promise<void>;
  listModelPricing(): Promise<ModelPricingRecord[]>;
  saveModelPricing(record: ModelPricingRecord): Promise<void>;
  deleteModelPricing(model: string): Promise<boolean>;
  createInvoice(record: InvoiceRecord): Promise<void>;
  updateInvoice(record: InvoiceRecord): Promise<void>;
  getInvoice(id: string): Promise<InvoiceRecord | null>;
  getInvoiceByProviderPayment(providerPaymentId: string): Promise<InvoiceRecord | null>;
  listInvoices(userId: string, status?: string): Promise<InvoiceRecord[]>;
  listOpenInvoices(): Promise<InvoiceRecord[]>;
  getWallet(userId: string): Promise<WalletRecord>;
  addWalletCents(userId: string, deltaCents: number): Promise<WalletRecord>;
  addLedger(record: LedgerRecord): Promise<void>;
  listLedger(userId: string, limit?: number): Promise<LedgerRecord[]>;
  createNotification(record: NotificationRecord): Promise<void>;
  updateNotification(record: NotificationRecord): Promise<void>;
  listPendingNotifications(): Promise<NotificationRecord[]>;
  setUserBilling(
    id: string,
    fields: Partial<
      Pick<UserRecord, "plan" | "billingMode" | "periodStart" | "periodEnd" | "graceUntil" | "subStatus">
    >,
  ): Promise<void>;

  /* Media extraction recipes (self-learned, moderated). */
  listMediaRecipes(): Promise<MediaRecipe[]>;
  getMediaRecipe(domain: string): Promise<MediaRecipe | null>;
  saveMediaRecipe(record: MediaRecipe): Promise<void>;
  deleteMediaRecipe(domain: string): Promise<boolean>;
}

/* -------------------------------------------------------------------------- */
/* Billing records                                                            */
/* -------------------------------------------------------------------------- */

export type InvoiceKind = "plan" | "topup";

export interface InvoiceRecord {
  id: string;
  userId: string;
  kind: InvoiceKind;
  plan?: Plan;
  amountCents: number;
  currency: string;
  referenceId?: string;
  providerPaymentId?: string;
  checkoutUrl?: string;
  qrString?: string;
  providerStatus: "pending" | "paid" | "expired" | "failed" | "superseded" | "reversed";
  status: "open" | "paid" | "void";
  periodStart?: string;
  periodEnd?: string;
  /** Which reminders have fired, e.g. { d7: true }. */
  reminders: Record<string, boolean>;
  expiresAt?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletRecord {
  userId: string;
  balanceCents: number;
  updatedAt: string;
}

export interface LedgerRecord {
  id: string;
  userId: string;
  kind: "topup" | "usage" | "refund" | "grant";
  amountCents: number;
  tokens?: number;
  model?: string;
  note?: string;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  kind: string;
  subject?: string;
  body?: string;
  channels: string[];
  sent: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}
