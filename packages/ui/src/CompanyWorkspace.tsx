import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  Bot,
  CapabilityGrant,
  CompanyDirection,
  CompanyDNA,
  CompanyReport,
  CreateWorkspaceRequest,
  Quest,
  Task,
  WorkspaceBudget,
  WorkspaceWithRoles,
  WorkItem,
} from "@botifyr/shared";
import { ROLE_CATALOG } from "@botifyr/shared";
import type { BotifyrClient } from "@botifyr/client";
import {
  CheckIcon,
  CloseIcon,
  CubeIcon,
  PlayIcon,
  RefreshIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
} from "./Icons";
import { Select } from "./Select";

const ROLE_BY_ID = new Map(ROLE_CATALOG.map((role) => [role.id, role]));
const DEFAULT_EMOJI = "🤖";

/** Emoji per department, for a direction's proposed team. */
const DEPT_EMOJI: Record<string, string> = {
  exec: "🧭",
  product: "📦",
  engineering: "💻",
  design: "🎨",
  data: "📊",
  ai: "🤖",
  growth: "📈",
  marketing: "📣",
  sales: "💰",
  support: "🎧",
  success: "🤝",
  ops: "⚙️",
  finance: "💵",
  legal: "⚖️",
  people: "🧑‍💼",
  logistics: "🚚",
};

/** A pasted value is a URL when it looks like one, else an idea. */
function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^[\w-]+\.[a-z]{2,}(\/|$)/i.test(value);
}

/** Turn a chosen direction's role ids into hire-ready members. */
function membersFromDirection(direction: CompanyDirection): NonNullable<CreateWorkspaceRequest["members"]> {
  return direction.roles
    .map((id) => ROLE_BY_ID.get(id))
    .filter((role): role is (typeof ROLE_CATALOG)[number] => Boolean(role))
    .map((role) => ({
      name: role.title,
      emoji: DEPT_EMOJI[role.department] ?? DEFAULT_EMOJI,
      title: role.title,
      department: role.department,
      instructions: role.jobDescription,
      isChair: role.id === "exec.ceo",
    }));
}

/** The plan `planCompany` returns, plus the review fields we edit inline. */
type CompanyPlan = CreateWorkspaceRequest & {
  template?: string;
  rationale?: string[];
  dna?: CompanyDNA;
  notes?: string[];
  directions?: CompanyDirection[];
};

/**
 * The Startup Workspace — the founder's home for one AI company
 * (docs/product-plan.md §4–5). A full-pane view in the main area, a sibling of
 * `FeedView`, so the company is a *workspace*, never a pop-up modal.
 *
 * It is self-contained: it loads the company's board, quests, needs, grants,
 * reports and wiki from the client, exactly like the Feed owns its data.
 *
 * The loop it is shaped around (the CEO's guidance):
 *   1 idea → 2 AI CEO plan → 3 agents work → 4 founder sees results →
 *   5 founder sets the next direction.
 */

type WorkspaceFile = { id: string; name: string; content: string; department?: string };

type Section =
  | "home"
  | "inbox"
  | "team"
  | "board"
  | "office"
  | "wiki"
  | "budget"
  | "standup"
  | "changes";

interface Priority {
  id: string;
  title: string;
  detail?: string;
  /** "ai" = the company can just do it; "founder" = it needs your decision. */
  mode: "ai" | "founder";
}

export function CompanyWorkspace({
  client,
  companies,
  bots,
  focusCompanyId,
  createNonce,
  onOpenOffice,
  renderOfficeEmbedded,
  onCreated,
}: {
  client: BotifyrClient;
  /** Every company the account owns (from the sidebar's "startups" list). */
  companies: WorkspaceWithRoles[];
  bots: Bot[];
  /** When set, jump to this company (e.g. the sidebar's board button). */
  focusCompanyId?: string | null;
  /** Bumped by a host action ("Start a company") to open the inline flow. */
  createNonce?: number;
  /** Open the 3D office for a company (docked, not a modal). */
  onOpenOffice: (company: { id: string; name: string }) => void;
  /** Render the 3D office inline in the Office section (preferred). */
  renderOfficeEmbedded?: (company: { id: string; name: string }) => ReactNode;
  /** A company was created inline → refresh the account + focus it. */
  onCreated?: (company: WorkspaceWithRoles) => void | Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [meta, setMeta] = useState<WorkspaceWithRoles | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [needs, setNeeds] = useState<Task[]>([]);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [grants, setGrants] = useState<CapabilityGrant[]>([]);
  const [reports, setReports] = useState<CompanyReport[]>([]);
  const [wiki, setWiki] = useState<WorkspaceFile[]>([]);
  const [proposals, setProposals] = useState<
    Array<{ repo: string; path: string; content: string; diff: string; exists: boolean }>
  >([]);
  const [activity, setActivity] = useState<
    Array<{ id: string; goal: string; status: string; error: string | null; updatedAt: string }>
  >([]);
  const [budget, setBudget] = useState<WorkspaceBudget | null>(null);
  void budget; // referenced; surfaced in the UI as that work lands
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [tab, setTab] = useState<Section>("home");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [lastVisitAt, setLastVisitAt] = useState<string | null>(null);

  // Inline onboarding (Slice 2): idea/URL → AI plan → create. No modal.
  const [creating, setCreating] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [plan, setPlan] = useState<CompanyPlan | null>(null);
  const [directionId, setDirectionId] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [guidance, setGuidance] = useState("");
  const [newQuestTitle, setNewQuestTitle] = useState("");
  const [newQuestObjective, setNewQuestObjective] = useState("");
  const [refineBusy, setRefineBusy] = useState(false);
  const [refined, setRefined] = useState(false);
  const composerRef = useRef<HTMLInputElement | null>(null);

  // Keep the selected company valid as the list loads/refreshes.
  useEffect(() => {
    setSelectedId((prev) => {
      if (focusCompanyId && companies.some((entry) => entry.id === focusCompanyId)) return focusCompanyId;
      if (prev && companies.some((entry) => entry.id === prev)) return prev;
      return companies[0]?.id ?? "";
    });
  }, [focusCompanyId, companies]);

  const load = useCallback(
    async (id: string) => {
      if (!id) {
        setItems([]);
        setNeeds([]);
        setQuests([]);
        setGrants([]);
        setReports([]);
        setWiki([]);
        setBudget(null);
        setMeta(null);
        return;
      }
      setLoading(true);
      try {
        const [it, nd, bd, gr, rp, qs, wk, ws, pr, ac] = await Promise.all([
          client.listWorkItems(id).catch(() => []),
          client.listWorkspaceNeeds(id).catch(() => []),
          client.getWorkspaceBudget(id).catch(() => null),
          client.listCapabilityGrants(id).catch(() => []),
          client.listCompanyReports(id).catch(() => []),
          client.listQuests(id).catch(() => []),
          client.listWorkspaceFiles(id).catch(() => []),
          client.getWorkspace(id).catch(() => null),
          client.listProposals(id).catch(() => []),
          client.listWorkspaceActivity(id).catch(() => []),
        ]);
        setItems(it);
        setNeeds(nd);
        setBudget(bd);
        setBudgetInput(bd && bd.limitTokens > 0 ? String(bd.limitTokens) : "");
        setGrants(gr);
        setReports(rp);
        setQuests(qs);
        setWiki(wk);
        setProposals(pr);
        setActivity(ac);
        if (ws) setMeta(ws);
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  // "Since your last visit" is measured from the previous open (local). Kept out
  // of `load` so a refresh/auto-refresh doesn't reset the delta.
  useEffect(() => {
    if (!selectedId) {
      setLastVisitAt(null);
      return;
    }
    try {
      const key = `botifyr.lastVisit.${selectedId}`;
      setLastVisitAt(localStorage.getItem(key));
      localStorage.setItem(key, new Date().toISOString());
    } catch {
      setLastVisitAt(null);
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) void load(selectedId);
  }, [selectedId, load]);

  // Keep the workspace live while it is open — agents work on schedules.
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setInterval(() => {
      if (!busyRef.current) void load(selectedId);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [selectedId, load]);

  // A host "Start a company" action opens the inline onboarding (no modal).
  useEffect(() => {
    if (createNonce) {
      resetOnboarding();
      setCreating(true);
    }
  }, [createNonce]);

  const company = useMemo(
    () => companies.find((entry) => entry.id === selectedId) ?? null,
    [companies, selectedId],
  );
  const view = meta ?? company;

  const activeQuest = quests.find((quest) => quest.status === "active") ?? null;
  const proposedQuests = quests.filter((quest) => quest.status === "proposed");
  const questItems = useMemo(
    () => (activeQuest ? items.filter((item) => item.questId === activeQuest.id) : []),
    [activeQuest, items],
  );
  const questDone = questItems.filter((item) => item.status === "done").length;

  const promotions = useMemo(
    () =>
      grants.filter((grant) => {
        const state = grant.state ?? "gated";
        if (state === "trusted") return false;
        const needed =
          grant.capability.startsWith("ads.") || grant.capability.startsWith("payments.") ? 10 : 5;
        return (grant.successes ?? 0) >= needed && (grant.failures ?? 0) === 0;
      }),
    [grants],
  );

  /** Today's priorities: the next open work items plus anything needing a decision. */
  const priorities = useMemo<Priority[]>(() => {
    const list: Priority[] = [];
    for (const item of questItems.filter((entry) => entry.status !== "done").slice(0, 4)) {
      list.push({
        id: item.id,
        title: item.title,
        detail: item.detail,
        mode: item.status === "blocked" || item.status === "review" ? "founder" : "ai",
      });
    }
    return list;
  }, [questItems]);

  const sinceMs = lastVisitAt ? new Date(lastVisitAt).getTime() : 0;
  const shippedSince = sinceMs
    ? items.filter((item) => item.status === "done" && new Date(item.updatedAt).getTime() > sinceMs)
    : [];
  const newReports = sinceMs
    ? reports.filter((report) => new Date(report.createdAt).getTime() > sinceMs)
    : [];

  const inboxCount = needs.length + proposedQuests.length + promotions.length;
  const failedRuns = activity.filter((run) => run.status === "failed");
  const runningRuns = activity.filter((run) => run.status === "running" || run.status === "queued");
  const members = view?.roles ?? [];

  function botName(botId?: string): string {
    return bots.find((entry) => entry.id === botId)?.name ?? (botId ? botId.slice(0, 6) : "");
  }

  async function refresh() {
    if (selectedId) await load(selectedId);
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function resolveNeed(task: Task, decision: "allow" | "deny") {
    const approvalId = task.approval?.id;
    if (!approvalId) return;
    await withBusy(async () => {
      await client.resolveApproval(task.id, approvalId, decision).catch(() => {});
      setNeeds(await client.listWorkspaceNeeds(selectedId).catch(() => needs));
    });
  }

  async function setGrantState(subject: string, capability: string, state: CapabilityGrant["state"]) {
    await withBusy(async () => {
      await client
        .setCapabilityGrant(selectedId, { subject, capability, granted: true, state })
        .catch(() => {});
      setGrants(await client.listCapabilityGrants(selectedId).catch(() => grants));
    });
  }

  async function toggleGrant(subject: string, capability: string, granted: boolean) {
    await withBusy(async () => {
      await client.setCapabilityGrant(selectedId, { subject, capability, granted }).catch(() => {});
      setGrants(await client.listCapabilityGrants(selectedId).catch(() => grants));
    });
  }

  async function activateQuest(questId: string) {
    await withBusy(async () => {
      await client.updateQuest(questId, { status: "active" }).catch(() => {});
      setQuests(await client.listQuests(selectedId).catch(() => quests));
    });
  }

  async function finishQuest(questId: string) {
    await withBusy(async () => {
      await client.completeQuest(selectedId, questId).catch(() => {});
      await refresh();
    });
  }

  async function addBoardItem() {
    const title = draft.trim();
    if (!title || busy) return;
    await withBusy(async () => {
      await client
        .createWorkItem(selectedId, {
          title,
          detail: "Directive from the founder.",
          phase: "ongoing",
          department: "exec",
          assigneeBotId: view?.ceoBotId,
        })
        .catch(() => null);
      setDraft("");
      setNotice("Sent to your CEO.");
      setItems(await client.listWorkItems(selectedId).catch(() => items));
    });
  }

  async function setWorkStatus(id: string, status: WorkItem["status"]) {
    await withBusy(async () => {
      await client.updateWorkItem(id, { status }).catch(() => {});
      setItems(await client.listWorkItems(selectedId).catch(() => items));
    });
  }

  async function runNow() {
    await withBusy(async () => {
      await client.runCompany(selectedId).catch(() => null);
      setNotice("Asked every employee to pick up their work.");
      // Reflect the new runs immediately so the button flips to Stop.
      setActivity(await client.listWorkspaceActivity(selectedId).catch(() => activity));
      setItems(await client.listWorkItems(selectedId).catch(() => items));
    });
  }

  /** Stop: cancel every run that is still queued or executing. */
  async function stopRuns() {
    const active = runningRuns;
    if (!active.length) return;
    await withBusy(async () => {
      await Promise.all(active.map((run) => client.cancelTask(run.id).catch(() => {})));
      setNotice("Stopped the work that was running.");
      setActivity(await client.listWorkspaceActivity(selectedId).catch(() => activity));
      setItems(await client.listWorkItems(selectedId).catch(() => items));
    });
  }

  async function saveBudget() {
    const limit = Math.max(0, Math.floor(Number(budgetInput) || 0));
    await withBusy(async () => {
      const updated = await client.setWorkspaceBudget(selectedId, limit).catch(() => null);
      if (updated) setBudget(updated);
    });
  }

  async function runStandup(kind: "standup" | "weekly") {
    await withBusy(async () => {
      const report = await client.runStandup(selectedId, kind).catch(() => null);
      if (report) setReports((prev) => [report, ...prev]);
    });
  }

  /** Per-quest autonomy dial (defaults to the workspace setting). */
  async function setQuestTrust(trust: Quest["trust"]) {
    const quest = activeQuest;
    if (!quest) return;
    setQuests((prev) => prev.map((entry) => (entry.id === quest.id ? { ...entry, trust } : entry)));
    await withBusy(async () => {
      await client.updateQuest(quest.id, { trust }).catch(() => {});
    });
  }

  /** Per-quest token cap (0 = inherit the workspace cap). */
  async function setQuestBudget(value: string) {
    const quest = activeQuest;
    if (!quest) return;
    const tokens = Math.max(0, Math.floor(Number(value) || 0));
    setQuests((prev) =>
      prev.map((entry) =>
        entry.id === quest.id ? { ...entry, budgetTokens: tokens || undefined } : entry,
      ),
    );
    await withBusy(async () => {
      await client.updateQuest(quest.id, { budgetTokens: tokens || null }).catch(() => {});
    });
  }

  /** Grow: start the company's next mission (one active at a time). */
  async function startQuest() {
    const title = newQuestTitle.trim();
    if (!title || busy) return;
    await withBusy(async () => {
      await client
        .createQuest(selectedId, {
          title,
          objective: newQuestObjective.trim() || title,
          activate: true,
        })
        .catch(() => null);
      setNewQuestTitle("");
      setNewQuestObjective("");
      setQuests(await client.listQuests(selectedId).catch(() => quests));
      setItems(await client.listWorkItems(selectedId).catch(() => items));
    });
  }

  /** The ranked decision queue — reused by Home and the Inbox tab. */
  const renderNeedList = () => (
    <ul className="cws-list">
      {promotions.map((grant) => (
        <li key={`${grant.subject}|${grant.capability}`} className="cws-need">
          <span className="cws-need-text">
            Promote <strong>{grant.capability}</strong> to{" "}
            {(grant.state ?? "gated") === "probation" ? "trusted" : "probation"}
          </span>
          <span className="cws-muted">{grant.successes ?? 0} clean runs</span>
          <button
            className="btn primary small"
            type="button"
            disabled={busy}
            onClick={() =>
              void setGrantState(
                grant.subject,
                grant.capability,
                (grant.state ?? "gated") === "probation" ? "trusted" : "probation",
              )
            }
          >
            Promote
          </button>
        </li>
      ))}
      {proposedQuests.map((quest) => (
        <li key={quest.id} className="cws-need">
          <span className="cws-need-text">
            Start mission: <strong>{quest.title}</strong>
          </span>
          <span className="cws-muted">{quest.objective}</span>
          <button
            className="btn primary small"
            type="button"
            disabled={busy}
            onClick={() => void activateQuest(quest.id)}
          >
            Start
          </button>
        </li>
      ))}
      {needs.map((task) => (
        <li key={task.id} className="cws-need">
          <span className="cws-need-text">{task.goal}</span>
          <div className="cws-need-actions">
            <button
              className="ghost small"
              type="button"
              disabled={busy}
              onClick={() => void resolveNeed(task, "deny")}
            >
              Deny
            </button>
            <button
              className="btn primary small"
              type="button"
              disabled={busy}
              onClick={() => void resolveNeed(task, "allow")}
            >
              Allow
            </button>
          </div>
        </li>
      ))}
    </ul>
  );

  /** Send the founder to the CEO composer, optionally prefilling a lead-in. */
  function askCeo(prefix = "") {
    if (prefix) setDraft(prefix);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function setAutonomy(level: "manual" | "supervised" | "autonomous") {
    await withBusy(async () => {
      const updated =
        level === "manual"
          ? await client.deactivateCompany(selectedId).catch(() => null)
          : await client
              .activateCompany(selectedId, level, Intl.DateTimeFormat().resolvedOptions().timeZone)
              .catch(() => null);
      if (updated) setMeta(updated);
    });
  }

  function tellCeo(event: FormEvent) {
    event.preventDefault();
    void addBoardItem();
  }

  /* ---------- Inline onboarding (idea → AI plan → company) ---------- */

  function resetOnboarding() {
    setSourceText("");
    setSourceUrl("");
    setPlan(null);
    setDirectionId(null);
    setPlanError(null);
    setPlanBusy(false);
    setGuidance("");
    setRefined(false);
  }

  /** Rewrite a rough idea into a concrete brief the agents can act on. */
  async function refineIdea() {
    const idea = sourceText.trim();
    if (!idea || refineBusy || looksLikeUrl(idea)) return;
    setRefineBusy(true);
    setPlanError(null);
    try {
      const { brief } = await client.rewriteCompanyBrief({
        kind: "idea",
        value: idea,
        guidance: guidance.trim() || undefined,
      });
      if (brief) {
        setSourceText(brief);
        setRefined(true);
      }
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Couldn't refine the brief.");
    } finally {
      setRefineBusy(false);
    }
  }

  function chooseDirection(direction: CompanyDirection) {
    setDirectionId(direction.id);
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            directionId: direction.id,
            members: membersFromDirection(direction),
            quest: {
              title: direction.title,
              objective: direction.objective,
              acceptance: [direction.objective],
              roadmap: direction.roadmap,
            },
          }
        : prev,
    );
  }

  function updatePlanMember(
    index: number,
    patch: Partial<NonNullable<CreateWorkspaceRequest["members"]>[number]>,
  ) {
    setPlan((prev) =>
      prev?.members
        ? {
            ...prev,
            members: prev.members.map((member, i) => (i === index ? { ...member, ...patch } : member)),
          }
        : prev,
    );
  }

  function removePlanMember(index: number) {
    setPlan((prev) =>
      prev?.members ? { ...prev, members: prev.members.filter((_, i) => i !== index) } : prev,
    );
  }

  async function runPlan() {
    const idea = sourceText.trim();
    const url = sourceUrl.trim();
    const value = url || idea;
    if (!value || planBusy) return;
    const kind: "url" | "idea" = url || looksLikeUrl(idea) ? "url" : "idea";
    setPlanBusy(true);
    setPlanError(null);
    try {
      const proposed = await client.planCompany({ kind, value });
      const next: CompanyPlan = { ...proposed };
      const first = proposed.directions?.[0];
      if (first) {
        next.directionId = first.id;
        next.members = membersFromDirection(first);
        next.quest = {
          title: first.title,
          objective: first.objective,
          acceptance: [first.objective],
          roadmap: first.roadmap,
        };
        setDirectionId(first.id);
      } else {
        setDirectionId(null);
      }
      setPlan(next);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Couldn't plan the company.");
    } finally {
      setPlanBusy(false);
    }
  }

  async function createCompany() {
    if (!plan || planBusy) return;
    const name = (plan.name || "").trim() || "My company";
    setPlanBusy(true);
    setPlanError(null);
    try {
      const created = await client.createWorkspace({ ...plan, name });
      // Recommended default: Delegated (supervised) — the CEO approves consequential work.
      await client
        .activateCompany(created.id, "supervised", Intl.DateTimeFormat().resolvedOptions().timeZone)
        .catch(() => null);
      resetOnboarding();
      setCreating(false);
      await onCreated?.(created);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Couldn't create the company.");
      setPlanBusy(false);
    }
  }

  const renderOnboarding = () => (
    <div className="cws">
      <div className="cws-topbar">
        <span className="cws-title">Startup Workspace</span>
        {companies.length > 0 && (
          <div className="cws-top-actions">
            <button
              className="ghost small"
              type="button"
              onClick={() => {
                resetOnboarding();
                setCreating(false);
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="cws-scroll">
        <div className="cws-card cws-onboard">
          {!plan ? (
            <>
              <SparkIcon size={22} />
              <h2 className="cws-onboard-title">What do you want to build?</h2>
              <div className="cws-desc-row">
                <p className="cws-muted">
                  Describe your idea or paste your existing website. We&rsquo;ll figure out the team and plan.
                </p>
                <button
                  className="cws-refine-btn"
                  type="button"
                  disabled={refineBusy || !sourceText.trim() || looksLikeUrl(sourceText.trim())}
                  title={
                    looksLikeUrl(sourceText.trim())
                      ? "Paste website URLs in the field below instead"
                      : "Rewrite the idea into a concrete brief"
                  }
                  onClick={() => void refineIdea()}
                >
                  <SparkIcon size={14} /> {refineBusy ? "Rewriting…" : "Refine with AI"}
                </button>
              </div>
              <textarea
                className="cws-onboard-input"
                rows={3}
                placeholder="Build a cloud POS platform for small businesses in Cambodia."
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
              />
              {refined && (
                <span className="cws-muted">Brief rewritten — review and edit it above.</span>
              )}
              <label className="cws-guidance">
                <span className="cws-muted">What should the company optimise for? (optional)</span>
                <input
                  className="cws-onboard-url"
                  placeholder="e.g. fastest MVP, best quality, lowest cost"
                  value={guidance}
                  onChange={(event) => setGuidance(event.target.value)}
                />
              </label>
              <input
                className="cws-onboard-url"
                placeholder="Website URL (optional)"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
              />
              {planError && <p className="cws-error">{planError}</p>}
              <button
                className="btn primary cws-onboard-btn"
                type="button"
                disabled={planBusy || (!sourceText.trim() && !sourceUrl.trim())}
                onClick={() => void runPlan()}
              >
                {planBusy ? "Planning…" : "Create my virtual company →"}
              </button>
              <p className="cws-muted">The AI fills in reasonable defaults. You can change anything later.</p>
            </>
          ) : (
            <>
              <div className="cws-onboard-head">
                <span className="cws-emoji">{plan.avatarEmoji ?? "🏢"}</span>
                <input
                  className="cws-onboard-name"
                  value={plan.name ?? ""}
                  onChange={(event) =>
                    setPlan((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                  }
                  aria-label="Company name"
                />
              </div>
              {plan.mission && <p className="cws-muted">{plan.mission}</p>}
              {plan.dna && (
                <label className="cws-charter">
                  <span className="cws-muted">Goal · {plan.dna.stage}</span>
                  <input
                    className="cws-onboard-url"
                    value={plan.dna.goal}
                    onChange={(event) =>
                      setPlan((prev) =>
                        prev?.dna ? { ...prev, dna: { ...prev.dna, goal: event.target.value } } : prev,
                      )
                    }
                    aria-label="Company goal"
                  />
                </label>
              )}
              {plan.directions && plan.directions.length > 0 && (
                <div className="cws-directions">
                  <p className="cws-muted">Choose a direction — it shapes the team and the first mission:</p>
                  {plan.directions.map((direction) => (
                    <button
                      key={direction.id}
                      type="button"
                      className={`cws-direction${directionId === direction.id ? " chosen" : ""}`}
                      onClick={() => chooseDirection(direction)}
                      aria-pressed={directionId === direction.id}
                    >
                      <span className="cws-direction-title">{direction.title}</span>
                      <span className="cws-muted">{direction.thesis}</span>
                      <span className="cws-muted">
                        {direction.objective} · ~{Math.round(direction.estimatedTokens / 1000)}k tokens
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {plan.rationale && plan.rationale.length > 0 && (
                <ul className="cws-list cws-rationale">
                  {plan.rationale.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              )}
              <div className="cws-card-head">
                <h3>Recommended team</h3>
                <span className="cws-muted">{(plan.members ?? []).length} roles</span>
              </div>
              <ul className="cws-list">
                {(plan.members ?? []).map((member, index) => (
                  <li key={index} className="cws-plan-member">
                    <span className="cws-emoji">{member.emoji ?? "🤖"}</span>
                    <input
                      className="cws-onboard-name"
                      value={member.name}
                      onChange={(event) => updatePlanMember(index, { name: event.target.value })}
                      placeholder="Name"
                      aria-label="Employee name"
                    />
                    <input
                      className="cws-onboard-name cws-plan-title"
                      value={member.title}
                      onChange={(event) => updatePlanMember(index, { title: event.target.value })}
                      placeholder="Role"
                      aria-label="Employee role"
                    />
                    <button
                      className="cws-plan-remove"
                      type="button"
                      aria-label="Remove employee"
                      onClick={() => removePlanMember(index)}
                    >
                      <CloseIcon size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              {plan.quest && (
                <p className="cws-muted">
                  First mission: <strong>{plan.quest.title}</strong> — {plan.quest.objective}
                </p>
              )}
              {planError && <p className="cws-error">{planError}</p>}
              <div className="cws-onboard-actions">
                <button
                  className="ghost small"
                  type="button"
                  disabled={planBusy}
                  onClick={() => {
                    setPlan(null);
                    setPlanError(null);
                  }}
                >
                  Back
                </button>
                <button
                  className="btn primary"
                  type="button"
                  disabled={planBusy || (plan.members ?? []).length === 0}
                  onClick={() => void createCompany()}
                >
                  {planBusy ? "Hiring…" : "Hire the team"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // No company yet (or the founder asked for a new one) → the inline one-input flow.
  if (companies.length === 0 || !view || creating) {
    return renderOnboarding();
  }

  const autonomy = view.autonomy ?? "manual";
  const paused = (view.status ?? "active") === "paused";
  void paused; // referenced; wired into the UI as that work lands

  return (
    <div className="cws">
      <div className="cws-topbar">
        <span className="cws-emoji">{view.avatarEmoji ?? "🏢"}</span>
        {companies.length > 1 ? (
          <Select
            className="cws-select"
            value={selectedId}
            onChange={setSelectedId}
            ariaLabel="Select company"
            options={companies.map((entry) => ({ value: entry.id, label: entry.name }))}
          />
        ) : (
          <span className="cws-title">{view.name}</span>
        )}
        <span className={`cws-pill cws-pill-${view.status ?? "active"}`}>{view.status ?? "active"}</span>
        <div className="cws-top-actions">
          <button
            className="ghost small"
            type="button"
            title="New company"
            onClick={() => {
              resetOnboarding();
              setCreating(true);
            }}
          >
            ＋ New
          </button>
          <button
            className="ghost small"
            type="button"
            disabled={busy || loading}
            title="Refresh — pull the latest from the company"
            onClick={() => void refresh()}
          >
            <RefreshIcon size={14} /> Refresh
          </button>
          {runningRuns.length > 0 ? (
            <button
              className="ghost small cws-stop"
              type="button"
              disabled={busy}
              title="Stop — cancel the work that is running now"
              onClick={() => void stopRuns()}
            >
              <StopIcon size={14} /> Stop
            </button>
          ) : (
            <button
              className="ghost small"
              type="button"
              disabled={busy}
              title="Run now — every employee picks up their work"
              onClick={() => void runNow()}
            >
              <PlayIcon size={14} /> Run
            </button>
          )}
          <label className="cws-autonomy" title="How much the company may do on its own">
            <Select
              className="cws-select"
              value={autonomy}
              disabled={busy}
              onChange={(next) =>
                void setAutonomy(next as "manual" | "supervised" | "autonomous")
              }
              ariaLabel="Autonomy level"
              options={[
                { value: "manual", label: "Assisted" },
                { value: "supervised", label: "Delegated (recommended)" },
                { value: "autonomous", label: "Autonomous" },
              ]}
            />
          </label>
        </div>
      </div>

      <div className="cws-tabs" role="tablist">
        {(
          [
            ["home", "Home"],
            ["inbox", `Inbox${inboxCount ? ` (${inboxCount})` : ""}`],
            ["team", "Team"],
            ["board", "Board"],
            ["office", "Office"],
            ["budget", "Budget"],
            ["standup", "Standup"],
            ["changes", "Changes"],
            ["wiki", "Wiki"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`cws-tab${tab === id ? " active" : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="cws-scroll">
        {notice && (
          <div className="cws-notice">
            {notice}
            <button type="button" className="cws-notice-x" onClick={() => setNotice(null)}>
              <CloseIcon size={12} />
            </button>
          </div>
        )}

        {loading && <p className="cws-muted">Loading the company…</p>}

        {tab === "home" && (
          <>
            <div className="cws-stats">
              <div className="cws-stat">
                <span className="cws-stat-label">AI team</span>
                <span className="cws-stat-value">{members.length}</span>
                <span className="cws-muted">
                  {members.filter((role) => role.isChair).length ? "1 chair" : "no chair"}
                </span>
              </div>
              <div className="cws-stat">
                <span className="cws-stat-label">First milestone</span>
                <span className="cws-stat-value cws-stat-value-sm">
                  {activeQuest?.title ?? proposedQuests[0]?.title ?? "Not set"}
                </span>
                <span className="cws-muted">
                  {activeQuest
                    ? `${questDone}/${questItems.length} shipped`
                    : proposedQuests.length
                      ? "Awaiting your approval"
                      : "Start the first mission"}
                </span>
              </div>
            </div>

            {failedRuns.length > 0 && (
              <div className="cws-card cws-warn">
                <div className="cws-card-head">
                  <h3>
                    ⚠ {failedRuns.length} run{failedRuns.length === 1 ? "" : "s"} failed
                  </h3>
                  <span className="cws-muted">Check the model/provider, then retry.</span>
                </div>
                <ul className="cws-list">
                  {failedRuns.slice(0, 3).map((run) => (
                    <li key={run.id} className="cws-need">
                      <span className="cws-need-text">{run.goal}</span>
                      {run.error && <span className="cws-error-inline">{run.error}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="cws-card">
              <div className="cws-card-head">
                <h3>{activeQuest ? "Current mission" : "Next mission"}</h3>
                {activeQuest && (
                  <button
                    className="ghost small"
                    type="button"
                    disabled={busy}
                    onClick={() => void finishQuest(activeQuest.id)}
                  >
                    Mark done
                  </button>
                )}
              </div>
              {activeQuest ? (
                <>
                  <p className="cws-quest-title">{activeQuest.title}</p>
                  <p className="cws-muted">{activeQuest.objective}</p>
                  <div className="cws-progress">
                    <div
                      className="cws-progress-fill"
                      style={{
                        width: `${questItems.length ? Math.round((questDone / questItems.length) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <div className="cws-quest-controls">
                    <label className="cws-quest-field">
                      <span className="cws-muted">Trust</span>
                      <Select
                        className="cws-select"
                        value={activeQuest.trust}
                        disabled={busy}
                        onChange={(next) =>
                          void setQuestTrust(next as Quest["trust"])
                        }
                        ariaLabel="Quest trust"
                        options={[
                          { value: "manual", label: "Assisted" },
                          { value: "supervised", label: "Delegated" },
                          { value: "autonomous", label: "Autonomous" },
                        ]}
                      />
                    </label>
                    <label className="cws-quest-field">
                      <span className="cws-muted">Budget</span>
                      <input
                        className="cws-onboard-url"
                        type="number"
                        min={0}
                        placeholder="inherit"
                        defaultValue={
                          activeQuest.budgetTokens && activeQuest.budgetTokens > 0
                            ? String(activeQuest.budgetTokens)
                            : ""
                        }
                        onBlur={(event) => void setQuestBudget(event.target.value)}
                        aria-label="Quest token budget"
                      />
                    </label>
                  </div>
                </>
              ) : proposedQuests[0] ? (
                <>
                  <p className="cws-quest-title">{proposedQuests[0].title}</p>
                  <p className="cws-muted">{proposedQuests[0].objective}</p>
                  <button
                    className="btn primary small"
                    type="button"
                    disabled={busy}
                    onClick={() => void activateQuest(proposedQuests[0].id)}
                  >
                    Approve & start
                  </button>
                </>
              ) : (
                <p className="cws-muted">
                  No mission yet. Tell your CEO what to do below, or start a quest from the Board.
                </p>
              )}
            </div>

            <div className="cws-card">
              <div className="cws-card-head">
                <h3>Today&rsquo;s priorities</h3>
              </div>
              {priorities.length === 0 ? (
                <p className="cws-muted">Nothing queued. Ask the CEO to plan the next step.</p>
              ) : (
                <ul className="cws-list">
                  {priorities.map((priority) => (
                    <li key={priority.id} className="cws-priority">
                      <span className={`cws-dot cws-dot-${priority.mode}`} aria-hidden="true" />
                      <span className="cws-priority-text">
                        <span className="cws-priority-title">{priority.title}</span>
                        {priority.detail && <span className="cws-muted">{priority.detail}</span>}
                      </span>
                      <span className={`cws-tag cws-tag-${priority.mode}`}>
                        {priority.mode === "ai" ? "AI can execute" : "Founder decision"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {inboxCount > 0 && (
              <div className="cws-card">
                <div className="cws-card-head">
                  <h3>Needs you</h3>
                  <span className="cws-muted">
                    {inboxCount} decision{inboxCount === 1 ? "" : "s"}
                  </span>
                </div>
                {renderNeedList()}
              </div>
            )}

            <div className="cws-card">
              <div className="cws-card-head">
                <h3>What would you like to do?</h3>
              </div>
              <div className="cws-actions">
                <button className="cws-action" type="button" onClick={() => setTab("board")}>
                  Review today&rsquo;s progress
                </button>
                <button
                  className="cws-action"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    proposedQuests[0] ? void activateQuest(proposedQuests[0].id) : askCeo()
                  }
                >
                  Approve the company plan
                </button>
                <button
                  className="cws-action"
                  type="button"
                  onClick={() => askCeo("Change direction: ")}
                >
                  Change the company direction
                </button>
                <button className="cws-action" type="button" onClick={() => askCeo()}>
                  Tell the AI CEO what to do
                </button>
              </div>
            </div>

            <div className="cws-card">
              <div className="cws-card-head">
                <h3>What the company is doing</h3>
                <span className="cws-muted">
                  {runningRuns.length ? `${runningRuns.length} running` : "idle"}
                </span>
              </div>
              {activity.length === 0 ? (
                <p className="cws-muted">No runs yet. Hit Run to give everyone their first task.</p>
              ) : (
                <ul className="cws-list">
                  {activity.slice(0, 5).map((run) => (
                    <li key={run.id} className="cws-work">
                      <span className={`cws-run-dot cws-run-${run.status}`} aria-hidden="true" />
                      <span className="cws-work-title">{run.goal}</span>
                      <span className="cws-muted">{run.status.replace("_", " ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="cws-card">
              <div className="cws-card-head">
                <h3>Since you were last here</h3>
              </div>
              {lastVisitAt ? (
                <ul className="cws-list">
                  <li>
                    {shippedSince.length} work item{shippedSince.length === 1 ? "" : "s"} shipped
                  </li>
                  <li>
                    {newReports.length} new report{newReports.length === 1 ? "" : "s"}
                  </li>
                  <li>{inboxCount ? `${inboxCount} item(s) need you` : "Nothing needs you"}</li>
                </ul>
              ) : (
                <p className="cws-muted">Your first visit — nothing to compare yet.</p>
              )}
              {shippedSince.length > 0 && (
                <ul className="cws-list cws-shipped">
                  {shippedSince.slice(0, 6).map((item) => (
                    <li key={item.id}>
                      <CheckIcon size={13} /> {item.title}
                      {item.result && <span className="cws-muted"> — {item.result}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {tab === "inbox" && (
          <div className="cws-card">
            <div className="cws-card-head">
              <h3>Needs you</h3>
              <span className="cws-muted">
                {inboxCount ? `${inboxCount} decision${inboxCount === 1 ? "" : "s"}` : "All clear"}
              </span>
            </div>
            {inboxCount === 0 && <p className="cws-muted">Nothing needs you right now.</p>}
            {renderNeedList()}
          </div>
        )}

        {tab === "team" && (
          <div className="cws-card">
            <div className="cws-card-head">
              <h3>Team</h3>
              <span className="cws-muted">{members.length} employees</span>
            </div>
            {members.length === 0 && <p className="cws-muted">No employees yet.</p>}
            <ul className="cws-list">
              {members.map((role) => {
                const caps = ROLE_CATALOG.find((entry) => entry.title === role.title)?.capabilities ?? [];
                const subject = `role:${role.title}`;
                return (
                  <li key={role.botId} className="cws-member">
                    <div className="cws-member-head">
                      <span className="cws-member-name">{botName(role.botId)}</span>
                      <span className="cws-muted">{role.title}</span>
                    </div>
                    {caps.length > 0 && (
                      <div className="cws-chips">
                        {caps.map((capability) => {
                          const grant = grants.find(
                            (entry) => entry.subject === subject && entry.capability === capability,
                          );
                          const granted = Boolean(grant?.granted);
                          return (
                            <span key={capability} className="cws-chip-wrap">
                              <button
                                className={`cws-chip${granted ? " granted" : ""}`}
                                type="button"
                                disabled={busy}
                                title="Toggle this capability"
                                onClick={() => void toggleGrant(subject, capability, !granted)}
                              >
                                {capability}
                              </button>
                              {granted && (
                                <Select
                                  className="cws-chip-state"
                                  value={grant?.state ?? "gated"}
                                  disabled={busy}
                                  onChange={(next) =>
                                    void setGrantState(
                                      subject,
                                      capability,
                                      next as CapabilityGrant["state"],
                                    )
                                  }
                                  ariaLabel={`Trust for ${capability}`}
                                  options={[
                                    { value: "gated", label: "gated" },
                                    { value: "probation", label: "probation" },
                                    { value: "trusted", label: "trusted" },
                                  ]}
                                />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {tab === "board" && (
          <>
            <div className="cws-card">
              <div className="cws-card-head">
                <h3>Start a mission</h3>
                <span className="cws-muted">one active at a time</span>
              </div>
              <input
                className="cws-onboard-url"
                placeholder="Mission title (e.g. Launch the MVP)"
                value={newQuestTitle}
                onChange={(event) => setNewQuestTitle(event.target.value)}
                aria-label="Mission title"
              />
              <input
                className="cws-onboard-url"
                placeholder="Objective — what does done deliver?"
                value={newQuestObjective}
                onChange={(event) => setNewQuestObjective(event.target.value)}
                aria-label="Mission objective"
              />
              <button
                className="btn primary small cws-onboard-btn"
                type="button"
                disabled={busy || !newQuestTitle.trim()}
                onClick={() => void startQuest()}
              >
                Start mission
              </button>
            </div>
            <div className="cws-card">
            <div className="cws-card-head">
              <h3>Board</h3>
              <span className="cws-muted">{items.length} items</span>
            </div>
            {items.length === 0 && <p className="cws-muted">No work items yet.</p>}
            <ul className="cws-list">
              {items.map((item) => (
                <li key={item.id} className="cws-work">
                  <Select
                    className={`cws-status cws-status-${item.status}`}
                    value={item.status}
                    disabled={busy}
                    onChange={(next) =>
                      void setWorkStatus(item.id, next as WorkItem["status"])
                    }
                    ariaLabel="Status"
                    options={(["todo", "in_progress", "blocked", "review", "done"] as const).map(
                      (status) => ({ value: status, label: status.replace("_", " ") }),
                    )}
                  />
                  <span className="cws-work-title">{item.title}</span>
                  <span className="cws-muted">{item.phase}</span>
                  {item.result && <span className="cws-muted cws-work-result">{item.result}</span>}
                </li>
              ))}
            </ul>
          </div>
          </>
        )}

        {tab === "office" && (
          <div className="cws-card">
            <div className="cws-card-head">
              <h3>Office</h3>
              <button
                className="ghost small"
                type="button"
                onClick={() => onOpenOffice({ id: view.id, name: view.name })}
              >
                <CubeIcon size={14} /> Open beside
              </button>
            </div>
            {renderOfficeEmbedded ? (
              <div
                className="cws-office-embed"
                style={{ height: 460, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}
              >
                {renderOfficeEmbedded({ id: view.id, name: view.name })}
              </div>
            ) : (
              <p className="cws-muted">
                The office mirrors the same board — every employee at their desk, live.
              </p>
            )}
            <ul className="cws-list">
              {members.map((role) => {
                const current = items.find(
                  (item) => item.assigneeBotId === role.botId && item.status !== "done",
                );
                return (
                  <li key={role.botId} className="cws-work">
                    <span className="cws-work-title">{botName(role.botId)}</span>
                    <span className="cws-muted">{role.title}</span>
                    <span className="cws-muted">{current ? current.title : "Idle"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {tab === "budget" && (
          <div className="cws-card">
            <div className="cws-card-head">
              <h3>Budget</h3>
              <span className="cws-muted">
                {budget ? `${budget.usedTokens.toLocaleString()} used` : "—"}
              </span>
            </div>
            <p className="cws-muted">
              Company token budget ·{" "}
              {budget && budget.limitTokens > 0
                ? `limit ${budget.limitTokens.toLocaleString()}`
                : "0 = inherit the account cap"}
            </p>
            <div className="cws-budget-row">
              <input
                className="cws-onboard-url"
                type="number"
                min={0}
                placeholder="Token limit (0 = inherit)"
                value={budgetInput}
                onChange={(event) => setBudgetInput(event.target.value)}
                aria-label="Token limit"
              />
              <button
                className="btn primary small"
                type="button"
                disabled={busy}
                onClick={() => void saveBudget()}
              >
                Save
              </button>
            </div>
          </div>
        )}

        {tab === "standup" && (
          <div className="cws-card">
            <div className="cws-card-head">
              <h3>Standup</h3>
              <div className="cws-need-actions">
                <button
                  className="btn primary small"
                  type="button"
                  disabled={busy}
                  onClick={() => void runStandup("standup")}
                >
                  Run standup
                </button>
                <button
                  className="ghost small"
                  type="button"
                  disabled={busy}
                  onClick={() => void runStandup("weekly")}
                >
                  Weekly
                </button>
              </div>
            </div>
            {reports.length === 0 && <p className="cws-muted">No standups yet.</p>}
            <ul className="cws-list">
              {reports.map((report) => (
                <li key={report.id}>
                  <span className="cws-muted">
                    {report.kind} · {new Date(report.createdAt).toLocaleString()}
                  </span>
                  <pre className="cws-pre">{report.summary}</pre>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "changes" && (
          <div className="cws-card">
            <div className="cws-card-head">
              <h3>Changes</h3>
              <span className="cws-muted">{proposals.length} staged</span>
            </div>
            {proposals.length === 0 && (
              <p className="cws-muted">
                No proposed changes yet — engineering agents stage edits here for your review.
              </p>
            )}
            <ul className="cws-list">
              {proposals.map((change) => (
                <li key={`${change.repo}/${change.path}`} className="cws-wiki">
                  <div className="cws-wiki-name">
                    {change.repo}/{change.path}
                    <span className="cws-muted">{change.exists ? "modified" : "new"}</span>
                  </div>
                  <pre className="cws-pre cws-diff">
                    {change.diff.split("\n").map((line, index) => (
                      <div
                        key={index}
                        className={
                          line.startsWith("+")
                            ? "diff-add"
                            : line.startsWith("-")
                              ? "diff-del"
                              : "diff-ctx"
                        }
                      >
                        {line || " "}
                      </div>
                    ))}
                  </pre>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "wiki" && (
          <div className="cws-card">
            <div className="cws-card-head">
              <h3>Company wiki</h3>
            </div>
            {wiki.length === 0 && <p className="cws-muted">The company wiki is empty.</p>}
            <ul className="cws-list">
              {wiki.map((file) => (
                <li key={file.id} className="cws-wiki">
                  <button
                    className="cws-wiki-name"
                    type="button"
                    onClick={() => setOpenFile((prev) => (prev === file.name ? null : file.name))}
                  >
                    <span className="cws-caret">{openFile === file.name ? "▾" : "▸"}</span>
                    {file.name}
                  </button>
                  {openFile === file.name && <pre className="cws-pre">{file.content || "(empty)"}</pre>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <form className="cws-composer" onSubmit={tellCeo}>
        <input
          ref={composerRef}
          className="cws-composer-input"
          placeholder="Tell the AI CEO what to do…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="cws-composer-btn" type="submit" disabled={busy || !draft.trim()}>
          <SendIcon size={15} />
        </button>
      </form>
    </div>
  );
}

export default CompanyWorkspace;
