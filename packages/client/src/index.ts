import type {
  AuditEvent,
  AuthResponse,
  Bot,
  BotFile,
  CapabilityGrant,
  CompanyDNA,
  CompanyReport,
  ConnectionInfo,
  CreateWorkspaceRequest,
  Department,
  LearnedSkill,
  MediaRecipe,
  ModelPricingRecord,
  PlatformSettings,
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
  online: boolean;
  friend?: boolean;
  requested?: boolean;
  incoming?: boolean;
}

/** A human conversation (DM or friend group). */
export interface Conversation {
  id: string;
  kind: "dm" | "group";
  title: string;
  participants: string[];
  last?: { id: string; role: string; content: string; createdAt: string; senderId?: string };
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

/** Thrown when the token is missing, invalid, or expired. */
export class AuthError extends Error {}

interface RequestOptions {
  method?: string;
  body?: string;
  json?: boolean;
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

    const response = await fetch(this.url(path), {
      method: options.method ?? "GET",
      headers,
      body: options.body,
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
  planCompany(source: {
    kind: "url" | "idea";
    value: string;
    name?: string;
  }): Promise<CreateWorkspaceRequest & { template?: string; rationale?: string[] }> {
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

  /* Company board (work items). */
  listWorkItems(workspaceId: string): Promise<WorkItem[]> {
    return this.request(`/v1/workspaces/${workspaceId}/work`);
  }

  createWorkItem(
    workspaceId: string,
    input: {
      title: string;
      detail?: string;
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

  /** Tasks across the company's employees that are waiting for CEO approval. */
  listWorkspaceNeeds(workspaceId: string): Promise<Task[]> {
    return this.request(`/v1/workspaces/${workspaceId}/needs`);
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
    input: { subject: string; capability: string; granted: boolean },
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

  runStandup(workspaceId: string): Promise<CompanyReport> {
    return this.request(`/v1/workspaces/${workspaceId}/standup`, { method: "POST", json: true });
  }

  /** Stop every running task across the company's employees. */
  stopCompany(workspaceId: string): Promise<{ stopped: number }> {
    return this.request(`/v1/workspaces/${workspaceId}/stop`, { method: "POST", json: true });
  }

  /** Activate the company (schedules + auto-approve per level). */
  activateCompany(
    workspaceId: string,
    level: "manual" | "supervised" | "autonomous",
  ): Promise<WorkspaceWithRoles> {
    return this.request(`/v1/workspaces/${workspaceId}/activate`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ level }),
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
      operatingHours?: { start: number; end: number; days?: number[] };
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
  listConversations(): Promise<Conversation[]> {
    return this.request("/v1/conversations");
  }

  openDm(userId: string): Promise<Session> {
    return this.request(`/v1/dm/${userId}`, { method: "POST", json: true, body: "{}" });
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
  }): Promise<User> {
    return this.request("/v1/profile", { method: "PATCH", json: true, body: JSON.stringify(input) });
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
