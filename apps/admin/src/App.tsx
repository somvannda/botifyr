import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthError, BotifyrClient } from "@botifyr/client";
import type { AdminAuditEvent, AdminSkill, AdminUser } from "@botifyr/client";
import { BotLogo, LogoutIcon } from "@botifyr/ui";

/**
 * Platform admin console. Signs in with the same Google account, then requires
 * the admin role. Moderation (learned skills) and user management live here —
 * separate from the user portal so admin code never ships to normal users.
 */

const CLOUD_URL = (import.meta.env.VITE_CLOUD_URL as string | undefined) ?? "http://localhost:8787";
const TOKEN_KEY = "botifyr.admin.token";
const REFRESH_KEY = "botifyr.admin.refresh";

function messageOf(error: unknown): string {
  if (error instanceof AuthError) return "Not authorized — sign in with an admin account.";
  return error instanceof Error ? error.message : String(error);
}

export function Admin() {
  const client = useMemo(() => new BotifyrClient(CLOUD_URL), []);

  const [ready, setReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"users" | "skills" | "audit">("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [skills, setSkills] = useState<AdminSkill[]>([]);
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [openSkill, setOpenSkill] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [userList, skillList, auditList] = await Promise.all([
      client.adminUsers(),
      client.adminSkills(),
      client.adminAudit(),
    ]);
    setUsers(userList);
    setSkills(skillList);
    setAudit(auditList);
  }, [client]);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setReady(true);
      return;
    }
    client.setToken(stored);
    client.setRefreshToken(localStorage.getItem(REFRESH_KEY));
    client
      .me()
      .then(async (me) => {
        if (me.role !== "admin") throw new Error("This account is not a platform admin.");
        setAuthorized(true);
        await load();
      })
      .catch((err: unknown) => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        client.setToken(null);
        setError(messageOf(err));
      })
      .finally(() => setReady(true));
  }, [client, load]);

  function signInWithGoogle() {
    setBusy(true);
    setError(null);
    // The "admin:" prefix tells the cloud to only issue a session to an
    // allowlisted platform admin.
    const state = `admin:${crypto.randomUUID()}`;
    window.open(
      `${CLOUD_URL}/auth/google?state=${encodeURIComponent(state)}`,
      "botifyr-admin-signin",
      "width=520,height=660",
    );
    const started = Date.now();
    const timer = window.setInterval(() => {
      void client
        .googleResult(state)
        .then(async (session) => {
          if (!session) {
            if (Date.now() - started > 120_000) window.clearInterval(timer);
            return;
          }
          window.clearInterval(timer);
          localStorage.setItem(TOKEN_KEY, session.token);
          if (session.refreshToken) localStorage.setItem(REFRESH_KEY, session.refreshToken);
          client.setToken(session.token);
          client.setRefreshToken(session.refreshToken ?? null);
          const me = await client.me();
          if (me.role !== "admin") {
            localStorage.removeItem(TOKEN_KEY);
            client.setToken(null);
            setError("This account is not a platform admin.");
            setBusy(false);
            return;
          }
          setAuthorized(true);
          await load();
          setBusy(false);
        })
        .catch((err: unknown) => {
          window.clearInterval(timer);
          setError(messageOf(err));
          setBusy(false);
        });
    }, 1500);
  }

  async function signOut() {
    try {
      await client.logout();
    } catch {
      // ignore
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    client.setToken(null);
    client.setRefreshToken(null);
    setAuthorized(false);
    setUsers([]);
    setSkills([]);
  }

  async function setRole(user: AdminUser, role: "user" | "admin") {
    setError(null);
    try {
      await client.adminSetRole(user.id, role);
      await load();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function setPlan(user: AdminUser, plan: "trial" | "pro") {
    setError(null);
    try {
      await client.adminSetPlan(user.id, plan);
      await load();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function setSkillStatus(skill: AdminSkill, status: "approved" | "rejected" | "pending") {
    setError(null);
    try {
      await client.adminSetSkillStatus(skill.id, status);
      await load();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function deleteSkill(skill: AdminSkill) {
    setError(null);
    try {
      await client.adminDeleteSkill(skill.id);
      await load();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  if (!ready) {
    return (
      <div className="admin-signin">
        <div className="admin-signin-card">
          <div className="admin-brand">
            <BotLogo size={34} /> Botifyr Admin
          </div>
          <p className="admin-muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="admin-signin">
        <div className="admin-signin-card">
          <div className="admin-brand">
            <BotLogo size={34} /> Botifyr Admin
          </div>
          <p className="admin-muted">
            Sign in with a platform-admin Google account to moderate learned skills and manage users.
          </p>
          <button className="btn primary" type="button" disabled={busy} onClick={() => signInWithGoogle()}>
            {busy ? "Waiting for Google…" : "Continue with Google"}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  const pending = skills.filter((skill) => skill.status === "pending").length;

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div className="admin-brand">
          <BotLogo size={26} /> Botifyr Admin
        </div>
        <span className="admin-muted" style={{ marginLeft: 6 }}>
          {users.length} users · {skills.length} skills · {pending} pending
        </span>
        <span style={{ flex: 1 }} />
        <button className="ghost small" type="button" onClick={() => void signOut()}>
          <LogoutIcon size={15} /> Sign out
        </button>
      </header>

      <div className="admin-body">
        <div className="admin-tabs">
          <button
            className={`admin-tab ${tab === "users" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("users")}
          >
            Users
          </button>
          <button
            className={`admin-tab ${tab === "skills" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("skills")}
          >
            Learned skills{pending > 0 ? ` (${pending})` : ""}
          </button>
          <button
            className={`admin-tab ${tab === "audit" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("audit")}
          >
            Audit log
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {tab === "users" && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Plan</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>
                    <span className={`admin-pill ${user.role === "admin" ? "admin" : ""}`}>{user.role}</span>
                  </td>
                  <td>
                    <span className={`admin-pill ${user.plan === "pro" ? "pro" : ""}`}>{user.plan}</span>
                  </td>
                  <td className="admin-muted">{user.createdAt.slice(0, 10)}</td>
                  <td>
                    <div className="admin-actions">
                      <button
                        className="ghost small"
                        type="button"
                        onClick={() => void setRole(user, user.role === "admin" ? "user" : "admin")}
                      >
                        {user.role === "admin" ? "Make user" : "Make admin"}
                      </button>
                      <button
                        className="ghost small"
                        type="button"
                        onClick={() => void setPlan(user, user.plan === "pro" ? "trial" : "pro")}
                      >
                        {user.plan === "pro" ? "Downgrade" : "Make Pro"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "skills" && (
          <div>
            {skills.length === 0 && <p className="admin-muted">Nothing learned yet.</p>}
            {skills.map((skill) => (
              <div key={skill.id} className="admin-card">
                <div className="admin-actions" style={{ alignItems: "center" }}>
                  <strong style={{ fontSize: 14 }}>{skill.name}</strong>
                  <span className={`admin-pill ${skill.status}`}>{skill.status}</span>
                  <span style={{ flex: 1 }} />
                  {skill.status !== "approved" && (
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => void setSkillStatus(skill, "approved")}
                    >
                      Approve
                    </button>
                  )}
                  {skill.status !== "rejected" && (
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => void setSkillStatus(skill, "rejected")}
                    >
                      Reject
                    </button>
                  )}
                  <button
                    className="ghost small"
                    type="button"
                    onClick={() => setOpenSkill(openSkill === skill.id ? null : skill.id)}
                  >
                    {openSkill === skill.id ? "Hide" : "View"}
                  </button>
                  <button
                    className="ghost small danger"
                    type="button"
                    onClick={() => void deleteSkill(skill)}
                  >
                    Delete
                  </button>
                </div>
                <p className="admin-muted" style={{ marginTop: 6 }}>
                  {skill.description}
                </p>
                {openSkill === skill.id && <div className="admin-skill-content">{skill.content}</div>}
              </div>
            ))}
          </div>
        )}

        {tab === "audit" && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 && (
                <tr>
                  <td colSpan={3} className="admin-muted">
                    No admin activity recorded yet.
                  </td>
                </tr>
              )}
              {audit.map((event) => (
                <tr key={event.id}>
                  <td className="admin-muted">{event.createdAt.replace("T", " ").slice(0, 19)}</td>
                  <td>
                    <span className="admin-pill">{event.toolName ?? event.type}</span>
                  </td>
                  <td className="admin-muted">{event.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
