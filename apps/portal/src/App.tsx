import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  Approval,
  Bot,
  ConnectionInfo,
  LearnedSkill,
  RuntimeConfig,
  ServerEvent,
  Session,
  Task,
  User,
} from "@botifyr/shared";
import { AuthError, BotifyrClient, type ApiKeySummary } from "@botifyr/client";
import {
  BOT_SCHEMES,
  BotLogo,
  ChartIcon,
  CloseIcon,
  GearIcon,
  LogoutIcon,
  Markdown,
  PlusIcon,
  SendIcon,
  UsersIcon,
} from "@botifyr/ui";

/**
 * Web portal: the same account, bots and chats as the desktop app, in the
 * browser. It talks to the identical cloud API and websocket, so anything you
 * start here shows up on the desktop (and vice versa).
 */

const CLOUD_URL = (import.meta.env.VITE_CLOUD_URL as string | undefined) ?? "http://localhost:8787";
const TOKEN_KEY = "botifyr.portal.token";

function initials(email: string): string {
  const name = email.split("@")[0] ?? "?";
  return name.slice(0, 2).toUpperCase();
}

function messageOf(error: unknown): string {
  if (error instanceof AuthError) return "Your session expired. Please sign in again.";
  return error instanceof Error ? error.message : String(error);
}

function authorEmoji(bot: Bot | undefined): string {
  if (!bot) return "🤖";
  const value = (bot.emoji ?? "").trim();
  return !value || value.includes("?") ? "🤖" : value;
}

function isGroup(bot: Bot): boolean {
  return Boolean(bot.memberIds && bot.memberIds.length > 0);
}

export function Portal() {
  const client = useMemo(() => new BotifyrClient(CLOUD_URL), []);

  const [authChecked, setAuthChecked] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [bots, setBots] = useState<Bot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [streams, setStreams] = useState<Record<string, string>>({});
  const [groupWorking, setGroupWorking] = useState<Record<string, string[]>>({});

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [useComputer, setUseComputer] = useState(
    () => localStorage.getItem("botifyr.portal.useComputer") === "1",
  );
  const [showAccount, setShowAccount] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [plan, setPlan] = useState<"trial" | "pro">("trial");
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [learnedSkills, setLearnedSkills] = useState<LearnedSkill[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeBot = bots.find((bot) => bot.id === activeBotId) ?? null;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeStream = activeSessionId ? streams[activeSessionId] : undefined;
  const workingNames = activeSessionId ? groupWorking[activeSessionId] : undefined;
  const liveTask = activeSessionId
    ? Object.values(tasks)
        .filter((task) => task.sessionId === activeSessionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;

  const standalone = bots.filter((bot) => !isGroup(bot));
  const groups = bots.filter(isGroup);

  const bootstrap = useCallback(async () => {
    const [me, botList, sessionList, cfg, keys, conns, learned] = await Promise.all([
      client.me(),
      client.listBots(),
      client.listSessions(),
      client.config(),
      client.listApiKeys(),
      client.listConnections(),
      client.listLearnedSkills(),
    ]);
    setUser(me);
    setBots(botList);
    setSessions(sessionList);
    setConfig(cfg);
    setApiKeys(keys);
    setConnections(conns);
    setLearnedSkills(learned);
    void client
      .billing()
      .then((b) => setPlan(b.plan))
      .catch(() => {});
    const saved = localStorage.getItem("botifyr.portal.activeBotId");
    const chosen = botList.find((bot) => bot.id === saved) ?? botList[0];
    if (chosen) {
      setActiveBotId(chosen.id);
      setActiveSessionId(chosen.sessionId);
    }
  }, [client]);

  // Restore a stored token on load.
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setAuthChecked(true);
      return;
    }
    client.setToken(stored);
    client
      .me()
      .then(() => bootstrap())
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        client.setToken(null);
      })
      .finally(() => setAuthChecked(true));
  }, [client, bootstrap]);

  // Realtime stream: identical events to the desktop client.
  useEffect(() => {
    if (!user) return;
    const off = client.connect({
      onEvent: (event: ServerEvent) => {
        switch (event.type) {
          case "session.updated":
          case "session.created":
            setSessions((prev) => {
              const exists = prev.some((session) => session.id === event.session.id);
              return exists
                ? prev.map((session) => (session.id === event.session.id ? event.session : session))
                : [event.session, ...prev];
            });
            setStreams((prev) => ({ ...prev, [event.session.id]: "" }));
            break;
          case "assistant.delta":
            setStreams((prev) => ({
              ...prev,
              [event.sessionId]: (prev[event.sessionId] ?? "") + event.text,
            }));
            break;
          case "group.working":
            setGroupWorking((prev) => ({ ...prev, [event.sessionId]: event.names }));
            break;
          case "task.created":
          case "task.updated":
          case "task.completed":
          case "task.failed":
            setTasks((prev) => ({ ...prev, [event.task.id]: event.task }));
            break;
          case "approval.requested":
          case "approval.resolved":
            setTasks((prev) => {
              const task = prev[event.taskId];
              return task ? { ...prev, [event.taskId]: { ...task, approval: event.approval } } : prev;
            });
            break;
        }
      },
    });
    return off;
  }, [user, client]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeSession?.messages.length, activeStream]);

  async function signInWithGoogle() {
    setAuthBusy(true);
    setError(null);
    try {
      const state = crypto.randomUUID();
      window.open(
        `${CLOUD_URL}/auth/google?state=${encodeURIComponent(state)}`,
        "botifyr-signin",
        "width=520,height=660",
      );
      const started = Date.now();
      const timer = window.setInterval(() => {
        void client
          .googleResult(state)
          .then((token) => {
            if (!token) {
              if (Date.now() - started > 120_000) window.clearInterval(timer);
              return;
            }
            window.clearInterval(timer);
            localStorage.setItem(TOKEN_KEY, token);
            client.setToken(token);
            void bootstrap().finally(() => setAuthBusy(false));
          })
          .catch(() => {});
      }, 1500);
    } catch (err: unknown) {
      setError(messageOf(err));
      setAuthBusy(false);
    }
  }

  async function signOut() {
    try {
      await client.logout();
    } catch {
      // ignore
    }
    localStorage.removeItem(TOKEN_KEY);
    client.setToken(null);
    setUser(null);
    setBots([]);
    setSessions([]);
  }

  function selectBot(bot: Bot) {
    setActiveBotId(bot.id);
    setActiveSessionId(bot.sessionId);
    localStorage.setItem("botifyr.portal.activeBotId", bot.id);
    setSidebarOpen(false);
  }

  async function send(raw?: string) {
    const trimmed = (raw ?? text).trim();
    if (!trimmed || !activeSessionId || busy) return;
    const sessionId = activeSessionId;
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: [
                ...session.messages,
                {
                  id: `local-${Date.now()}`,
                  role: "user" as const,
                  content: trimmed,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : session,
      ),
    );
    setText("");
    setBusy(true);
    setError(null);
    try {
      const { session } = await client.sendMessage(sessionId, trimmed, useComputer);
      setSessions((prev) => prev.map((entry) => (entry.id === sessionId ? session : entry)));
    } catch (err: unknown) {
      setError(messageOf(err));
      await bootstrap().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function decide(taskId: string, approval: Approval, decision: "allow" | "deny") {
    try {
      await client.resolveApproval(taskId, approval.id, decision);
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function createKey() {
    setError(null);
    try {
      const created = await client.createApiKey("Web portal key");
      setCreatedKey(created.key);
      setApiKeys(await client.listApiKeys());
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function revokeKey(id: string) {
    try {
      await client.revokeApiKey(id);
      setApiKeys(await client.listApiKeys());
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function upgrade() {
    setError(null);
    try {
      const { url } = await client.billingCheckout(window.location.origin);
      window.open(url, "_blank");
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  if (!authChecked) {
    return (
      <div className="portal-signin">
        <div className="portal-signin-card">
          <div className="portal-brand">
            <BotLogo size={40} /> Botifyr
          </div>
          <p className="portal-note">Loading your workspace…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="portal-signin">
        <div className="portal-signin-card">
          <div className="portal-brand">
            <BotLogo size={40} /> Botifyr
          </div>
          <p className="portal-note">
            Sign in with the same Google account you use in the desktop app — you'll see the same bots and
            chats here, on any device.
          </p>
          <button
            className="btn primary"
            type="button"
            disabled={authBusy}
            onClick={() => void signInWithGoogle()}
          >
            {authBusy ? "Waiting for Google…" : "Continue with Google"}
          </button>
          {error && <p className="error">{error}</p>}
          <p className="portal-note" style={{ fontSize: 11.5 }}>
            Tip: keep the desktop app open to let your bots use that computer from here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? "portal-open" : ""}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <span className="sidebar-avatar">
              <BotLogo size={30} />
            </span>
            <span className="sidebar-brand-name">Botifyr</span>
          </div>
        </div>

        <div className="sidebar-actions">
          <button className="new-task" type="button" onClick={() => setShowAccount(true)}>
            <GearIcon size={16} /> Account
          </button>
        </div>

        <div className="newchat-panel" style={{ position: "static", display: "block" }}>
          {standalone.length > 0 && <div className="newchat-section">Bots</div>}
          {standalone.map((bot) => (
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
                <span className="newchat-emoji">{authorEmoji(bot)}</span>
                {bot.name}
              </span>
            </button>
          ))}
          {groups.length > 0 && <div className="newchat-section">Groups</div>}
          {groups.map((bot) => (
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
                <span className="newchat-emoji">{authorEmoji(bot)}</span>
                {bot.name}
              </span>
              <span className="newchat-meta">{bot.memberIds?.length ?? 0} bots</span>
            </button>
          ))}
        </div>

        <footer className="sidebar-footer">
          <span className="portal-chip">{user.email}</span>
          <button className="icon-btn" type="button" title="Sign out" onClick={() => void signOut()}>
            <LogoutIcon size={16} />
          </button>
        </footer>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="bot-menu-btn portal-mobile-only"
            type="button"
            title="Menu"
            onClick={() => setSidebarOpen((value) => !value)}
          >
            <UsersIcon size={16} />
          </button>
          <span className="thread-pill">
            <BotLogo size={18} scheme={BOT_SCHEMES[(activeBot?.scheme ?? 0) % BOT_SCHEMES.length]} />
            <span className="thread-pill-name">{activeBot?.name ?? "Botifyr"}</span>
          </span>
          <div className="portal-spacer" />
          {config?.nodeOnline && (
            <button
              className={`portal-chip ${useComputer ? "active" : ""}`}
              type="button"
              title="Run this task on your own computer (desktop app)"
              onClick={() => {
                const next = !useComputer;
                setUseComputer(next);
                localStorage.setItem("botifyr.portal.useComputer", next ? "1" : "0");
              }}
            >
              {useComputer ? "● On your computer" : "Use your computer"}
            </button>
          )}
          {config && (
            <span className="portal-chip">
              {config.capabilities.join(", ") || "none"}
              {config.nodeOnline ? " · desktop online" : " · desktop offline"}
            </span>
          )}
        </header>

        {error && <div className="error">{error}</div>}

        <section className="content" ref={scrollRef}>
          {!activeSession && (
            <div className="hero">
              <h1>Start a conversation</h1>
              <p>Pick a bot on the left, or create one in the desktop app.</p>
            </div>
          )}

          {activeSession && (
            <div className="thread">
              {activeSession.messages.length === 0 && !activeStream && (
                <div className="hero">
                  <h1>What should {activeBot?.name ?? "Botifyr"} do?</h1>
                  <p>Ask for something real — it works in an isolated sandbox and asks before risky steps.</p>
                </div>
              )}

              {activeSession.messages.map((message) => {
                if (message.role === "user") {
                  return (
                    <div key={message.id} className="msg-user">
                      <div className="msg-user-bubble">{message.content}</div>
                      <span className="msg-user-avatar">{initials(user.email)}</span>
                    </div>
                  );
                }
                const msgBot =
                  (message.botId && bots.find((bot) => bot.id === message.botId)) || activeBot || undefined;
                return (
                  <div key={message.id} className="msg-assistant">
                    <BotLogo
                      size={26}
                      scheme={BOT_SCHEMES[(msgBot?.scheme ?? 0) % BOT_SCHEMES.length]}
                      className="msg-bot-logo"
                    />
                    <div className="msg-body">
                      {msgBot && (
                        <div className="msg-author">
                          <span className="msg-author-emoji">{authorEmoji(msgBot)}</span>
                          {msgBot.name}
                        </div>
                      )}
                      <Markdown text={message.content} />
                    </div>
                  </div>
                );
              })}

              {activeStream && (
                <div className="msg-assistant">
                  <BotLogo
                    size={26}
                    scheme={BOT_SCHEMES[(activeBot?.scheme ?? 0) % BOT_SCHEMES.length]}
                    className="msg-bot-logo"
                  />
                  <div className="msg-body">
                    <div className="msg-author">
                      <span className="msg-author-emoji">{authorEmoji(activeBot ?? undefined)}</span>
                      {activeBot?.name ?? "Botifyr"}
                    </div>
                    <Markdown text={activeStream} />
                  </div>
                </div>
              )}

              {workingNames && workingNames.length > 0 && (
                <div className="msg-assistant">
                  <div className="msg-body">
                    <div className="msg-author">{workingNames.join(", ")} are replying…</div>
                  </div>
                </div>
              )}

              {liveTask?.approval && liveTask.approval.status === "pending" && (
                <div className="approval">
                  <span className="approval-tag">Approval needed · {liveTask.approval.risk} risk</span>
                  <h3>{liveTask.approval.title}</h3>
                  <p>{liveTask.approval.description}</p>
                  <div className="approval-actions">
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => void decide(liveTask.id, liveTask.approval as Approval, "allow")}
                    >
                      Allow
                    </button>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => void decide(liveTask.id, liveTask.approval as Approval, "deny")}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <form
          className="composer"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="composer-bar">
            <button className="round" type="button" title="New chat" onClick={() => setShowAccount(true)}>
              <PlusIcon size={18} />
            </button>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={`Message ${activeBot?.name ?? "Botifyr"}`}
              rows={1}
              disabled={busy || !activeSessionId}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button className="round send" type="submit" title="Send" disabled={busy || !text.trim()}>
              <SendIcon size={18} />
            </button>
          </div>
        </form>
      </main>

      {showAccount && (
        <div className="apps-overlay" onClick={() => setShowAccount(false)}>
          <div className="apps-panel" onClick={(event) => event.stopPropagation()}>
            <div className="apps-head">
              <span className="apps-title">Account</span>
              <button className="round small" type="button" onClick={() => setShowAccount(false)}>
                <CloseIcon size={13} />
              </button>
            </div>
            <p className="apps-sub">{user.email}</p>

            <div className="portal-section">
              <div className="settings-section-title">Plan</div>
              <div className="portal-row-between">
                <span>
                  <strong>{plan === "pro" ? "Pro" : "Trial"}</strong>
                </span>
                {plan === "pro" ? (
                  <span className="portal-chip">Active</span>
                ) : (
                  <button className="btn primary" type="button" onClick={() => void upgrade()}>
                    Upgrade to Pro
                  </button>
                )}
              </div>
            </div>

            <div className="portal-section">
              <div className="settings-section-title">
                <ChartIcon size={14} /> API keys
              </div>
              <p className="portal-note">
                Use these with the public API: send them as <code>x-api-key</code> or a <code>bk_…</code>{" "}
                bearer token.
              </p>
              {createdKey && (
                <div className="portal-key-reveal">
                  {createdKey}
                  <div className="portal-note" style={{ marginTop: 6 }}>
                    Copy it now — it won't be shown again.
                  </div>
                </div>
              )}
              {apiKeys.map((key) => (
                <div key={key.id} className="portal-key-row">
                  <span>
                    <span className="portal-key-name">{key.name}</span>
                    <span className="portal-key-meta">
                      {" "}
                      · {key.prefix}…
                      {key.lastUsedAt ? ` · last used ${key.lastUsedAt.slice(0, 10)}` : " · never used"}
                    </span>
                  </span>
                  <span className="portal-spacer" />
                  <button className="ghost small" type="button" onClick={() => void revokeKey(key.id)}>
                    Revoke
                  </button>
                </div>
              ))}
              <button className="ghost small" type="button" onClick={() => void createKey()}>
                <PlusIcon size={14} /> Create API key
              </button>
            </div>

            <div className="portal-section">
              <div className="settings-section-title">Connections</div>
              {connections.length === 0 && <p className="portal-note">No apps connected yet.</p>}
              {connections.map((connection) => (
                <div key={connection.provider} className="portal-key-row">
                  <span className="portal-key-name">{connection.provider}</span>
                  <span className="portal-spacer" />
                  <span className="portal-chip">
                    {connection.connectedAt ? connection.connectedAt.slice(0, 10) : "connected"}
                  </span>
                </div>
              ))}
            </div>

            <div className="portal-section">
              <div className="settings-section-title">Learned skills ({learnedSkills.length})</div>
              {learnedSkills.length === 0 && <p className="portal-note">Nothing learned yet.</p>}
              {learnedSkills.slice(0, 8).map((skill) => (
                <div key={skill.id} className="portal-key-row">
                  <span className="portal-key-name">{skill.name}</span>
                  <span className="portal-spacer" />
                  <span className="portal-chip">{skill.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
