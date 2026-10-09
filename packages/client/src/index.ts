import type {
  AuditEvent,
  AuthResponse,
  Bot,
  BotFile,
  CapabilityGrant,
  CompanyDNA,
  CompanyDirection,
  CompanyReport,
  ConnectionInfo,
  CreateWorkspaceRequest,
  Department,
  DeviceKey,
  LearnedSkill,
  MediaRecipe,
  ModelPricingRecord,
  PlatformSettings,
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

/**
 * Shared client for the Botifyr cloud API.
 *
 * Used by every front-end (the desktop app and the web portal), so the two
 * always see the same bots, sessions and events — the cloud is the single
 * source of truth and this is the one place that talks to it.
 */

export interface ConnectHandlers {
  onEvent: (event: ServerEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

/** A developer API key as shown in a list (never the secret). */
export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** An API key right after creation, including the one-time plaintext secret. */
export interface ApiKeyCreated extends ApiKeySummary {
  key: string;
}

/** A downloadable media item tracked across the user's devices. */
export interface MediaItem {
  id: string;
  taskId: string;
  name: string;
  size: number;
  mime: string;
  location: "server" | "device";
  device?: string;
  createdAt: string;
}

/** A person (friend or search hit) from the platform directory. */
export interface Person {
  id: string;
  handle?: string;
  displayName?: string;
  avatarEmoji?: string;
  avatarScheme?: number;
  /** Uploaded profile photo (small base64 data URL). */
  avatarUrl?: string;
  online: boolean;
  friend?: boolean;
  requested?: boolean;
  incoming?: boolean;
}

/** A Feed post author summary (see docs/feed.md). */
export interface FeedAuthor {
  id: string;
  handle?: string;
  displayName?: string;
  avatarEmoji?: string;
  avatarScheme?: number;
  avatarUrl?: string;
  online: boolean;
  /** True when the author is a Page rather than a person. */
  page?: boolean;
}

/** A comment on a Feed post. */
export interface FeedComment {
  id: string;
  author: FeedAuthor;
  body: string;
  /** Set for a reply to another comment (one level deep). */
  parentId?: string;
  createdAt: string;
  /** Count per reaction type on the comment. */
  reactions?: Record<string, number>;
  myReaction?: string | null;
  /** Hidden by a Page moderator. */
  hidden?: boolean;
}

/** A post in the Feed. */
export interface FeedPost {
  id: string;
  author: FeedAuthor;
  body: string;
  mediaId?: string;
  /** All attached image media ids (multi-image). */
  mediaIds?: string[];
  /** Short-lived signed paths to all attached images. */
  images?: string[];
  /** Per-image accessibility descriptions, parallel to `images`. */
  imageAlts?: string[];
  /** Short-lived signed paths to attached videos. */
  videos?: string[];
  /** Set when the post was authored by a Page. */
  pageId?: string;
  /** Set when this post is a repost (share) of another post. */
  repostOf?: string;
  /** Who can see the post: public | friends | only_me. */
  audience?: string;
  /** Future publish time (ISO); hidden from others until then. */
  scheduledAt?: string;
  /** True when the viewer has saved this post. */
  savedByMe?: boolean;
  /** Optional album name grouping the post's photos. */
  album?: string;
  /** Hashtags in the post (lower-case, no `#`). */
  hashtags?: string[];
  /** An attached poll, resolved for the viewer. */
  poll?: {
    postId: string;
    options: Array<{ id: string; label: string; votes: number }>;
    total: number;
    myVote: string | null;
    closesAt?: string;
    closed: boolean;
  };
  /** The reposted original, embedded (one level deep). */
  original?: FeedPost;
  /** Short-lived signed path to the attached image, if any. */
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
  likes: number;
  comments: number;
  shares: number;
  likedByMe: boolean;
  sharedByMe: boolean;
  /** Count per reaction type (like/love/care/haha/wow/sad/angry). */
  reactions?: Record<string, number>;
  /** The viewer's own reaction, if any. */
  myReaction?: string | null;
}

/** A community group with its own post stream. */
export interface Group {
  id: string;
  handle: string;
  name: string;
  about?: string;
  avatarEmoji?: string;
  /** Uploaded profile photo (data URL or signed media path). */
  avatarUrl?: string;
  /** Cover/banner image. */
  coverUrl?: string;
  category?: string;
  /** Public groups anyone may join; private groups require approval. */
  privacy: "public" | "private";
  ownerId: string;
  members: number;
  joined: boolean;
  /** The viewer's role, or null when not a member. */
  role: "admin" | "moderator" | "member" | null;
  /** True when the viewer owns the group. */
  owner: boolean;
  /** True when the viewer has a pending request to join. */
  requestPending: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A group member with their role and (best-effort) profile. */
export interface GroupMember {
  userId: string;
  role: "admin" | "moderator" | "member";
  owner: boolean;
  person: Person | null;
}

/** A pending request to join a private group. */
export interface GroupJoinRequest {
  userId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  person: Person | null;
}

/** A 24-hour ephemeral story. */
export interface Story {
  id: string;
  author: FeedAuthor;
  caption: string;
  imageUrl?: string;
  createdAt: string;
  expiresAt: string;
  /** True when the viewer has viewed this story (server-recorded). */
  viewedByMe?: boolean;
  /** Reaction counts per emoji. */
  reactions?: Record<string, number>;
  /** The viewer's own reaction emoji, if any. */
  myReaction?: string | null;
}

/** One page of the feed (newest first). */
export interface FeedPage {
  items: FeedPost[];
  nextCursor: string | null;
}

/** A public, followable Page (brand / bot / company face). */
export interface Page {
  id: string;
  handle: string;
  name: string;
  category?: string;
  about?: string;
  avatarEmoji?: string;
  avatarUrl?: string;
  coverUrl?: string;
  cta?: string;
  /** Destination for the CTA button; `cta` is the label. */
  ctaUrl?: string;
  verified: boolean;
  /** Post pinned to the top of the Page timeline. */
  pinnedPostId?: string;
  workspaceId?: string;
  botId?: string;
  followers: number;
  following: boolean;
  role: "admin" | "editor" | "moderator" | "analyst" | null;
  createdAt: string;
}

/** A human conversation (DM or friend group). */
export interface Conversation {
  id: string;
  kind: "dm" | "group";
  title: string;
  participants: string[];
  last?: { id: string; role: string; content: string; createdAt: string; senderId?: string };
  /** Per-user last-read timestamps (read receipts). */
  readAt?: Record<string, string>;
  createdAt: string;
}

/** A platform user as seen by the admin console. */
export interface AdminUser {
  id: string;
  email: string;
  role: "user" | "admin";
  plan: "free" | "pro" | "business";
  createdAt: string;
}

/** An audit entry shown in the admin console. */
export interface AdminAuditEvent {
  id: string;
  taskId: string | null;
  userId: string | null;
  type: string;
  toolName: string | null;
  detail: string;
  createdAt: string;
}

/** A learned skill with its full guide, for moderation. */
export interface AdminSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  status: "pending" | "approved" | "rejected";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A reported post shown in the admin console. */
export interface AdminReport {
  id: string;
  postId: string;
  reporterId: string;
  reason?: string;
  status: "pending" | "reviewed" | "dismissed";
  createdAt: string;
  postBody: string | null;
  postAuthor: string | null;
}

/** Thrown when the token is missing, invalid, or expired. */
export class AuthError extends Error {}

interface RequestOptions {
  method?: string;
  body?: BodyInit;
  json?: boolean;
  /** Explicit content-type for raw/binary bodies (not used with `json`). */
  contentType?: string;
}

export class BotifyrClient {
  private token: string | null = null;
  private refreshToken: string | null = null;

  /** Called whenever the token pair changes (login, refresh), so hosts can persist it. */
  onToken?: (auth: Pick<AuthResponse, "token" | "refreshToken" | "expiresAt">) => void;

  constructor(private readonly baseUrl: string) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  setRefreshToken(token: string | null): void {
    this.refreshToken = token;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  /** Adopt a freshly issued token pair and let the host persist it. */
  private adopt(auth: Pick<AuthResponse, "token" | "refreshToken" | "expiresAt">): void {
    this.token = auth.token;
    if (auth.refreshToken) this.refreshToken = auth.refreshToken;
    this.onToken?.(auth);
  }

  /**
   * Exchange the refresh token for a fresh access token. The server rotates the
   * refresh token, so the new one is adopted (and persisted by the host).
   */
  async refresh(): Promise<boolean> {
    const refreshToken = this.refreshToken;
    if (!refreshToken) return false;
    try {
      const response = await fetch(this.url("/auth/refresh"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        this.refreshToken = null;
        return false;
      }
      this.adopt((await response.json()) as AuthResponse);
      return true;
    } catch {
      return false;
    }
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async request<T>(path: string, options: RequestOptions = {}, allowRetry = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (options.json) headers["content-type"] = "application/json";
    else if (options.contentType) headers["content-type"] = options.contentType;
    // A JSON request must send a body, or Fastify rejects the empty payload.
    const body = options.body ?? (options.json ? "{}" : undefined);

    const response = await fetch(this.url(path), {
      method: options.method ?? "GET",
      headers,
      body,
    });

    if (!response.ok) {
      let detail = `request failed (${response.status})`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch {
        // keep the status-based message
      }
      // An expired access token is recovered by exchanging the refresh token.
      if (response.status === 401 && allowRetry && this.refreshToken && !path.startsWith("/auth/")) {
        if (await this.refresh()) return this.request<T>(path, options, false);
      }
      if (response.status === 401) throw new AuthError(detail);
      throw new Error(detail);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  config(): Promise<RuntimeConfig> {
    return this.request("/v1/config");
  }

  async signup(email: string, password: string): Promise<AuthResponse> {
    const auth = await this.request<AuthResponse>("/auth/signup", {
      method: "POST",
      json: true,
      body: JSON.stringify({ email, password }),
    });
    this.adopt(auth);
    return auth;
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const auth = await this.request<AuthResponse>("/auth/login", {
      method: "POST",
      json: true,
      body: JSON.stringify({ email, password }),
    });
    this.adopt(auth);
    return auth;
  }

  me(): Promise<User> {
    return this.request("/auth/me");
  }

  logout(): Promise<void> {
    return this.request<void>("/auth/logout", {
      method: "POST",
      json: true,
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    }).finally(() => {
      this.refreshToken = null;
    });
  }

  createSession(): Promise<Session> {
    return this.request("/v1/sessions", { method: "POST" });
  }

  listBots(): Promise<Bot[]> {
    return this.request("/v1/bots");
  }

  listSkills(): Promise<Skill[]> {
    return this.request("/v1/skills");
  }

  listLearnedSkills(): Promise<LearnedSkill[]> {
    return this.request("/v1/learned-skills");
  }

  billing(): Promise<{
    plan: "free" | "pro" | "business";
    billingMode: string;
    subStatus: string;
    periodEnd?: string;
    graceUntil?: string;
    walletCents: number;
    tokensThisMonth: number;
    freeMonthlyTokens: number;
    lowBalanceCents: number;
    includedTokens: { pro: number; business: number };
    prices: { proCents: number; businessCents: number; periodDays: number; currency: string };
    onDemand: {
      enabled: boolean;
      markupPercent: number;
      minTopUpCents: number;
      allowPro: boolean;
      onEmpty: string;
    };
    billingConfigured: boolean;
  }> {
    return this.request("/v1/billing");
  }

  billingCheckout(body: {
    kind: "plan" | "topup";
    plan?: "pro" | "business";
    amountCents?: number;
  }): Promise<{ invoiceId: string; url?: string; qr?: string }> {
    return this.request("/v1/billing/checkout", {
      method: "POST",
      json: true,
      body: JSON.stringify(body),
    });
  }

  listApiKeys(): Promise<ApiKeySummary[]> {
    return this.request("/v1/api-keys");
  }

  createApiKey(name: string): Promise<ApiKeyCreated> {
    return this.request("/v1/api-keys", { method: "POST", json: true, body: JSON.stringify({ name }) });
  }

  revokeApiKey(id: string): Promise<void> {
    return this.request(`/v1/api-keys/${id}`, { method: "DELETE" });
  }

  /* Platform admin (requires an admin account). */
  adminUsers(): Promise<AdminUser[]> {
    return this.request("/admin/users");
  }

  adminSetRole(id: string, role: "user" | "admin"): Promise<{ ok: boolean }> {
    return this.request(`/admin/users/${id}/role`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ role }),
    });
  }

  adminSetPlan(id: string, plan: "free" | "pro" | "business"): Promise<{ ok: boolean }> {
    return this.request(`/admin/users/${id}/plan`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ plan }),
    });
  }

  /* Billing policy + per-model pricing (admin). */
  adminSettings(): Promise<PlatformSettings> {
    return this.request("/admin/settings");
  }

  adminSaveSettings(settings: Partial<PlatformSettings>): Promise<PlatformSettings> {
    return this.request("/admin/settings", { method: "PUT", json: true, body: JSON.stringify(settings) });
  }

  adminModelPricing(): Promise<ModelPricingRecord[]> {
    return this.request("/admin/model-pricing");
  }

  adminSaveModelPricing(model: string, body: Partial<ModelPricingRecord>): Promise<ModelPricingRecord> {
    return this.request(`/admin/model-pricing/${encodeURIComponent(model)}`, {
      method: "PUT",
      json: true,
      body: JSON.stringify(body),
    });
  }

  adminDeleteModelPricing(model: string): Promise<void> {
    return this.request(`/admin/model-pricing/${encodeURIComponent(model)}`, { method: "DELETE" });
  }

  /* Self-learned extraction recipes (admin). */
  adminMediaRecipes(): Promise<MediaRecipe[]> {
    return this.request("/admin/media-recipes");
  }

  adminSaveMediaRecipe(domain: string, body: Partial<MediaRecipe>): Promise<MediaRecipe> {
    return this.request(`/admin/media-recipes/${encodeURIComponent(domain)}`, {
      method: "PUT",
      json: true,
      body: JSON.stringify(body),
    });
  }

  adminDeleteMediaRecipe(domain: string): Promise<void> {
    return this.request(`/admin/media-recipes/${encodeURIComponent(domain)}`, { method: "DELETE" });
  }

  /** Start "Botifyr's screen": a session-scoped desktop sandbox. */
  startComputer(sessionId: string): Promise<{ ok: boolean; streaming: boolean }> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/computer`, {
      method: "POST",
      json: true,
      body: "{}",
    });
  }

  /** Stop and remove a session's desktop container. */
  stopComputer(sessionId: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/computer/stop`, {
      method: "POST",
      json: true,
      body: "{}",
    });
  }

  /** Forward UI input into a session's desktop (click/type/key/scroll). */
  computerInput(
    sessionId: string,
    action: "click" | "move" | "type" | "key" | "scroll",
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean }> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/computer/input`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ action, args }),
    });
  }

  /** The recorded input trace for a session (teach-by-demonstration). */
  computerTrace(
    sessionId: string,
  ): Promise<{ steps: Array<{ t: number; action: string; args: Record<string, unknown> }> }> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/computer/trace`);
  }

  /** Turn a session's recorded trace into a learned task (pending review). */
  learnTask(
    sessionId: string,
    name?: string,
    description?: string,
  ): Promise<{ ok: boolean; id: string; name: string }> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/computer/learn`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ name, description }),
    });
  }

  /** Replay a learned task's steps on a session's desktop. */
  replayTask(sessionId: string, name: string): Promise<{ ok: boolean; steps: number }> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/computer/replay`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ name }),
    });
  }

  /** Start/stop a screen recording of a session's desktop. */
  recordComputer(sessionId: string, on: boolean): Promise<{ ok: boolean; output: string }> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/computer/record`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ on }),
    });
  }

  adminSkills(): Promise<AdminSkill[]> {
    return this.request("/admin/learned-skills");
  }

  adminSetSkillStatus(id: string, status: "pending" | "approved" | "rejected"): Promise<AdminSkill> {
    return this.request(`/admin/learned-skills/${id}/status`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ status }),
    });
  }

  adminDeleteSkill(id: string): Promise<void> {
    return this.request(`/admin/learned-skills/${id}`, { method: "DELETE" });
  }

  adminAudit(): Promise<AdminAuditEvent[]> {
    return this.request("/admin/audit");
  }

  adminReports(): Promise<AdminReport[]> {
    return this.request("/admin/reports");
  }

  adminResolveReport(id: string, status: "pending" | "reviewed" | "dismissed"): Promise<void> {
    return this.request(`/admin/reports/${id}`, {
      method: "PATCH",
      json: true,
      body: JSON.stringify({ status }),
    });
  }

  /* Media manifest — files the user has downloaded, and where they live. */
  listMedia(): Promise<MediaItem[]> {
    return this.request("/v1/media");
  }

  markMediaOnDevice(id: string, device: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/media/${id}`, {
      method: "PATCH",
      json: true,
      body: JSON.stringify({ location: "device", device }),
    });
  }

  deleteMedia(id: string, purge = false): Promise<void> {
    return this.request(`/v1/media/${id}${purge ? "?purge=1" : ""}`, { method: "DELETE" });
  }

  /** Create a signed, recipient-scoped link to a downloaded file. */
  shareMedia(id: string, toUserId: string): Promise<{ token: string; expiresAt: string }> {
    return this.request(`/v1/media/${encodeURIComponent(id)}/share`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ toUserId }),
    });
  }

  /** Upload a local file (base64) so it can be attached to a conversation. */
  uploadFile(input: { name: string; mime?: string; data: string }): Promise<MediaItem> {
    return this.request("/v1/uploads", {
      method: "POST",
      json: true,
      body: JSON.stringify(input),
    });
  }

  /** Upload a file as raw bytes (preferred for large media; no base64 inflation).
   *  Pass `onProgress` for byte-level progress (uses XHR; fetch has no upload
   *  progress event). Without it, the plain fetch path is used. */
  uploadFileRaw(
    input: { name: string; mime?: string; blob: Blob },
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<MediaItem> {
    const params = new URLSearchParams({ name: input.name });
    if (input.mime) params.set("mime", input.mime);
    const path = `/v1/uploads/raw?${params.toString()}`;
    if (onProgress && typeof XMLHttpRequest !== "undefined") {
      return this.uploadRawWithProgress(path, input.blob, onProgress);
    }
    return this.request(path, {
      method: "POST",
      body: input.blob,
      // Always octet-stream on the wire; the real MIME travels in `mime=`.
      contentType: "application/octet-stream",
    });
  }

  /** POST raw bytes via XHR so upload progress can be reported, with one
   *  refresh-and-retry on an expired token (mirrors `request`). */
  private uploadRawWithProgress(
    path: string,
    blob: Blob,
    onProgress: (loaded: number, total: number) => void,
    allowRetry = true,
  ): Promise<MediaItem> {
    return new Promise<MediaItem>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", this.url(path));
      if (this.token) xhr.setRequestHeader("authorization", `Bearer ${this.token}`);
      xhr.setRequestHeader("content-type", "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401 && allowRetry && this.refreshToken) {
          this.refresh()
            .then((ok) => {
              if (!ok) throw new AuthError("unauthorized");
              return this.uploadRawWithProgress(path, blob, onProgress, false);
            })
            .then(resolve, reject);
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          let detail = `upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            if (body?.error) detail = body.error;
          } catch {
            // keep the status-based message
          }
          reject(xhr.status === 401 ? new AuthError(detail) : new Error(detail));
          return;
        }
        try {
          resolve(JSON.parse(xhr.responseText || "{}") as MediaItem);
        } catch {
          reject(new Error("invalid upload response"));
        }
      };
      xhr.onerror = () => reject(new Error("upload failed"));
      xhr.onabort = () => reject(new Error("upload cancelled"));
      xhr.send(blob);
    });
  }

  /** Transcribe a shared voice note (server-side speech-to-text). */
  transcribe(share: string): Promise<{ text: string }> {
    return this.request("/v1/transcribe", {
      method: "POST",
      json: true,
      body: JSON.stringify({ share }),
    });
  }

  /** Translate text into a target language (used for per-chat auto-translate). */
  translate(text: string, to: string): Promise<{ text: string }> {
    return this.request("/v1/translate", {
      method: "POST",
      json: true,
      body: JSON.stringify({ text, to }),
    });
  }

  /* P2P: online devices of this user + a signaling relay for WebRTC. */
  listDevices(): Promise<Array<{ id: string; name: string; online: boolean }>> {
    return this.request("/v1/devices");
  }

  sendSignal(to: string, from: string, data: unknown): Promise<{ ok: boolean }> {
    return this.request("/v1/signal", {
      method: "POST",
      json: true,
      body: JSON.stringify({ to, from, data }),
    });
  }

  createBot(input: {
    name: string;
    emoji: string;
    scheme: number;
    instructions: string;
    workspace?: string;
    memberIds?: string[];
    autonomous?: boolean;
    skills?: string[];
    autoApprove?: boolean;
  }): Promise<Bot> {
    return this.request("/v1/bots", { method: "POST", json: true, body: JSON.stringify(input) });
  }

  deleteBot(id: string): Promise<void> {
    return this.request(`/v1/bots/${id}`, { method: "DELETE" });
  }

  updateBot(
    id: string,
    input: {
      name?: string;
      emoji?: string;
      scheme?: number;
      instructions?: string;
      workspace?: string;
      memberIds?: string[];
      autonomous?: boolean;
      skills?: string[];
      autoApprove?: boolean;
      schedule?: { prompt: string; everyMinutes: number; enabled: boolean };
    },
  ): Promise<Bot> {
    return this.request(`/v1/bots/${id}`, { method: "PUT", json: true, body: JSON.stringify(input) });
  }

  /* Company workspaces (see docs/company-workspace.md). */
  listWorkspaces(): Promise<WorkspaceWithRoles[]> {
    return this.request("/v1/workspaces");
  }

  getWorkspace(id: string): Promise<WorkspaceWithRoles> {
    return this.request(`/v1/workspaces/${id}`);
  }

  createWorkspace(input: CreateWorkspaceRequest): Promise<WorkspaceWithRoles> {
    return this.request("/v1/workspaces", { method: "POST", json: true, body: JSON.stringify(input) });
  }

  /** Propose an org chart from a website or an idea (creates nothing). */
  planCompany(source: { kind: "url" | "idea"; value: string; name?: string }): Promise<
    CreateWorkspaceRequest & {
      template?: string;
      rationale?: string[];
      dna?: CompanyDNA;
      notes?: string[];
      /** 2–3 directions the CEO chooses from (docs/company-quests.md). */
      directions?: CompanyDirection[];
    }
  > {
    return this.request("/v1/workspaces/plan", {
      method: "POST",
      json: true,
      body: JSON.stringify({ source }),
    });
  }

  /** Understand a website or idea → a Company DNA draft (creates nothing). */
  analyzeCompany(source: {
    kind: "url" | "idea";
    value: string;
  }): Promise<{ dna: CompanyDNA; notes: string[] }> {
    return this.request("/v1/workspaces/analyze", {
      method: "POST",
      json: true,
      body: JSON.stringify({ source }),
    });
  }

  /** Rewrite a rough idea into a concrete brief so the org is shaped right. */
  rewriteCompanyBrief(input: {
    kind: "url" | "idea";
    value: string;
    guidance?: string;
  }): Promise<{ brief: string }> {
    return this.request("/v1/workspaces/rewrite", {
      method: "POST",
      json: true,
      body: JSON.stringify({
        source: { kind: input.kind, value: input.value },
        guidance: input.guidance,
      }),
    });
  }

  /* Company board (work items). */
  listWorkItems(workspaceId: string): Promise<WorkItem[]> {
    return this.request(`/v1/workspaces/${workspaceId}/work`);
  }

  createWorkItem(
    workspaceId: string,
    input: {
      title: string;
      detail?: string;
      result?: string;
      phase?: WorkItem["phase"];
      status?: WorkItem["status"];
      assigneeBotId?: string;
      department?: Department;
    },
  ): Promise<WorkItem> {
    return this.request(`/v1/workspaces/${workspaceId}/work`, {
      method: "POST",
      json: true,
      body: JSON.stringify(input),
    });
  }

  updateWorkItem(
    id: string,
    input: {
      title?: string;
      detail?: string;
      result?: string | null;
      phase?: WorkItem["phase"];
      status?: WorkItem["status"];
      assigneeBotId?: string | null;
      department?: Department;
    },
  ): Promise<WorkItem> {
    return this.request(`/v1/work/${id}`, { method: "PATCH", json: true, body: JSON.stringify(input) });
  }

  deleteWorkItem(id: string): Promise<void> {
    return this.request(`/v1/work/${id}`, { method: "DELETE" });
  }

  /** Remove every task from the company board. */
  clearWorkItems(workspaceId: string): Promise<{ deleted: number }> {
    return this.request(`/v1/workspaces/${workspaceId}/work`, { method: "DELETE" });
  }

  /* Company quests (missions above the board, docs/company-quests.md). */
  listQuests(workspaceId: string): Promise<Quest[]> {
    return this.request(`/v1/workspaces/${workspaceId}/quests`);
  }

  createQuest(
    workspaceId: string,
    input: {
      title: string;
      objective: string;
      acceptance?: string[];
      directionId?: string;
      roadmap?: Array<{ phase: WorkItem["phase"]; title: string }>;
      trust?: WorkspaceWithRoles["autonomy"];
      activate?: boolean;
    },
  ): Promise<Quest> {
    return this.request(`/v1/workspaces/${workspaceId}/quests`, {
      method: "POST",
      json: true,
      body: JSON.stringify(input),
    });
  }

  updateQuest(
    id: string,
    input: {
      title?: string;
      objective?: string;
      acceptance?: string[];
      trust?: WorkspaceWithRoles["autonomy"];
      budgetTokens?: number | null;
      status?: Quest["status"];
    },
  ): Promise<Quest> {
    return this.request(`/v1/quests/${id}`, { method: "PATCH", json: true, body: JSON.stringify(input) });
  }

  completeQuest(workspaceId: string, id: string): Promise<Quest> {
    return this.request(`/v1/workspaces/${workspaceId}/quests/${id}/complete`, { method: "POST" });
  }

  /** Update a file's content or category (department). */
  updateFile(
    id: string,
    input: { content?: string; department?: string },
  ): Promise<{ id: string; name: string; department?: string }> {
    return this.request(`/v1/files/${id}`, {
      method: "PATCH",
      json: true,
      body: JSON.stringify(input),
    });
  }

  /** Tasks across the company's employees that are waiting for CEO approval. */
  listWorkspaceNeeds(workspaceId: string): Promise<Task[]> {
    return this.request(`/v1/workspaces/${workspaceId}/needs`);
  }

  /** Recent agent runs for a workspace — real execution, including failures. */
  listWorkspaceActivity(
    workspaceId: string,
  ): Promise<Array<{ id: string; goal: string; status: string; error: string | null; updatedAt: string }>> {
    return this.request(`/v1/workspaces/${workspaceId}/activity`);
  }

  /* Per-workspace budget. */
  getWorkspaceBudget(workspaceId: string): Promise<WorkspaceBudget> {
    return this.request(`/v1/workspaces/${workspaceId}/budget`);
  }

  setWorkspaceBudget(workspaceId: string, limitTokens: number): Promise<WorkspaceBudget> {
    return this.request(`/v1/workspaces/${workspaceId}/budget`, {
      method: "PATCH",
      json: true,
      body: JSON.stringify({ limitTokens }),
    });
  }

  /* Capability grants (authorization). */
  listCapabilityGrants(workspaceId: string): Promise<CapabilityGrant[]> {
    return this.request(`/v1/workspaces/${workspaceId}/grants`);
  }

  setCapabilityGrant(
    workspaceId: string,
    input: { subject: string; capability: string; granted?: boolean; state?: CapabilityGrant["state"] },
  ): Promise<CapabilityGrant> {
    return this.request(`/v1/workspaces/${workspaceId}/grants`, {
      method: "PUT",
      json: true,
      body: JSON.stringify(input),
    });
  }

  /* Company reports (standups). */
  listCompanyReports(workspaceId: string): Promise<CompanyReport[]> {
    return this.request(`/v1/workspaces/${workspaceId}/reports`);
  }

  runStandup(
    workspaceId: string,
    kind: "standup" | "weekly" | "incident" = "standup",
  ): Promise<CompanyReport> {
    return this.request(`/v1/workspaces/${workspaceId}/standup`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ kind }),
    });
  }

  /** Stop every running task across the company's employees. */
  stopCompany(workspaceId: string): Promise<{ stopped: number }> {
    return this.request(`/v1/workspaces/${workspaceId}/stop`, { method: "POST", json: true });
  }

  /** Activate the company (schedules + auto-approve per level). */
  activateCompany(
    workspaceId: string,
    level: "manual" | "supervised" | "autonomous",
    timezone?: string,
  ): Promise<WorkspaceWithRoles> {
    return this.request(`/v1/workspaces/${workspaceId}/activate`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ level, timezone }),
    });
  }

  /** Run now: fire every employee's scheduled prompt immediately. */
  runCompany(workspaceId: string): Promise<{ started: number }> {
    return this.request(`/v1/workspaces/${workspaceId}/run`, { method: "POST", json: true });
  }

  /** Staged code changes (from code.apply) awaiting the CEO's review. */
  listProposals(
    workspaceId: string,
  ): Promise<Array<{ repo: string; path: string; content: string; diff: string; exists: boolean }>> {
    return this.request(`/v1/workspaces/${workspaceId}/proposals`);
  }

  /** Connect a repo: clone a URL (with an optional vault token) or a local path. */
  addWorkspaceRepo(
    workspaceId: string,
    input: { name: string; url?: string; path?: string; branch?: string; tokenSecret?: string },
  ): Promise<{ id: string; name: string; path: string }> {
    return this.request(`/v1/workspaces/${workspaceId}/repos`, {
      method: "POST",
      json: true,
      body: JSON.stringify(input),
    });
  }

  /** Deactivate the company (manual, schedules off, auto-approve off). */
  deactivateCompany(workspaceId: string): Promise<WorkspaceWithRoles> {
    return this.request(`/v1/workspaces/${workspaceId}/deactivate`, { method: "POST", json: true });
  }

  updateWorkspace(
    id: string,
    input: {
      name?: string;
      mission?: string;
      status?: "onboarding" | "active" | "paused" | "archived";
      avatarEmoji?: string;
      scheme?: number;
      ceoBotId?: string;
      operatingHours?: { start: number; end: number; days?: number[]; timezone?: string };
      repos?: Array<{
        id?: string;
        name: string;
        path: string;
        url?: string;
        branch?: string;
        createdAt?: string;
      }>;
    },
  ): Promise<WorkspaceWithRoles> {
    return this.request(`/v1/workspaces/${id}`, {
      method: "PATCH",
      json: true,
      body: JSON.stringify(input),
    });
  }

  deleteWorkspace(id: string): Promise<void> {
    return this.request(`/v1/workspaces/${id}`, { method: "DELETE" });
  }

  listSessions(): Promise<Session[]> {
    return this.request("/v1/sessions");
  }

  sendMessage(
    sessionId: string,
    text: string,
    local = false,
  ): Promise<{ session: Session; task: Task; warning?: string }> {
    return this.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ text, local }),
    });
  }

  createTask(sessionId: string, goal: string): Promise<Task> {
    return this.request(`/v1/sessions/${sessionId}/tasks`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ goal }),
    });
  }

  retry(sessionId: string, local = false): Promise<{ session: Session; task: Task; warning?: string }> {
    return this.request(`/v1/sessions/${sessionId}/retry`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ local }),
    });
  }

  resolveApproval(taskId: string, approvalId: string, decision: "allow" | "deny"): Promise<void> {
    return this.request(`/v1/tasks/${taskId}/approvals/${approvalId}`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ decision }),
    });
  }

  cancelSession(sessionId: string): Promise<{ stopped: number }> {
    return this.request(`/v1/sessions/${sessionId}/cancel`, { method: "POST", json: true, body: "{}" });
  }

  /* Direct messages with friends. */
  /* DM E2E: publish this device's public key; fetch a peer's published keys. */
  registerDeviceKey(deviceId: string, publicKey: JsonWebKey): Promise<void> {
    return this.request("/v1/device-keys", {
      method: "POST",
      json: true,
      body: JSON.stringify({ deviceId, publicKey }),
    });
  }

  listDeviceKeys(userId: string): Promise<DeviceKey[]> {
    return this.request(`/v1/users/${encodeURIComponent(userId)}/device-keys`);
  }

  listConversations(): Promise<Conversation[]> {
    return this.request("/v1/conversations");
  }

  openDm(userId: string): Promise<Session> {
    return this.request(`/v1/dm/${userId}`, { method: "POST", json: true, body: "{}" });
  }

  /** Delete a personal conversation (DM or friend group) for good. */
  deleteConversation(id: string): Promise<void> {
    return this.request(`/v1/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /** Rename a group conversation. */
  renameConversation(id: string, title: string): Promise<Session> {
    return this.request(`/v1/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: true,
      body: JSON.stringify({ title }),
    });
  }

  /** Add a friend to a group. */
  addConversationMember(id: string, userId: string): Promise<Session> {
    return this.request(`/v1/conversations/${encodeURIComponent(id)}/members`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ userId }),
    });
  }

  /** Toggle the caller's reaction on a message (empty emoji clears it). */
  setMessageReaction(sessionId: string, messageId: string, emoji: string): Promise<Session> {
    return this.request(
      `/v1/conversations/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(
        messageId,
      )}/reactions`,
      { method: "POST", json: true, body: JSON.stringify({ emoji }) },
    );
  }

  /** Mark a conversation read up to now (read receipts). */
  markConversationRead(id: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/conversations/${encodeURIComponent(id)}/read`, {
      method: "POST",
      json: true,
      body: "{}",
    });
  }

  /** Signal to the conversation's other participants that this user is typing. */
  sendTyping(id: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/conversations/${encodeURIComponent(id)}/typing`, {
      method: "POST",
      json: true,
      body: "{}",
    });
  }

  /** Remove a member from a group (removing yourself leaves the group). */
  removeConversationMember(id: string, userId: string): Promise<Session> {
    return this.request(`/v1/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
  }

  createFriendGroup(participantIds: string[], title: string): Promise<Session> {
    return this.request("/v1/conversations", {
      method: "POST",
      json: true,
      body: JSON.stringify({ participantIds, title }),
    });
  }

  sendDm(sessionId: string, text: string): Promise<{ session: Session }> {
    return this.request(`/v1/dm/${sessionId}/messages`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ text }),
    });
  }

  /* Friends & people directory. */
  listFriends(): Promise<Person[]> {
    return this.request("/v1/friends");
  }

  listFriendRequests(): Promise<Array<{ id: string; direction: "incoming" | "outgoing"; person: Person }>> {
    return this.request("/v1/friend-requests");
  }

  searchPeople(query: string): Promise<Person[]> {
    return this.request(`/v1/people?q=${encodeURIComponent(query)}`);
  }

  /** Resolve an `@handle` to a person and their recent posts (mention routing). */
  getPersonByHandle(handle: string): Promise<{ person: Person; posts: FeedPost[] }> {
    return this.request(`/v1/people/by-handle/${encodeURIComponent(handle)}`);
  }

  /** "Who to follow": people who aren't friends or already pending. */
  suggestPeople(limit = 8): Promise<Person[]> {
    return this.request(`/v1/people/suggestions?limit=${limit}`);
  }

  addFriend(userId: string): Promise<{ ok: boolean; friend?: boolean; pending?: boolean }> {
    return this.request("/v1/friend-requests", {
      method: "POST",
      json: true,
      body: JSON.stringify({ userId }),
    });
  }

  respondFriendRequest(id: string, action: "accept" | "decline"): Promise<{ ok: boolean; friend?: boolean }> {
    return this.request(`/v1/friend-requests/${id}`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ action }),
    });
  }

  removeFriend(userId: string): Promise<void> {
    return this.request(`/v1/friends/${userId}`, { method: "DELETE" });
  }

  updateProfile(input: {
    handle?: string;
    displayName?: string;
    avatarEmoji?: string;
    avatarScheme?: number;
    /** null removes the uploaded photo. */
    avatarUrl?: string | null;
  }): Promise<User> {
    return this.request("/v1/profile", { method: "PATCH", json: true, body: JSON.stringify(input) });
  }

  /* Feed (social posts). */
  listFeed(cursor?: string, limit = 20, opts?: { tab?: string; sort?: string }): Promise<FeedPage> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("limit", String(limit));
    if (opts?.tab) params.set("tab", opts.tab);
    if (opts?.sort) params.set("sort", opts.sort);
    return this.request(`/v1/feed?${params.toString()}`);
  }

  createPost(input: {
    body: string;
    mediaId?: string;
    mediaIds?: string[];
    /** Per-media alt text, index-aligned with `[mediaId, ...mediaIds]`. */
    alts?: string[];
    pageId?: string;
    groupId?: string;
    audience?: "public" | "friends" | "only_me";
    scheduledAt?: string;
    album?: string;
    poll?: string[];
  }): Promise<FeedPost> {
    return this.request("/v1/posts", { method: "POST", json: true, body: JSON.stringify(input) });
  }

  deletePost(id: string): Promise<void> {
    return this.request(`/v1/posts/${id}`, { method: "DELETE" });
  }

  /** Fetch a single post (permalink / detail view). */
  getPost(id: string): Promise<FeedPost> {
    return this.request(`/v1/posts/${id}`);
  }

  /** Edit an owned post's body. */
  editPost(id: string, body: string): Promise<FeedPost> {
    return this.request(`/v1/posts/${id}`, {
      method: "PATCH",
      json: true,
      body: JSON.stringify({ body }),
    });
  }

  likePost(id: string, liked = true): Promise<void> {
    return this.request(`/v1/posts/${id}/like`, { method: liked ? "PUT" : "DELETE" });
  }

  /** Set a specific reaction (like|love|care|haha|wow|sad|angry). */
  reactPost(id: string, reaction: string): Promise<void> {
    return this.request(`/v1/posts/${id}/reaction?reaction=${encodeURIComponent(reaction)}`, {
      method: "PUT",
      json: true,
      body: "{}",
    });
  }

  unreactPost(id: string): Promise<void> {
    return this.request(`/v1/posts/${id}/reaction`, { method: "DELETE" });
  }

  reactComment(id: string, reaction: string): Promise<void> {
    return this.request(`/v1/comments/${id}/reaction?reaction=${encodeURIComponent(reaction)}`, {
      method: "PUT",
      json: true,
      body: "{}",
    });
  }

  unreactComment(id: string): Promise<void> {
    return this.request(`/v1/comments/${id}/reaction`, { method: "DELETE" });
  }

  hideComment(id: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/comments/${id}/hide`, { method: "POST", json: true, body: "{}" });
  }

  unhideComment(id: string): Promise<void> {
    return this.request(`/v1/comments/${id}/hide`, { method: "DELETE" });
  }

  /** A Page's community inbox: recent comments on its posts. */
  pageInbox(id: string): Promise<
    Array<{
      id: string;
      postId: string;
      body: string;
      hidden: boolean;
      createdAt: string;
      author: FeedAuthor;
    }>
  > {
    return this.request(`/v1/pages/${id}/inbox`);
  }

  listComments(id: string): Promise<FeedComment[]> {
    return this.request(`/v1/posts/${id}/comments`);
  }

  /** One page of a post's comments, newest page last (POST-12). */
  listCommentsPage(
    id: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ items: FeedComment[]; nextCursor: string | null }> {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    return this.request(`/v1/posts/${id}/comments?${params.toString()}`);
  }

  addComment(id: string, body: string, parentId?: string): Promise<FeedComment> {
    return this.request(`/v1/posts/${id}/comments`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ body, parentId }),
    });
  }

  deleteComment(id: string): Promise<void> {
    return this.request(`/v1/comments/${id}`, { method: "DELETE" });
  }

  sharePost(id: string, shared = true): Promise<void> {
    return this.request(`/v1/posts/${id}/share`, { method: shared ? "PUT" : "DELETE" });
  }

  /** Repost (share) a post, optionally with a caption. Returns the new post. */
  repost(id: string, caption?: string): Promise<FeedPost> {
    return this.request(`/v1/posts/${id}/repost`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ caption }),
    });
  }

  listUserPosts(handle: string): Promise<FeedPost[]> {
    return this.request(`/v1/users/${encodeURIComponent(handle)}/posts`);
  }

  /** Posts carrying a hashtag (no leading `#` needed). */
  listTagPosts(tag: string): Promise<FeedPost[]> {
    return this.request(`/v1/tags/${encodeURIComponent(tag.replace(/^#/, ""))}/posts`);
  }

  /** The viewer's saved composer draft (server-synced), if any. */
  getPostDraft(): Promise<{ body: string; updatedAt: string } | null> {
    return this.request("/v1/posts/draft");
  }

  /** Save (or clear, when blank) the composer draft. */
  savePostDraft(body: string): Promise<{ ok: boolean }> {
    return this.request("/v1/posts/draft", {
      method: "PUT",
      json: true,
      body: JSON.stringify({ body }),
    });
  }

  deletePostDraft(): Promise<{ ok: boolean }> {
    return this.request("/v1/posts/draft", { method: "DELETE" });
  }

  /** The viewer's own upcoming (scheduled) posts. */
  listScheduled(): Promise<FeedPost[]> {
    return this.request("/v1/posts/scheduled");
  }

  /* Stories (24-hour ephemeral). */
  createStory(input: { mediaId?: string; caption?: string }): Promise<{ ok: boolean }> {
    return this.request("/v1/stories", { method: "POST", json: true, body: JSON.stringify(input) });
  }

  listStories(): Promise<Story[]> {
    return this.request("/v1/stories");
  }

  /** Mark a story as viewed (server-side, idempotent). */
  viewStory(id: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/stories/${encodeURIComponent(id)}/view`, {
      method: "POST",
      json: true,
      body: "{}",
    });
  }

  /** Set (or, with an empty emoji, clear) the viewer's reaction to a story. */
  reactStory(id: string, emoji: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/stories/${encodeURIComponent(id)}/reaction`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ emoji }),
    });
  }

  /* Groups (communities). */
  listGroups(): Promise<Group[]> {
    return this.request("/v1/groups");
  }

  /** Groups the viewer owns (the ones they administer). */
  listManagedGroups(): Promise<Group[]> {
    return this.request("/v1/groups/managed");
  }

  /** Public-group discovery with optional search + category filter. */
  discoverGroups(opts?: { query?: string; category?: string; limit?: number; offset?: number }): Promise<Group[]> {
    const params = new URLSearchParams();
    if (opts?.query) params.set("q", opts.query);
    if (opts?.category) params.set("category", opts.category);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return this.request(`/v1/groups/discover${qs ? `?${qs}` : ""}`);
  }

  /** Categories present across public groups. */
  groupCategories(): Promise<{ categories: string[] }> {
    return this.request("/v1/groups/categories");
  }

  createGroup(input: {
    name: string;
    handle?: string;
    about?: string;
    avatarEmoji?: string;
    avatarUrl?: string;
    coverUrl?: string;
    category?: string;
    privacy?: "public" | "private";
  }): Promise<Group> {
    return this.request("/v1/groups", { method: "POST", json: true, body: JSON.stringify(input) });
  }

  updateGroup(
    id: string,
    input: {
      name?: string;
      handle?: string;
      about?: string;
      avatarEmoji?: string;
      avatarUrl?: string;
      coverUrl?: string;
      category?: string;
      privacy?: "public" | "private";
    },
  ): Promise<Group> {
    return this.request(`/v1/groups/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: true,
      body: JSON.stringify(input),
    });
  }

  deleteGroup(id: string): Promise<void> {
    return this.request(`/v1/groups/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  getGroup(handle: string): Promise<Group> {
    return this.request(`/v1/groups/${encodeURIComponent(handle)}`);
  }

  groupPosts(handle: string): Promise<FeedPost[]> {
    return this.request(`/v1/groups/${encodeURIComponent(handle)}/posts`);
  }

  /** Join a public group, or request to join a private one. */
  joinGroup(id: string): Promise<{ ok: boolean; status: "joined" | "pending" }> {
    return this.request(`/v1/groups/${id}/join`, { method: "POST", json: true, body: "{}" });
  }

  leaveGroup(id: string): Promise<void> {
    return this.request(`/v1/groups/${id}/join`, { method: "DELETE" });
  }

  groupMembers(id: string): Promise<GroupMember[]> {
    return this.request(`/v1/groups/${id}/members`);
  }

  /** Assign a member's role (owner/admin only). */
  setGroupMemberRole(id: string, userId: string, role: "admin" | "moderator" | "member"): Promise<{ ok: boolean }> {
    return this.request(`/v1/groups/${id}/members/${encodeURIComponent(userId)}`, {
      method: "PUT",
      json: true,
      body: JSON.stringify({ role }),
    });
  }

  removeGroupMember(id: string, userId: string): Promise<void> {
    return this.request(`/v1/groups/${id}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  }

  /** Pending join requests (owner/admin only). */
  groupRequests(id: string): Promise<GroupJoinRequest[]> {
    return this.request(`/v1/groups/${id}/requests`);
  }

  /** Approve or reject a join request (owner/admin only). */
  resolveGroupRequest(id: string, userId: string, action: "approve" | "reject"): Promise<{ ok: boolean }> {
    return this.request(`/v1/groups/${id}/requests/${encodeURIComponent(userId)}`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ action }),
    });
  }

  /** Add someone to a group directly (owner/admin only). */
  inviteToGroup(id: string, userId: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/groups/${id}/invite`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ userId }),
    });
  }

  /* Post controls (FR-10). */
  savePost(id: string, saved = true): Promise<void> {
    return this.request(`/v1/posts/${id}/save`, { method: saved ? "PUT" : "DELETE" });
  }

  hidePost(id: string, hidden = true): Promise<void> {
    return this.request(`/v1/posts/${id}/hide`, { method: hidden ? "PUT" : "DELETE" });
  }

  /** Mute/snooze an author (days), or unfollow with `null`. */
  muteAuthor(id: string, days: number | null = 30): Promise<{ ok: boolean }> {
    return this.request(`/v1/authors/${id}/mute`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ days }),
    });
  }

  unmuteAuthor(id: string): Promise<void> {
    return this.request(`/v1/authors/${id}/mute`, { method: "DELETE" });
  }

  listSaved(): Promise<FeedPost[]> {
    return this.request("/v1/saved");
  }

  /** Albums: your post photo collections. */
  listAlbums(): Promise<Array<{ name: string; count: number }>> {
    return this.request("/v1/albums");
  }

  listAlbumPosts(name: string): Promise<FeedPost[]> {
    return this.request(`/v1/albums/${encodeURIComponent(name)}/posts`);
  }

  /** A vertical feed of video posts (reels). */
  listReels(cursor?: string, limit = 12): Promise<FeedPage> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("limit", String(limit));
    return this.request(`/v1/reels?${params.toString()}`);
  }

  /** Vote for an option in a post's poll. */
  votePoll(id: string, optionId: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/posts/${id}/vote`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ optionId }),
    });
  }

  /** Engagement-ranked posts from you and your friends (last 7 days). */
  listTrending(limit = 3): Promise<FeedPost[]> {
    return this.request(`/v1/feed/trending?limit=${limit}`);
  }

  /* Pages (public, followable entities). */
  listMyPages(): Promise<Page[]> {
    return this.request("/v1/pages");
  }

  /** "Pages to follow": Pages you don't own or follow. */
  suggestPages(limit = 6): Promise<Page[]> {
    return this.request(`/v1/pages/suggestions?limit=${limit}`);
  }

  createPage(input: {
    name: string;
    handle?: string;
    category?: string;
    about?: string;
    workspaceId?: string;
    botId?: string;
    avatarEmoji?: string;
    avatarUrl?: string;
    coverUrl?: string;
    cta?: string;
    ctaUrl?: string;
  }): Promise<Page> {
    return this.request("/v1/pages", { method: "POST", json: true, body: JSON.stringify(input) });
  }

  getPage(handle: string): Promise<Page> {
    return this.request(`/v1/pages/${encodeURIComponent(handle)}`);
  }

  updatePage(
    id: string,
    input: Partial<{
      name: string;
      handle: string;
      category: string;
      about: string;
      avatarEmoji: string;
      avatarUrl: string;
      coverUrl: string;
      cta: string;
      ctaUrl: string;
    }>,
  ): Promise<Page> {
    return this.request(`/v1/pages/${id}`, { method: "PATCH", json: true, body: JSON.stringify(input) });
  }

  deletePage(id: string): Promise<void> {
    return this.request(`/v1/pages/${id}`, { method: "DELETE" });
  }

  /** A Page's timeline, keyset-paged (`docs/pages-implementation-plan.md`). */
  listPagePosts(handle: string, cursor?: string, limit = 20): Promise<FeedPage> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("limit", String(limit));
    return this.request(`/v1/pages/${encodeURIComponent(handle)}/posts?${params.toString()}`);
  }

  /** Image or video attachments across a Page's posts, newest first. */
  listPageMedia(
    handle: string,
    cursor?: string,
    limit = 30,
    kind: "image" | "video" = "image",
  ): Promise<{ items: Array<{ id: string; url: string }>; nextCursor: string | null }> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("limit", String(limit));
    if (kind !== "image") params.set("kind", kind);
    return this.request(`/v1/pages/${encodeURIComponent(handle)}/media?${params.toString()}`);
  }

  followPage(id: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/pages/${id}/follow`, { method: "POST", json: true, body: "{}" });
  }

  unfollowPage(id: string): Promise<void> {
    return this.request(`/v1/pages/${id}/follow`, { method: "DELETE" });
  }

  /** Pin or unpin (postId = null) a post on a Page timeline. */
  pinPagePost(id: string, postId: string | null): Promise<{ ok: boolean }> {
    return this.request(`/v1/pages/${id}/pin`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ postId }),
    });
  }

  pageInsights(id: string): Promise<{
    followers: number;
    posts: number;
    reactions: number;
    comments: number;
    shares: number;
    topPosts: Array<{ id: string; body: string; createdAt: string; engagement: number }>;
  }> {
    return this.request(`/v1/pages/${id}/insights`);
  }

  listPageRoles(id: string): Promise<Array<{ userId: string; role: string; person: Person | null }>> {
    return this.request(`/v1/pages/${id}/roles`);
  }

  /** Set a role, or pass an empty/undefined role to remove the member. */
  setPageRole(id: string, userId: string, role?: string): Promise<void> {
    return this.request(`/v1/pages/${id}/roles`, {
      method: "PUT",
      json: true,
      body: JSON.stringify({ userId, role }),
    });
  }

  /** Bot roles on a Page (a bot has no user row; docs/feed-next.md FR-15). */
  listPageBotRoles(
    id: string,
  ): Promise<Array<{ botId: string; role: string; bot: { id: string; name: string; emoji: string; scheme: number } | null }>> {
    return this.request(`/v1/pages/${id}/roles?kind=bot`);
  }

  /** Set a bot's role on a Page, or pass an empty/undefined role to remove it. */
  setPageBotRole(id: string, botId: string, role?: string): Promise<void> {
    return this.request(`/v1/pages/${id}/roles`, {
      method: "PUT",
      json: true,
      body: JSON.stringify({ botId, role }),
    });
  }

  /* Moderation */
  reportPost(id: string, reason?: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/posts/${id}/report`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ reason }),
    });
  }

  listBlocks(): Promise<Person[]> {
    return this.request("/v1/blocks");
  }

  blockUser(id: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/users/${id}/block`, { method: "POST", json: true, body: "{}" });
  }

  unblockUser(id: string): Promise<void> {
    return this.request(`/v1/users/${id}/block`, { method: "DELETE" });
  }

  cancelTask(taskId: string): Promise<void> {
    return this.request(`/v1/tasks/${taskId}/cancel`, { method: "POST", json: true, body: "{}" });
  }

  listSecrets(): Promise<SecretSummary[]> {
    return this.request("/v1/secrets");
  }

  createSecret(name: string, value: string): Promise<SecretSummary> {
    return this.request("/v1/secrets", { method: "POST", json: true, body: JSON.stringify({ name, value }) });
  }

  deleteSecret(id: string): Promise<void> {
    return this.request(`/v1/secrets/${id}`, { method: "DELETE" });
  }

  listConnections(): Promise<ConnectionInfo[]> {
    return this.request("/v1/connections");
  }

  listFiles(botId: string): Promise<BotFile[]> {
    return this.request(`/v1/bots/${botId}/files`);
  }

  saveFile(botId: string, name: string, content: string): Promise<BotFile> {
    return this.request(`/v1/bots/${botId}/files`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ name, content }),
    });
  }

  getFile(id: string): Promise<{ id: string; name: string; content: string }> {
    return this.request(`/v1/files/${id}`);
  }

  deleteFile(id: string): Promise<void> {
    return this.request(`/v1/files/${id}`, { method: "DELETE" });
  }

  /** The shared company wiki (workspace-scoped files). */
  listWorkspaceFiles(
    workspaceId: string,
  ): Promise<Array<{ id: string; name: string; content: string; department?: string }>> {
    return this.request(`/v1/workspaces/${workspaceId}/wiki`);
  }

  saveWorkspaceFile(workspaceId: string, name: string, content: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/workspaces/${workspaceId}/wiki`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ name, content }),
    });
  }

  /** Company secrets (shared with every employee in the workspace). */
  listWorkspaceSecrets(workspaceId: string): Promise<SecretSummary[]> {
    return this.request(`/v1/workspaces/${workspaceId}/secrets`);
  }

  saveWorkspaceSecret(workspaceId: string, name: string, value: string): Promise<SecretSummary> {
    return this.request(`/v1/workspaces/${workspaceId}/secrets`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ name, value }),
    });
  }

  /** Attach an existing (owned) bot to the company with a role. */
  addWorkspaceMember(
    workspaceId: string,
    input: { botId: string; title?: string; department?: Department },
  ): Promise<WorkspaceWithRoles> {
    return this.request(`/v1/workspaces/${workspaceId}/members`, {
      method: "POST",
      json: true,
      body: JSON.stringify(input),
    });
  }

  startConnection(provider: string): Promise<{ url: string }> {
    return this.request(`/v1/connections/${provider}/start`, { method: "POST", json: true, body: "{}" });
  }

  connectToken(provider: string, token: string): Promise<{ provider: string; connectedAt: string }> {
    return this.request(`/v1/connections/${provider}/token`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ token }),
    });
  }

  disconnect(provider: string): Promise<void> {
    return this.request(`/v1/connections/${provider}`, { method: "DELETE" });
  }

  listAudit(taskId: string): Promise<AuditEvent[]> {
    return this.request(`/v1/tasks/${taskId}/audit`);
  }

  /** Tokens spent on one task, for provenance (docs/product-plan.md §3). */
  usageForTask(taskId: string): Promise<{ tokens: number; requests: number }> {
    return this.request(`/v1/tasks/${taskId}/usage`);
  }

  listDownloads(taskId: string): Promise<Array<{ name: string; size: number }>> {
    return this.request(`/v1/tasks/${taskId}/downloads`);
  }

  nodeToken(): Promise<{ token: string; expiresAt: string }> {
    return this.request("/v1/node-token", { method: "POST" });
  }

  /** Whether the cloud has Google sign-in configured. */
  async authConfig(): Promise<{ google: boolean }> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/auth/config`);
    return (await response.json()) as { google: boolean };
  }

  /** Poll for the session produced by the browser sign-in flow. */
  async googleResult(
    state: string,
  ): Promise<Pick<AuthResponse, "token" | "refreshToken" | "expiresAt"> | null> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/auth/google/result?state=${encodeURIComponent(state)}`,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as Pick<AuthResponse, "token" | "refreshToken" | "expiresAt">;
    if (!body.token) return null;
    this.adopt(body);
    return body;
  }

  connect(handlers: ConnectHandlers, opts?: { device?: string; deviceName?: string }): () => void {
    let closed = false;
    let socket: WebSocket | null = null;

    const open = () => {
      if (closed) return;
      const deviceQuery = opts?.device
        ? `&device=${encodeURIComponent(opts.device)}&deviceName=${encodeURIComponent(opts.deviceName ?? "")}`
        : "";
      const wsUrl = `${this.url("/v1/stream").replace(/^http/, "ws")}?token=${encodeURIComponent(
        this.token ?? "",
      )}${deviceQuery}`;
      socket = new WebSocket(wsUrl);
      socket.onopen = () => handlers.onOpen?.();
      socket.onerror = () => {};
      socket.onmessage = (message) => {
        try {
          handlers.onEvent(JSON.parse(message.data as string) as ServerEvent);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        handlers.onClose?.();
        // Reconnect unless the caller disconnected on purpose.
        if (!closed) setTimeout(open, 2000);
      };
    };

    open();
    return () => {
      closed = true;
      socket?.close();
    };
  }
}

export * from "./crypto.js";
export * from "./device-keys.js";
