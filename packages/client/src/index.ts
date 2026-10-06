import type {
  AuditEvent,
  AuthResponse,
  Bot,
  BotFile,
  ConnectionInfo,
  LearnedSkill,
  RuntimeConfig,
  SecretSummary,
  ServerEvent,
  Session,
  Skill,
  Task,
  User,
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

/** A platform user as seen by the admin console. */
export interface AdminUser {
  id: string;
  email: string;
  role: "user" | "admin";
  plan: "trial" | "pro";
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

  constructor(private readonly baseUrl: string) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
      if (response.status === 401) throw new AuthError(detail);
      throw new Error(detail);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  config(): Promise<RuntimeConfig> {
    return this.request("/v1/config");
  }

  signup(email: string, password: string): Promise<AuthResponse> {
    return this.request("/auth/signup", {
      method: "POST",
      json: true,
      body: JSON.stringify({ email, password }),
    });
  }

  login(email: string, password: string): Promise<AuthResponse> {
    return this.request("/auth/login", {
      method: "POST",
      json: true,
      body: JSON.stringify({ email, password }),
    });
  }

  me(): Promise<User> {
    return this.request("/auth/me");
  }

  logout(): Promise<void> {
    return this.request("/auth/logout", { method: "POST" });
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

  billing(): Promise<{ plan: "trial" | "pro"; stripeConfigured: boolean }> {
    return this.request("/v1/billing");
  }

  billingCheckout(returnUrl: string): Promise<{ url: string }> {
    return this.request("/v1/billing/checkout", {
      method: "POST",
      json: true,
      body: JSON.stringify({ returnUrl }),
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

  adminSetPlan(id: string, plan: "trial" | "pro"): Promise<{ ok: boolean }> {
    return this.request(`/admin/users/${id}/plan`, {
      method: "POST",
      json: true,
      body: JSON.stringify({ plan }),
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
      memberIds?: string[];
      autonomous?: boolean;
      skills?: string[];
      autoApprove?: boolean;
      schedule?: { prompt: string; everyMinutes: number; enabled: boolean };
    },
  ): Promise<Bot> {
    return this.request(`/v1/bots/${id}`, { method: "PUT", json: true, body: JSON.stringify(input) });
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

  /** Poll for the token produced by the browser sign-in flow. */
  async googleResult(state: string): Promise<string | null> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/auth/google/result?state=${encodeURIComponent(state)}`,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { token?: string };
    return body.token ?? null;
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
