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
  /** Set when the post belongs to a group. */
  groupId?: string;
  /** Optional album name grouping a post's photos. */
  album?: string;
  /** Who can see the post (docs/feed-next.md §FR-7). Defaults to friends. */
  audience?: "public" | "friends" | "only_me";
  /** Future publish time; hidden from others until then (docs/feed-next.md §FR-19). */
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A media attachment on a post, with optional alt text (accessibility). */
export interface PostMediaRecord {
  mediaId: string;
  /** Screen-reader description; omitted when the author left it blank. */
  alt?: string;
}

/** A single in-progress composer draft, synced per user. */
export interface PostDraftRecord {
  userId: string;
  body: string;
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
  /** Hidden by a Page moderator (excluded from public reads). */
  hidden?: boolean;
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

/** A poll attached to a post, resolved for a viewer. */
export interface PollRecord {
  postId: string;
  options: Array<{ id: string; label: string; votes: number }>;
  total: number;
  /** The viewer's chosen option id, if any. */
  myVote: string | null;
  closesAt?: string;
  closed: boolean;
}

/** Whether anyone may join a group, or a request must be approved. */
export type GroupPrivacy = "public" | "private";

/**
 * A member's role. The owner (`GroupRecord.ownerId`) is always an admin and is
 * not stored separately; `admin` here means an additional administrator.
 */
export type GroupRole = "admin" | "moderator" | "member";

/** A group: a community with members and its own post stream. */
export interface GroupRecord {
  id: string;
  ownerId: string;
  name: string;
  handle: string;
  about?: string;
  avatarEmoji?: string;
  /** Uploaded profile photo (data URL or signed media path). */
  avatarUrl?: string;
  /** Cover/banner image. */
  coverUrl?: string;
  /** Discovery category, e.g. "Technology". */
  category?: string;
  /** Public groups anyone may join; private groups require approval. */
  privacy: GroupPrivacy;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMemberRecord {
  groupId: string;
  userId: string;
  role: GroupRole;
  createdAt?: string;
}

/** A pending or resolved request to join a (private) group. */
export interface GroupJoinRequestRecord {
  groupId: string;
  userId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

/** A 24-hour ephemeral story (docs/feed-next.md §FR-13). */
export interface StoryRecord {
  id: string;
  authorId: string;
  mediaId?: string;
  caption: string;
  createdAt: string;
  expiresAt: string;
}

/** One viewer's reaction to a story (docs/feed-next.md §FR-13). */
export interface StoryReactionRecord {
  storyId: string;
  userId: string;
  emoji: string;
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
  /** Destination for the CTA button (http(s)/mailto/tel); `cta` is the label. */
  ctaUrl?: string;
  verified: boolean;
  /** Post pinned to the top of the Page timeline. */
  pinnedPostId?: string;
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
  /** For human conversations: per-user last-read timestamps (read receipts). */
  readAt?: Record<string, string>;
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
  /** Update a post's body; only the author may (POST-edit). */
  updatePostBody(authorId: string, id: string, body: string, updatedAt: string): Promise<boolean>;
  /** Only the author may delete; cascades likes/comments/shares. */
  deletePost(authorId: string, id: string): Promise<boolean>;
  /** Attach an image to a post (multi-image; position orders the grid). */
  addPostMedia(postId: string, mediaId: string, position: number, alt?: string): Promise<void>;
  /** Media attached to a post, ordered by position, with optional alt text. */
  listPostMedia(postId: string): Promise<PostMediaRecord[]>;
  /* Composer draft (one per user, synced across devices). */
  getPostDraft(userId: string): Promise<PostDraftRecord | null>;
  savePostDraft(draft: PostDraftRecord): Promise<void>;
  deletePostDraft(userId: string): Promise<void>;
  /* Hashtags */
  addPostTag(postId: string, tag: string): Promise<void>;
  listPostTags(postId: string): Promise<string[]>;
  /** Posts carrying a hashtag (lower-case, no `#`), newest first. */
  listPostsByTag(tag: string, limit: number): Promise<PostRecord[]>;
  /**
   * Newest-first posts by any of `authorIds`, paged by a stable keyset cursor
   * `(createdAt, id)` so posts sharing a timestamp are never skipped (DB-2).
   */
  listFeedPosts(
    authorIds: string[],
    limit: number,
    before?: { createdAt: string; id: string },
  ): Promise<PostRecord[]>;
  listPostsByAuthor(authorId: string, limit: number): Promise<PostRecord[]>;
  /** Posts by `authorIds` since `sinceIso`, ranked by engagement, paged by `offset`. */
  listTrendingPosts(
    authorIds: string[],
    sinceIso: string,
    limit: number,
    offset?: number,
  ): Promise<PostRecord[]>;
  /** Set/replace the viewer's reaction, or clear it with `null`. */
  setPostReaction(postId: string, userId: string, reaction: ReactionType | null): Promise<void>;
  setCommentReaction(commentId: string, userId: string, reaction: ReactionType | null): Promise<void>;
  /* Albums (photos grouped by name) */
  listAlbums(ownerId: string): Promise<Array<{ name: string; count: number }>>;
  listAlbumPosts(ownerId: string, album: string, limit: number): Promise<PostRecord[]>;

  /* Post controls (FR-10): save / hide / mute */
  setPostSaved(postId: string, userId: string, saved: boolean): Promise<void>;
  listSavedPostIds(userId: string): Promise<string[]>;
  setPostHidden(postId: string, userId: string, hidden: boolean): Promise<void>;
  listHiddenPostIds(userId: string): Promise<string[]>;
  /** Mute (until=null → unfollow) or clear an author for the user. */
  setAuthorMute(userId: string, authorId: string, until: string | null): Promise<void>;
  deleteAuthorMute(userId: string, authorId: string): Promise<boolean>;
  /** Author ids currently muted by the user (unfollow is indefinite). */
  listMutedAuthorIds(userId: string, nowIso: string): Promise<string[]>;

  /* Groups */
  createGroup(record: GroupRecord): Promise<void>;
  getGroup(id: string): Promise<GroupRecord | null>;
  getGroupByHandle(handle: string): Promise<GroupRecord | null>;
  /** Groups this user belongs to. */
  listGroupsForUser(userId: string): Promise<GroupRecord[]>;
  updateGroup(record: GroupRecord): Promise<void>;
  deleteGroup(ownerId: string, id: string): Promise<boolean>;
  setGroupMember(record: GroupMemberRecord): Promise<void>;
  deleteGroupMember(groupId: string, userId: string): Promise<boolean>;
  isGroupMember(groupId: string, userId: string): Promise<boolean>;
  listGroupMembers(groupId: string): Promise<GroupMemberRecord[]>;
  /** Newest-first posts belonging to a group. */
  listGroupPosts(groupId: string, limit: number): Promise<PostRecord[]>;
  /** Public groups matching an optional text query and/or category (discovery). */
  listDiscoverableGroups(opts: {
    query?: string;
    category?: string;
    limit: number;
    offset: number;
  }): Promise<GroupRecord[]>;
  /** Groups owned by this user (the ones they manage). */
  listGroupsOwnedBy(userId: string): Promise<GroupRecord[]>;
  /** Distinct categories across public groups, for the discovery filters. */
  listGroupCategories(): Promise<string[]>;
  getGroupMember(groupId: string, userId: string): Promise<GroupMemberRecord | null>;
  countGroupMembers(groupId: string): Promise<number>;
  /** Every join request for a group (any status), newest first. */
  listGroupJoinRequests(groupId: string): Promise<GroupJoinRequestRecord[]>;
  getGroupJoinRequest(groupId: string, userId: string): Promise<GroupJoinRequestRecord | null>;
  setGroupJoinRequest(record: GroupJoinRequestRecord): Promise<void>;
  deleteGroupJoinRequest(groupId: string, userId: string): Promise<boolean>;
  /** Delete a post regardless of author (group moderator/admin action). */
  deletePostById(id: string): Promise<boolean>;

  /* Stories (docs/feed-next.md §FR-13) */
  createStory(record: StoryRecord): Promise<void>;
  /** Unexpired stories by any of `authorIds`, newest first. */
  listActiveStories(authorIds: string[], nowIso: string, limit: number): Promise<StoryRecord[]>;
  /** A single story by id (view/reaction target validation). */
  getStory(id: string): Promise<StoryRecord | null>;
  /** Record that `userId` viewed `storyId` (idempotent). */
  markStoryViewed(storyId: string, userId: string, viewedAt: string): Promise<void>;
  /** Of `storyIds`, the ones `userId` has viewed. */
  listViewedStoryIds(userId: string, storyIds: string[]): Promise<string[]>;
  /** Set (or, with an empty emoji, clear) `userId`'s reaction to `storyId`. */
  setStoryReaction(storyId: string, userId: string, emoji: string): Promise<void>;
  /** All reactions for the given stories, for aggregation. */
  listStoryReactionRecords(storyIds: string[]): Promise<StoryReactionRecord[]>;

  /* Polls (docs/feed-next.md §FR-12) */
  createPoll(postId: string, options: string[], closesAt?: string): Promise<void>;
  getPoll(postId: string, viewerId: string): Promise<PollRecord | null>;
  /** Vote for an option (one per viewer; replaces a prior vote). */
  votePoll(postId: string, optionId: string, userId: string): Promise<boolean>;

  /** Page moderation: hide/unhide a comment. */
  setCommentHidden(commentId: string, hidden: boolean): Promise<void>;
  /** Recent comments on a Page's posts (its community inbox). */
  listPageComments(pageId: string, limit: number): Promise<PostCommentRecord[]>;
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
  /** All Pages (for discovery); newest first, bounded. */
  listAllPages(): Promise<PageRecord[]>;
  updatePage(record: PageRecord): Promise<void>;
  deletePage(ownerId: string, id: string): Promise<boolean>;
  /** Pin (or unpin with `null`) a post to the Page timeline. */
  setPagePinnedPost(pageId: string, postId: string | null): Promise<void>;
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
  /** Tokens spent on a single task, for provenance (docs/product-plan.md §3). */
  usageForTask(taskId: string): Promise<{ tokens: number; requests: number }>;

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
