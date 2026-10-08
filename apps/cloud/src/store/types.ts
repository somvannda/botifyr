import type {
  BotSchedule,
  CapabilityGrant,
  ChatMessage,
  CodeRepo,
  CompanyDNA,
  CompanyReport,
  Department,
  DeviceKey,
  MediaRecipe,
  ModelPricingRecord,
  OperatingHours,
  PlatformSettings,
  ProviderRole,
  ProviderRoleConfig,
  Quest,
  Task,
  WorkItem,
  WorkspaceBudget,
} from "@botifyr/shared";

export type {
  DeviceKey,
  MediaRecipe,
  ModelPricingRecord,
  PlatformSettings,
  ProviderRole,
  ProviderRoleConfig,
};

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
  /** Uploaded profile photo, stored as a small data URL (client-downscaled). */
  avatarUrl?: string;
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

/** A social post on the Feed (see docs/feed.md). */
export interface PostRecord {
  id: string;
  authorId: string;
  body: string;
  /** Optional reference into the `media` table (single image for v1). */
  mediaId?: string;
  /** Set when the post is authored by a Page (authorId = the Page id). */
  pageId?: string;
  /** Set when this post is a repost (share) of another post. */
  repostOf?: string;
  /** Who can see the post (docs/feed-next.md §FR-7). Defaults to friends. */
  audience?: "public" | "friends" | "only_me";
  createdAt: string;
  updatedAt: string;
}

/** A comment on a post. */
export interface PostCommentRecord {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  /** Set for a reply to another comment (one level deep). */
  parentId?: string;
  createdAt: string;
}

/** The reaction set (Facebook-style, docs/feed-next.md §FR-1). */
export type ReactionType = "like" | "love" | "care" | "haha" | "wow" | "sad" | "angry";

/** Per-viewer counters for one post. */
export interface PostStatsRecord {
  /** Total reactions (kept as `likes` for wire compatibility). */
  likes: number;
  comments: number;
  shares: number;
  likedByMe: boolean;
  sharedByMe: boolean;
  /** Count per reaction type. */
  reactions: Record<ReactionType, number>;
  /** The viewer's own reaction, if any. */
  myReaction: ReactionType | null;
}

/** A moderation report against a post. */
export interface PostReportRecord {
  id: string;
  postId: string;
  reporterId: string;
  reason?: string;
  status: "pending" | "reviewed" | "dismissed";
  createdAt: string;
}

/** One user blocking another (one-directional; enforced both ways on read). */
export interface BlockRecord {
  blockerId: string;
  blockedId: string;
  createdAt: string;
}

/** A Page: the public, followable face of a company workspace, bot, or user. */
export interface PageRecord {
  id: string;
  ownerId: string;
  /** Optional link to a company workspace (preferred mapping). */
  workspaceId?: string;
  /** Optional link to a bot. */
  botId?: string;
  /** Unique, lower-case public handle (no leading @). */
  handle: string;
  name: string;
  category?: string;
  about?: string;
  avatarEmoji?: string;
  avatarUrl?: string;
  coverUrl?: string;
  cta?: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A user's role on a Page. */
export type PageRole = "admin" | "editor" | "moderator" | "analyst";

export interface PageRoleRecord {
  pageId: string;
  userId: string;
  role: PageRole;
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
  operatingHours?: OperatingHours;
  autonomy?: "manual" | "supervised" | "autonomous";
  hours?: OperatingHours;
  ceoBotId?: string;
  /** The direction the CEO chose at setup (docs/company-quests.md). */
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

/** A company mission above the board (docs/company-quests.md). */
export type QuestRecord = Quest;

/** A company's token budget. */
export type WorkspaceBudgetRecord = WorkspaceBudget;

/** A per-subject capability grant. */
export type CapabilityGrantRecord = CapabilityGrant;

/** A company report (standup / weekly / incident). */
export type CompanyReportRecord = CompanyReport;

export interface SecretRecord {
  id: string;
  userId: string;
  /** When set, the secret is company-wide (visible to every employee). */
  workspaceId?: string;
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
  /** The quest this usage is attributed to, when the task ran under one (docs/company-quests.md §10.1). */
  questId?: string;
  createdAt: string;
}

/** A text file in a bot's Library. */
export interface FileRecord {
  id: string;
  botId: string;
  userId: string;
  /** When set, the file is company-wide (shared across the workspace). */
  workspaceId?: string;
  name: string;
  content: string;
  /** Optional department/category the file belongs to (docs). */
  department?: Department;
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
    profile: {
      handle?: string;
      displayName?: string;
      avatarEmoji?: string;
      avatarScheme?: number;
      /** null clears the uploaded photo; undefined leaves it unchanged. */
      avatarUrl?: string | null;
    },
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

  /* Feed (social posts) */
  createPost(record: PostRecord): Promise<void>;
  getPost(id: string): Promise<PostRecord | null>;
  /** Only the author may delete; cascades likes/comments/shares. */
  deletePost(authorId: string, id: string): Promise<boolean>;
  /** Attach an image to a post (multi-image; position orders the grid). */
  addPostMedia(postId: string, mediaId: string, position: number): Promise<void>;
  /** Media ids attached to a post, ordered by position. */
  listPostMedia(postId: string): Promise<string[]>;
  /* Hashtags */
  addPostTag(postId: string, tag: string): Promise<void>;
  listPostTags(postId: string): Promise<string[]>;
  /** Posts carrying a hashtag (lower-case, no `#`), newest first. */
  listPostsByTag(tag: string, limit: number): Promise<PostRecord[]>;
  /** Newest-first posts by any of `authorIds`, paged by ISO `before` cursor. */
  listFeedPosts(authorIds: string[], limit: number, before?: string): Promise<PostRecord[]>;
  listPostsByAuthor(authorId: string, limit: number): Promise<PostRecord[]>;
  /** Posts by `authorIds` since `sinceIso`, ranked by engagement. */
  listTrendingPosts(authorIds: string[], sinceIso: string, limit: number): Promise<PostRecord[]>;
  /** Set/replace the viewer's reaction, or clear it with `null`. */
  setPostReaction(postId: string, userId: string, reaction: ReactionType | null): Promise<void>;
  setCommentReaction(commentId: string, userId: string, reaction: ReactionType | null): Promise<void>;
  getCommentStats(
    commentId: string,
    viewerId: string,
  ): Promise<{ reactions: Record<ReactionType, number>; myReaction: ReactionType | null }>;
  listPostComments(postId: string): Promise<PostCommentRecord[]>;
  getPostComment(id: string): Promise<PostCommentRecord | null>;
  createPostComment(record: PostCommentRecord): Promise<void>;
  /** Only the comment author may delete. */
  deletePostComment(authorId: string, id: string): Promise<boolean>;
  setPostShare(postId: string, userId: string, shared: boolean): Promise<void>;
  getPostStats(postId: string, viewerId: string): Promise<PostStatsRecord>;
  /** Batch author lookup for feed serialization. */
  listUsersByIds(ids: string[]): Promise<UserRecord[]>;

  /* Moderation */
  blockUser(blockerId: string, blockedId: string): Promise<void>;
  unblockUser(blockerId: string, blockedId: string): Promise<boolean>;
  /** Ids this user has blocked (not who blocked them). */
  listBlockedIds(userId: string): Promise<string[]>;
  /** Ids blocked in either direction (for visibility filtering). */
  listBlockedEither(userId: string): Promise<string[]>;
  /** True if either user has blocked the other. */
  isBlockedEither(a: string, b: string): Promise<boolean>;
  createReport(record: PostReportRecord): Promise<void>;
  listReports(limit: number): Promise<PostReportRecord[]>;
  /** Resolve a report: mark it reviewed or dismissed. */
  updateReportStatus(id: string, status: PostReportRecord["status"]): Promise<boolean>;

  /* Pages (public, followable entities) */
  createPage(record: PageRecord): Promise<void>;
  getPage(id: string): Promise<PageRecord | null>;
  getPageByHandle(handle: string): Promise<PageRecord | null>;
  listPages(ownerId: string): Promise<PageRecord[]>;
  updatePage(record: PageRecord): Promise<void>;
  deletePage(ownerId: string, id: string): Promise<boolean>;
  setPageRole(record: PageRoleRecord): Promise<void>;
  getPageRole(pageId: string, userId: string): Promise<PageRoleRecord | null>;
  listPageRoles(pageId: string): Promise<PageRoleRecord[]>;
  deletePageRole(pageId: string, userId: string): Promise<boolean>;
  followPage(pageId: string, userId: string): Promise<void>;
  unfollowPage(pageId: string, userId: string): Promise<boolean>;
  isFollowingPage(pageId: string, userId: string): Promise<boolean>;
  listPageFollowerIds(pageId: string): Promise<string[]>;
  /** Page ids this user follows. */
  listFollowedPageIds(userId: string): Promise<string[]>;
  countPageFollowers(pageId: string): Promise<number>;

  createToken(tokenHash: string, userId: string, expiresAt: string, kind?: string): Promise<void>;
  getUserIdByTokenHash(tokenHash: string, kind?: string): Promise<string | null>;
  deleteToken(tokenHash: string): Promise<void>;

  createSession(record: SessionRecord): Promise<void>;
  updateSession(record: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  deleteSession(userId: string, id: string): Promise<boolean>;
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

  /* Company quests (missions above the board) */
  createQuest(record: QuestRecord): Promise<void>;
  getQuest(id: string): Promise<QuestRecord | null>;
  listQuests(workspaceId: string): Promise<QuestRecord[]>;
  updateQuest(record: QuestRecord): Promise<void>;

  /* Per-workspace budget */
  getWorkspaceBudget(workspaceId: string): Promise<WorkspaceBudgetRecord | null>;
  saveWorkspaceBudget(record: WorkspaceBudgetRecord): Promise<void>;

  /* Capability grants (authorization) */
  listCapabilityGrants(workspaceId: string): Promise<CapabilityGrantRecord[]>;
  setCapabilityGrant(record: CapabilityGrantRecord): Promise<void>;

  /* Company reports (standups) */
  createCompanyReport(record: CompanyReportRecord): Promise<void>;
  listCompanyReports(workspaceId: string): Promise<CompanyReportRecord[]>;

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
  /** Company secrets (visible to every employee). */
  listWorkspaceSecrets(workspaceId: string): Promise<SecretRecord[]>;
  getSecret(userId: string, name: string): Promise<SecretRecord | null>;
  getWorkspaceSecret(workspaceId: string, name: string): Promise<SecretRecord | null>;
  deleteSecret(userId: string, id: string): Promise<boolean>;

  upsertConnection(record: ConnectionRecord): Promise<void>;
  listConnections(userId: string): Promise<ConnectionRecord[]>;
  getConnection(userId: string, provider: string): Promise<ConnectionRecord | null>;
  deleteConnection(userId: string, provider: string): Promise<boolean>;

  addUsage(record: UsageRecord): Promise<void>;
  /** Total tokens + request count for a user since an ISO timestamp. */
  usageSince(userId: string, sinceIso: string): Promise<{ tokens: number; requests: number }>;
  /** Tokens attributed to a company quest (docs/company-quests.md §10.1). */
  usageTokensForQuest(questId: string): Promise<number>;

  upsertFile(record: FileRecord): Promise<void>;
  listFiles(botId: string): Promise<FileRecord[]>;
  /** Files shared across a company (the wiki). */
  listWorkspaceFiles(workspaceId: string): Promise<FileRecord[]>;
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
  /* Video translation: role-based provider registry (docs/video-translation.md). */
  listProviderRoles(): Promise<ProviderRoleConfig[]>;
  getProviderRole(role: ProviderRole): Promise<ProviderRoleConfig | null>;
  saveProviderRole(config: ProviderRoleConfig): Promise<void>;
  /* DM end-to-end encryption: devices publish their public identity key. */
  saveDeviceKey(record: DeviceKey): Promise<void>;
  listDeviceKeys(userId: string): Promise<DeviceKey[]>;
  getDeviceKey(userId: string, deviceId: string): Promise<DeviceKey | null>;
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
