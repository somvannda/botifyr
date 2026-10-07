import {
  DEPARTMENTS,
  type CompanyDNA,
  type CreateWorkspaceRequest,
  type Department,
} from "@botifyr/shared";

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
}

/** A planned org chart: like a create request, but with members guaranteed. */
export interface CompanyPlan extends Omit<CreateWorkspaceRequest, "members"> {
  members: NonNullable<CreateWorkspaceRequest["members"]>;
}

/** A one-shot text completion, injected so planning is easy to test. */
export type CompleteFn = (input: { system: string; user: string; maxTokens: number }) => Promise<string>;

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

const MAX_MEMBERS = 8;
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
      stage: "idea",
      goal: `Get ${name} to its first customers`,
      priorities: ["product"],
    },
    avatarEmoji: input.kind === "url" ? "🌐" : "🚀",
    members: [
      {
        name: "Ava (CEO)",
        emoji: "🧭",
        scheme: 0,
        title: "CEO",
        department: "exec",
        isChair: true,
        instructions: `You are the CEO of ${name}. Set direction, prioritise, delegate, and report to the human owner. Keep replies short and decisive.`,
      },
      {
        name: "Ravi (Product)",
        emoji: "📦",
        scheme: 1,
        title: "Head of Product",
        department: "product",
        instructions: `You own the product roadmap for ${name}. Turn goals into small, clear tasks and define what "done" means.`,
      },
      {
        name: "Sofia (Engineering)",
        emoji: "💻",
        scheme: 2,
        title: "CTO",
        department: "engineering",
        instructions: `You lead engineering for ${name}. Prefer simple, working solutions; explain trade-offs before building.`,
      },
      {
        name: "Milo (Growth)",
        emoji: "📈",
        scheme: 3,
        title: "Head of Growth",
        department: "growth",
        instructions: `You own growth for ${name}: positioning, channels, and experiments with measurable outcomes.`,
      },
      {
        name: "Nora (Ops)",
        emoji: "⚙️",
        scheme: 4,
        title: "Head of Operations",
        department: "ops",
        instructions: `You run operations and finance for ${name}. Track spend, deadlines, and risks; flag anything the CEO must approve.`,
      },
    ],
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
    members: resolved,
  };
}

/** Plan a company from a website or an idea; never throws (falls back to a default org). */
export async function planCompany(input: PlanInput, complete: CompleteFn): Promise<CompanyPlan> {
  const system =
    "You design small, effective company org charts. Reply with STRICT JSON only — no prose, no markdown. " +
    'Shape: {"name":string,"mission":string,"avatarEmoji":string,"members":[{"name":string,"title":string,' +
    '"department":"exec|product|engineering|growth|ops|finance|support|design","emoji":string,' +
    '"instructions":string,"isChair":boolean}]}. Create 3 to 6 employees, each with a distinct role and short ' +
    "standing instructions. Exactly one member has isChair true (the one who reports to the human CEO).";
  const user = `Company source (${input.kind}): ${input.value.slice(0, 1000)}${
    input.name ? `\nRequested name: ${input.name}` : ""
  }`;
  try {
    const text = await complete({ system, user, maxTokens: 1200 });
    return sanitizePlan(extractJson(text), input) ?? defaultCompany(input);
  } catch {
    return defaultCompany(input);
  }
}
