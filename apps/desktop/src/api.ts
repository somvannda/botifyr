import type {
  AuditEvent,
  AuthResponse,
  Bot,
  ConnectionInfo,
  RuntimeConfig,
  SecretSummary,
  ServerEvent,
  Session,
  Task,
  User,
} from "@botifyr/shared";

export interface ConnectHandlers {
  onEvent: (event: ServerEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

/** Thrown when the token is missing, invalid, or expired. */
export class AuthError extends Error {}

interface RequestOptions {
  method?: string;
  body?: string;
  json?: boolean;
}

/**
 * Client for the Botifyr cloud API. Holds an optional bearer token, which is
 * attached to REST calls and to the websocket handshake.
 */
export class BotifyrClient {
  private token: string | null = null;

  constructor(private readonly baseUrl: string) {}

  setToken(token: string | null): void {
    this.token = token;
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

  createBot(input: {
    name: string;
    emoji: string;
    scheme: number;
    instructions: string;
    memberIds?: string[];
  }): Promise<Bot> {
    return this.request("/v1/bots", { method: "POST", json: true, body: JSON.stringify(input) });
  }

  deleteBot(id: string): Promise<void> {
    return this.request(`/v1/bots/${id}`, { method: "DELETE" });
  }

  updateBot(
    id: string,
    input: { name?: string; emoji?: string; scheme?: number; instructions?: string },
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

  startConnection(provider: string): Promise<{ url: string }> {
    return this.request(`/v1/connections/${provider}/start`, { method: "POST", json: true, body: "{}" });
  }

  disconnect(provider: string): Promise<void> {
    return this.request(`/v1/connections/${provider}`, { method: "DELETE" });
  }

  listAudit(taskId: string): Promise<AuditEvent[]> {
    return this.request(`/v1/tasks/${taskId}/audit`);
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

  connect(handlers: ConnectHandlers): () => void {
    let closed = false;
    let socket: WebSocket | null = null;

    const open = () => {
      if (closed) return;
      const wsUrl = `${this.url("/v1/stream").replace(/^http/, "ws")}?token=${encodeURIComponent(
        this.token ?? "",
      )}`;
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
        if (!closed) window.setTimeout(open, 2000);
      };
    };

    open();
    return () => {
      closed = true;
      socket?.close();
    };
  }
}
