import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthError, BotifyrClient } from "@botifyr/client";
import type { AdminAuditEvent, AdminSkill, AdminUser } from "@botifyr/client";
import type { MediaRecipe, ModelPricingRecord, PlatformSettings } from "@botifyr/shared";
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
  const [tab, setTab] = useState<"users" | "skills" | "audit" | "billing" | "recipes">("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [skills, setSkills] = useState<AdminSkill[]>([]);
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [pricing, setPricing] = useState<ModelPricingRecord[]>([]);
  const [recipes, setRecipes] = useState<MediaRecipe[]>([]);
  const [openSkill, setOpenSkill] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [userList, skillList, auditList, settingsData, pricingList, recipeList] = await Promise.all([
      client.adminUsers(),
      client.adminSkills(),
      client.adminAudit(),
      client.adminSettings(),
      client.adminModelPricing(),
      client.adminMediaRecipes(),
    ]);
    setUsers(userList);
    setSkills(skillList);
    setAudit(auditList);
    setSettings(settingsData);
    setPricing(pricingList);
    setRecipes(recipeList);
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

  async function setPlan(user: AdminUser, plan: "free" | "pro" | "business") {
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

  async function saveSettings(next: PlatformSettings) {
    setError(null);
    try {
      setSettings(await client.adminSaveSettings(next));
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function savePricingRow(record: ModelPricingRecord) {
    setError(null);
    try {
      await client.adminSaveModelPricing(record.model, record);
      await load();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function deletePricingRow(model: string) {
    setError(null);
    try {
      await client.adminDeleteModelPricing(model);
      await load();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function setRecipeStatus(recipe: MediaRecipe, status: "approved" | "rejected" | "pending") {
    setError(null);
    try {
      await client.adminSaveMediaRecipe(recipe.domain, { status });
      await load();
    } catch (err: unknown) {
      setError(messageOf(err));
    }
  }

  async function deleteRecipe(domain: string) {
    setError(null);
    try {
      await client.adminDeleteMediaRecipe(domain);
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
          <button
            className={`admin-tab ${tab === "billing" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("billing")}
          >
            Billing
          </button>
          <button
            className={`admin-tab ${tab === "recipes" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("recipes")}
          >
            Recipes
            {recipes.filter((recipe) => recipe.status === "pending").length > 0
              ? ` (${recipes.filter((recipe) => recipe.status === "pending").length})`
              : ""}
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
                        onClick={() => void setPlan(user, user.plan === "pro" ? "free" : "pro")}
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

        {tab === "billing" && settings && (
          <div>
            <div className="admin-card">
              <strong>Plans &amp; limits</strong>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 10,
                  marginTop: 10,
                }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Pro price (cents)
                  <input
                    type="number"
                    value={settings.plans.proPriceCents}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        plans: { ...settings.plans, proPriceCents: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Business price (cents)
                  <input
                    type="number"
                    value={settings.plans.businessPriceCents}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        plans: { ...settings.plans, businessPriceCents: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Period (days)
                  <input
                    type="number"
                    value={settings.plans.proPeriodDays}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        plans: { ...settings.plans, proPeriodDays: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Pro included tokens
                  <input
                    type="number"
                    value={settings.plans.includedTokens.pro}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        plans: {
                          ...settings.plans,
                          includedTokens: { ...settings.plans.includedTokens, pro: Number(e.target.value) },
                        },
                      })
                    }
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Business included tokens
                  <input
                    type="number"
                    value={settings.plans.includedTokens.business}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        plans: {
                          ...settings.plans,
                          includedTokens: {
                            ...settings.plans.includedTokens,
                            business: Number(e.target.value),
                          },
                        },
                      })
                    }
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Free monthly tokens
                  <input
                    type="number"
                    value={settings.freeMonthlyTokens}
                    onChange={(e) => setSettings({ ...settings, freeMonthlyTokens: Number(e.target.value) })}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Low balance (cents)
                  <input
                    type="number"
                    value={settings.lowBalanceCents}
                    onChange={(e) => setSettings({ ...settings, lowBalanceCents: Number(e.target.value) })}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Grace days
                  <input
                    type="number"
                    value={settings.graceDays}
                    onChange={(e) => setSettings({ ...settings, graceDays: Number(e.target.value) })}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Reminder days (before &amp; during)
                  <input
                    value={settings.reminderDays.join(", ")}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        reminderDays: e.target.value
                          .split(",")
                          .map((part) => Number(part.trim()))
                          .filter((n) => n > 0),
                      })
                    }
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Global markup %
                  <input
                    type="number"
                    value={settings.onDemand.markupPercent}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        onDemand: { ...settings.onDemand, markupPercent: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Min top-up (cents)
                  <input
                    type="number"
                    value={settings.onDemand.minTopUpCents}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        onDemand: { ...settings.onDemand, minTopUpCents: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Fallback plan
                  <select
                    value={settings.fallbackPlan}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        fallbackPlan: e.target.value as PlatformSettings["fallbackPlan"],
                      })
                    }
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                    <option value="business">business</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  On empty
                  <select
                    value={settings.onDemand.onEmpty}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        onDemand: { ...settings.onDemand, onEmpty: e.target.value as "block" | "free" },
                      })
                    }
                  >
                    <option value="block">block</option>
                    <option value="free">fall back to free</option>
                  </select>
                </label>
              </div>
              <div className="admin-actions" style={{ marginTop: 12, gap: 16 }}>
                <label style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={settings.onDemand.enabled}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        onDemand: { ...settings.onDemand, enabled: e.target.checked },
                      })
                    }
                  />{" "}
                  On-demand credits
                </label>
                <label style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={settings.onDemand.allowPro}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        onDemand: { ...settings.onDemand, allowPro: e.target.checked },
                      })
                    }
                  />{" "}
                  Allow pro overage
                </label>
                <label style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={settings.reminderChannels.email}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        reminderChannels: { ...settings.reminderChannels, email: e.target.checked },
                      })
                    }
                  />{" "}
                  Email reminders
                </label>
                <label style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={settings.reminderChannels.telegram}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        reminderChannels: { ...settings.reminderChannels, telegram: e.target.checked },
                      })
                    }
                  />{" "}
                  Telegram reminders
                </label>
              </div>
              <button
                className="btn primary"
                style={{ marginTop: 12 }}
                type="button"
                onClick={() => void saveSettings(settings)}
              >
                Save settings
              </button>
            </div>

            <div className="admin-card" style={{ marginTop: 14 }}>
              <strong>Model pricing</strong>
              <p className="admin-muted" style={{ marginTop: 6 }}>
                User price = provider cost × (1 + markup), rounded up. A run with an unknown model uses the
                most expensive enabled row.
              </p>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Input ¢/1M</th>
                    <th>Output ¢/1M</th>
                    <th>Markup %</th>
                    <th>On</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pricing.map((row, index) => (
                    <tr key={row.model}>
                      <td>{row.model}</td>
                      <td>
                        <input
                          type="number"
                          value={row.inputCentsPerM}
                          onChange={(e) =>
                            setPricing(
                              pricing.map((r, i) =>
                                i === index ? { ...r, inputCentsPerM: Number(e.target.value) } : r,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={row.outputCentsPerM}
                          onChange={(e) =>
                            setPricing(
                              pricing.map((r, i) =>
                                i === index ? { ...r, outputCentsPerM: Number(e.target.value) } : r,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          placeholder="global"
                          value={row.markupPercent ?? ""}
                          onChange={(e) =>
                            setPricing(
                              pricing.map((r, i) =>
                                i === index
                                  ? {
                                      ...r,
                                      markupPercent:
                                        e.target.value === "" ? undefined : Number(e.target.value),
                                    }
                                  : r,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          onChange={(e) =>
                            setPricing(
                              pricing.map((r, i) => (i === index ? { ...r, enabled: e.target.checked } : r)),
                            )
                          }
                        />
                      </td>
                      <td>
                        <div className="admin-actions">
                          <button
                            className="ghost small"
                            type="button"
                            onClick={() => void savePricingRow(pricing[index])}
                          >
                            Save
                          </button>
                          <button
                            className="ghost small danger"
                            type="button"
                            onClick={() => void deletePricingRow(row.model)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="ghost small"
                style={{ marginTop: 10 }}
                type="button"
                onClick={() =>
                  setPricing([
                    ...pricing,
                    {
                      model: "new-model",
                      provider: "",
                      inputCentsPerM: 0,
                      outputCentsPerM: 0,
                      enabled: true,
                      updatedAt: new Date().toISOString(),
                    },
                  ])
                }
              >
                Add model
              </button>
            </div>
          </div>
        )}

        {tab === "recipes" && (
          <div>
            <p className="admin-muted">
              Extraction recipes learned by bots for sites yt-dlp doesn't support. Approve one to apply it
              automatically to future downloads from that domain.
            </p>
            {recipes.length === 0 && <p className="admin-muted">No recipes proposed yet.</p>}
            {recipes.map((recipe) => (
              <div key={recipe.domain} className="admin-card">
                <div className="admin-actions" style={{ alignItems: "center" }}>
                  <strong style={{ fontSize: 14 }}>{recipe.domain}</strong>
                  <span className={`admin-pill ${recipe.status}`}>{recipe.status}</span>
                  <span style={{ flex: 1 }} />
                  {recipe.status !== "approved" && (
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => void setRecipeStatus(recipe, "approved")}
                    >
                      Approve
                    </button>
                  )}
                  {recipe.status !== "rejected" && (
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => void setRecipeStatus(recipe, "rejected")}
                    >
                      Reject
                    </button>
                  )}
                  <button
                    className="ghost small danger"
                    type="button"
                    onClick={() => void deleteRecipe(recipe.domain)}
                  >
                    Delete
                  </button>
                </div>
                <p className="admin-muted" style={{ marginTop: 6, wordBreak: "break-all" }}>
                  <code>{recipe.pattern}</code>
                  {recipe.note ? ` — ${recipe.note}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
