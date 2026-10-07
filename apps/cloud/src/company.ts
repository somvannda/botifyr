import {
  DEPARTMENTS,
  type CompanyDNA,
  type CreateWorkspaceRequest,
  type Department,
  type OperatingHours,
  type RoleDefinition,
  type WorkItem,
  type WorkspaceBudget,
} from "@botifyr/shared";
import { recommendTeam, ROLE_BY_ID } from "./recommend.js";

/**
 * Company onboarding: turn a website or a free-form idea into a proposed org
 * chart (a `CreateWorkspaceRequest`). The model plans; we validate/clamp its
 * output and fall back to a sensible default company on any failure.
 * See docs/company-workspace.md.
 */

export const toDepartment = (value: unknown): Department =>
  typeof value === "string" && (DEPARTMENTS as string[]).includes(value) ? (value as Department) : "ops";

export interface PlanInput {
  kind: "url" | "idea";
  value: string;
  name?: string;
  /** Company stage from the DNA; shapes the recommended team. */
  stage?: CompanyDNA["stage"];
}

/** A planned org chart: like a create request, but with members guaranteed. */
export interface CompanyPlan extends Omit<CreateWorkspaceRequest, "members"> {
  members: NonNullable<CreateWorkspaceRequest["members"]>;
  /** Planning annotations surfaced to the CEO (not sent on create). */
  template?: string;
  rationale?: string[];
}

/** A one-shot text completion, injected so planning is easy to test. */
export type CompleteFn = (input: { system: string; user: string; maxTokens: number }) => Promise<string>;

/** True when a company's token budget is set and exhausted (docs/company-os.md §15). */
export function isBudgetExhausted(budget: WorkspaceBudget | null): boolean {
  return Boolean(budget && budget.limitTokens > 0 && budget.usedTokens >= budget.limitTokens);
}

/** A paused or archived company does not run its schedules (docs/company-os.md §22). */
export function shouldRunSchedule(workspaceStatus: string | undefined): boolean {
  return workspaceStatus !== "paused" && workspaceStatus !== "archived";
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local day-of-week and hour (0–24) for `now` in an IANA timezone (default UTC). */
function zonedParts(now: Date, timezone?: string): { day: number; hour: number } {
  if (!timezone) {
    return { day: now.getUTCDay(), hour: now.getUTCHours() + now.getUTCMinutes() / 60 };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
    return {
      day: WEEKDAYS[value("weekday")] ?? now.getUTCDay(),
      hour: Number(value("hour")) + Number(value("minute")) / 60,
    };
  } catch {
    return { day: now.getUTCDay(), hour: now.getUTCHours() + now.getUTCMinutes() / 60 };
  }
}

/** True when `now` is inside the company's operating hours. No hours set = always. */
export function withinOperatingHours(hours: OperatingHours | undefined, now: Date): boolean {
  if (!hours) return true;
  const { day, hour } = zonedParts(now, hours.timezone);
  if (Array.isArray(hours.days) && hours.days.length > 0 && !hours.days.includes(day)) {
    return false;
  }
  return hour >= hours.start && hour < hours.end;
}

/** Summarise the board + approvals into a short standup (docs/company-os.md §5). */
export function buildStandup(items: WorkItem[], pendingApprovals: number): string {
  const count = (status: WorkItem["status"]): number => items.filter((item) => item.status === status).length;
  const blocked = items
    .filter((item) => item.status === "blocked")
    .slice(0, 5)
    .map((item) => `• Blocked: ${item.title}`);
  const lines = [
    `Standup — ${items.length} task${items.length === 1 ? "" : "s"}: ` +
      `${count("in_progress")} in progress, ${count("blocked")} blocked, ${count("todo")} to do, ${count("done")} done.`,
    pendingApprovals > 0
      ? `${pendingApprovals} item${pendingApprovals === 1 ? "" : "s"} need your approval.`
      : "Nothing needs you.",
    ...blocked,
  ];
  return lines.join("\n").slice(0, 4000);
}

/** Summarise the board + approvals into a weekly report (docs/company-os.md §5). */
export function buildWeeklyReport(items: WorkItem[], pendingApprovals: number): string {
  const done = items.filter((item) => item.status === "done");
  const open = items.filter((item) => item.status !== "done");
  const blocked = items.filter((item) => item.status === "blocked");
  const lines = [
    `Weekly report — ${done.length} done, ${open.length} open, ${blocked.length} blocked.`,
    pendingApprovals > 0
      ? `${pendingApprovals} item${pendingApprovals === 1 ? "" : "s"} need your approval.`
      : "Nothing needs you.",
    `Done: ${done.slice(0, 8).map((item) => item.title).join("; ") || "—"}.`,
    `In flight: ${open.slice(0, 8).map((item) => item.title).join("; ") || "—"}.`,
  ];
  return lines.join("\n").slice(0, 4000);
}

/** The shared business briefing prepended to every employee's instructions. */
export function companyContext(dna: CompanyDNA): string {
  const lines = [
    `Company: ${dna.industry}${dna.category ? ` — ${dna.category}` : ""}`,
    dna.summary && `What we do: ${dna.summary}`,
    dna.businessModel && `Business model: ${dna.businessModel}`,
    dna.targetMarket.length > 0 && `Market: ${dna.targetMarket.join(", ")}`,
    dna.targetCustomers.length > 0 && `Customers: ${dna.targetCustomers.join(", ")}`,
    dna.product.features.length > 0 && `Product: ${dna.product.features.join(", ")}`,
    `Stage: ${dna.stage}`,
    dna.goal && `Current goal: ${dna.goal}`,
    dna.priorities.length > 0 && `Priorities: ${dna.priorities.join(", ")}`,
  ].filter((line): line is string => Boolean(line));
  return `You are an employee of this company — keep it in mind in everything you do.\n${lines.join("\n")}`.slice(
    0,
    2000,
  );
}

export interface SourceInput {
  kind: "url" | "idea";
  value: string;
}

export interface AnalyzeDeps {
  complete: CompleteFn;
  /** Fetch a page's HTML; injected so tests don't hit the network. */
  fetchText?: (url: string) => Promise<string>;
}

/** Pull cheap signals (title/meta/headings + visible text) out of a page. */
export function extractPageSignals(html: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const description =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1]?.trim() ?? "";
  const headings = [...html.matchAll(/<h[12][^>]*>([^<]+)<\/h[12]>/gi)]
    .map((match) => match[1].trim())
    .slice(0, 12)
    .join(" | ");
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  return [
    title && `Title: ${title}`,
    description && `Description: ${description}`,
    headings && `Headings: ${headings}`,
    `Text: ${text}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Validate / clamp a model-produced DNA; never loses the fallback's shape. */
export function sanitizeDNA(raw: unknown, fallback: CompanyDNA): CompanyDNA {
  if (!raw || typeof raw !== "object") return fallback;
  const record = raw as Record<string, unknown>;
  const product = (
    record.product && typeof record.product === "object" ? record.product : {}
  ) as Record<string, unknown>;
  const str = (value: unknown, fallbackValue: string, max = 200): string =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallbackValue;
  const list = (value: unknown, max = 20): string[] =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.slice(0, 80))
          .slice(0, max)
      : [];
  const stage = ["idea", "mvp", "launched", "scaling"].includes(String(record.stage))
    ? (record.stage as CompanyDNA["stage"])
    : fallback.stage;
  const market = list(record.targetMarket);
  const customers = list(record.targetCustomers);
  const features = list(product.features);
  const gaps = list(product.gaps);
  const priorities = list(record.priorities, 8);
  return {
    industry: str(record.industry, fallback.industry),
    category: str(record.category, fallback.category),
    summary: str(record.summary, fallback.summary, 400),
    businessModel: str(record.businessModel, fallback.businessModel),
    targetMarket: market.length > 0 ? market : fallback.targetMarket,
    targetCustomers: customers.length > 0 ? customers : fallback.targetCustomers,
    product: {
      type: str(product.type, fallback.product.type),
      features: features.length > 0 ? features : fallback.product.features,
      gaps: gaps.length > 0 ? gaps : fallback.product.gaps,
    },
    stage,
    goal: str(record.goal, fallback.goal, 300),
    priorities: priorities.length > 0 ? priorities : fallback.priorities,
    brand: fallback.brand,
    metrics: fallback.metrics,
  };
}

/** Turn an idea or website into a Company DNA draft + notes. Never throws. */
export async function analyzeSource(
  input: SourceInput,
  deps: AnalyzeDeps,
): Promise<{ dna: CompanyDNA; notes: string[] }> {
  const fallback = defaultCompany({ kind: input.kind, value: input.value }).dna ?? {
    industry: input.value.slice(0, 60) || "New Company",
    category: "startup",
    summary: "",
    businessModel: "",
    targetMarket: [],
    targetCustomers: [],
    product: { type: "product", features: [], gaps: [] },
    stage: "idea",
    goal: "",
    priorities: [],
  };
  const notes: string[] = [];
  try {
    let context = input.value;
    if (input.kind === "url" && deps.fetchText) {
      try {
        context = extractPageSignals(await deps.fetchText(input.value));
        notes.push("Read the website.");
      } catch {
        notes.push("Could not read the website; used the URL only.");
      }
    }
    const system =
      "You analyse a business and reply with STRICT JSON only, no prose: " +
      '{"industry":string,"category":string,"summary":string,"businessModel":string,' +
      '"targetMarket":string[],"targetCustomers":string[],"product":{"type":string,' +
      '"features":string[],"gaps":string[]},"stage":"idea|mvp|launched|scaling",' +
      '"goal":string,"priorities":string[]}';
    const user = `Business source (${input.kind}):\n${context.slice(0, 6000)}`;
    const text = await deps.complete({ system, user, maxTokens: 900 });
    return { dna: sanitizeDNA(extractJson(text), fallback), notes };
  } catch {
    return { dna: fallback, notes };
  }
}

const MAX_MEMBERS = 8;

/** Emoji per department, used when the catalog builds a default org. */
const ROLE_EMOJI: Record<string, string> = {
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
const SCHEME_COUNT = 8;

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function deriveName(input: PlanInput): string {
  if (input.kind === "url") {
    try {
      const host = new URL(input.value).hostname.replace(/^www\./, "");
      const base = host.split(".")[0];
      if (base) return `${titleCase(base)} Co`;
    } catch {
      // not a valid URL — fall through to the idea path
    }
  }
  const words = input.value.trim().split(/\s+/).slice(0, 3).join(" ");
  return words ? titleCase(words).slice(0, 60) : "New Company";
}

/** Deterministic default org chart; also the fallback when the model is unavailable. */
export function defaultCompany(input: PlanInput): CompanyPlan {
  const name = (input.name?.trim() || deriveName(input)).slice(0, 60);
  const mission = `${name} — ${input.value.trim().slice(0, 160) || "a new company"}.`;
  const rec = recommendTeam({ text: `${name} ${input.value}`, stage: input.stage ?? "idea" });
  return {
    name,
    source: { kind: input.kind, value: input.value.slice(0, 500) },
    mission: mission.slice(0, 2000),
    dna: {
      industry: name,
      category: "startup",
      summary: mission.slice(0, 300),
      businessModel: "",
      targetMarket: [],
      targetCustomers: [],
      product: { type: input.kind === "url" ? "web" : "product", features: [], gaps: [] },
      stage: input.stage ?? "idea",
      goal: `Get ${name} to its first customers`,
      priorities: ["product"],
    },
    avatarEmoji: input.kind === "url" ? "🌐" : "🚀",
    template: rec.template,
    rationale: rec.rationale,
    members: rec.roleIds
      .map((id) => ROLE_BY_ID.get(id))
      .filter((role): role is RoleDefinition => Boolean(role))
      .map((role, index) => ({
        name: role.title,
        emoji: ROLE_EMOJI[role.department] ?? "🤖",
        scheme: index % SCHEME_COUNT,
        title: role.title,
        department: role.department,
        isChair: role.id === "exec.ceo",
        instructions: role.jobDescription,
      })),
  };
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Validate and clamp a model-produced org chart; returns null when unusable. */
export function sanitizePlan(raw: unknown, input: PlanInput): CompanyPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const fallback = defaultCompany(input);

  const name =
    typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 60) : fallback.name;
  const mission = typeof record.mission === "string" ? record.mission.slice(0, 2000) : fallback.mission;
  const avatarEmoji =
    typeof record.avatarEmoji === "string" && record.avatarEmoji.trim()
      ? record.avatarEmoji.trim().slice(0, 8)
      : fallback.avatarEmoji;

  const rawMembers = Array.isArray(record.members) ? record.members : [];
  const members = rawMembers
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry, index) => ({
      name: (typeof entry.name === "string" ? entry.name : "").trim().slice(0, 40),
      emoji: typeof entry.emoji === "string" && entry.emoji.trim() ? entry.emoji.trim().slice(0, 8) : "🤖",
      scheme: Number.isInteger(entry.scheme)
        ? Math.abs(Number(entry.scheme)) % SCHEME_COUNT
        : index % SCHEME_COUNT,
      title: (typeof entry.title === "string" ? entry.title : "").trim().slice(0, 40) || "Member",
      department: toDepartment(entry.department),
      instructions: typeof entry.instructions === "string" ? entry.instructions.slice(0, 4000) : "",
      isChair: entry.isChair === true,
    }))
    .filter((member) => member.name.length > 0)
    .slice(0, MAX_MEMBERS);

  if (members.length === 0) return null;

  // Guarantee exactly one chair (the first member when the model omitted it).
  const chairIndex = members.findIndex((member) => member.isChair);
  const resolved = members.map((member, index) => ({
    ...member,
    isChair: chairIndex === -1 ? index === 0 : index === chairIndex,
  }));

  return {
    name,
    source: { kind: input.kind, value: input.value.slice(0, 500) },
    mission,
    avatarEmoji,
    template: typeof record.template === "string" ? record.template.slice(0, 40) : "model",
    rationale: ["Model-designed org chart."],
    members: resolved,
  };
}

/** Plan a company from a website or an idea; never throws (falls back to a default org). */
export async function planCompany(
  input: PlanInput,
  complete: CompleteFn,
  dna?: CompanyDNA,
): Promise<CompanyPlan> {
  const system =
    "You design small, effective company org charts. Reply with STRICT JSON only — no prose, no markdown. " +
    'Shape: {"name":string,"mission":string,"avatarEmoji":string,"members":[{"name":string,"title":string,' +
    '"department":"exec|product|engineering|growth|ops|finance|support|design","emoji":string,' +
    '"instructions":string,"isChair":boolean}]}. Create 3 to 6 employees, each with a distinct role and short ' +
    "standing instructions. Exactly one member has isChair true (the one who reports to the human CEO).";
  const user = `Company source (${input.kind}): ${input.value.slice(0, 1000)}${
    input.name ? `\nRequested name: ${input.name}` : ""
  }${dna ? `\nBusiness: ${dna.industry} — ${dna.summary}` : ""}`;
  const finish = (plan: CompanyPlan): CompanyPlan => (dna ? { ...plan, dna } : plan);
  try {
    const text = await complete({ system, user, maxTokens: 1200 });
    return finish(sanitizePlan(extractJson(text), input) ?? defaultCompany(input));
  } catch {
    return finish(defaultCompany(input));
  }
}
