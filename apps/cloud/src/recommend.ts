import {
  ROLE_CATALOG,
  type CompanyDirection,
  type Department,
  type RoleDefinition,
  type WorkPhase,
} from "@botifyr/shared";

/**
 * Recommend a company org from an idea/website and its stage (docs/company-os.md
 * §21.2, company-workspace.md §36). Deterministic: it selects catalog roles, then
 * the model tailors the JDs. The CEO always reviews before anything is created.
 */

export const ROLE_BY_ID = new Map<string, RoleDefinition>(ROLE_CATALOG.map((role) => [role.id, role]));

export type Stage = "idea" | "mvp" | "launched" | "scaling";

interface Template {
  id: string;
  keywords: string[];
  core: string[];
}

/** Vertical templates (data). First keyword match wins; `saas` is the fallback. */
const TEMPLATES: Template[] = [
  {
    id: "cloud_pos",
    keywords: ["pos", "point of sale", "retail", "restaurant", "cafe", "inventory", "merchant"],
    core: ["product.manager", "engineering.cto", "marketing.manager", "sales.manager"],
  },
  {
    id: "ecommerce",
    keywords: ["shop", "store", "ecommerce", "e-commerce", "dropship", "marketplace", "goods"],
    core: ["product.manager", "engineering.cto", "marketing.manager", "success.manager"],
  },
  {
    id: "agency",
    keywords: ["agency", "studio", "consult", "freelance", "service", "design"],
    core: ["product.manager", "marketing.manager", "sales.manager", "design.visual"],
  },
  {
    id: "ai",
    keywords: ["ai", "llm", "model", "machine learning", "generator", "agent"],
    core: ["product.manager", "ai.engineer", "engineering.cto", "marketing.manager"],
  },
  {
    id: "saas",
    keywords: ["saas", "app", "platform", "software", "tool", "dashboard", "subscription"],
    core: ["product.manager", "engineering.cto", "success.manager", "marketing.manager"],
  },
];

const FALLBACK_TEMPLATE = TEMPLATES[TEMPLATES.length - 1]!;
const MAX_TEAM = 5;

export interface Recommendation {
  template: string;
  roleIds: string[];
  rationale: string[];
}

/** The vertical template that matches `text`, or `null` when none does (no silent default). */
export function matchTemplate(text: string): Template | null {
  const lower = text.toLowerCase();
  return TEMPLATES.find((entry) => entry.keywords.some((keyword) => lower.includes(keyword))) ?? null;
}

/** Pick a team shape from the catalog for a source + stage. */
export function recommendTeam(input: { text: string; stage?: Stage }): Recommendation {
  const text = input.text.toLowerCase();
  const stage: Stage = input.stage ?? "idea";
  const template = matchTemplate(text) ?? FALLBACK_TEMPLATE;

  const early = stage === "idea" || stage === "mvp";
  const rationale = [
    `Matched the "${template.id}" blueprint.`,
    early
      ? "Early stage → a lean founding team of department leaders (they hire their own specialists later)."
      : "Existing product → a lean leadership team across product, growth and success.",
  ];

  // Hire only a few founding leaders; each leader grows their own team on demand
  // via `company.hire` as the plan requires, so we don't over-hire up front.
  const ordered = ["exec.ceo", ...template.core]
    .filter((id, index, all) => all.indexOf(id) === index)
    .filter((id) => ROLE_BY_ID.has(id))
    .slice(0, MAX_TEAM);

  return { template: template.id, roleIds: ordered, rationale };
}

/** Departments that carry a product-led direction. */
const PRODUCT_DEPARTMENTS = new Set<Department>(["product", "engineering", "ai", "design"]);
/** Fallback product team when the business type could not be classified. */
const PRODUCT_LEAD = ["product.manager", "engineering.cto", "design.ux"];
const GROWTH_LEAD = ["marketing.manager", "sales.manager", "success.manager"];
const SCALE_LEAD = ["success.manager", "data.analyst", "ops.manager"];
/** Rough token estimate per employee, for the direction card. */
const TOKENS_PER_ROLE = 150_000;

/** Dedupe + keep only role ids that exist in the catalog. */
function resolveRoles(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (ROLE_BY_ID.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export interface DirectionInput {
  text: string;
  stage?: Stage;
  /** Business label used in the thesis (e.g. "Cloud POS"). */
  industry?: string;
}

/**
 * 2–3 strategic directions for a business, ordered by fit for its stage
 * (docs/company-quests.md §3.1). Deterministic: the model tailors prose, the
 * catalog supplies the roles. Never silently defaults to a generic vertical —
 * when the business type is unclear, the product direction says so.
 */
export function directionsFor(input: DirectionInput): CompanyDirection[] {
  const stage: Stage = input.stage ?? "idea";
  const early = stage === "idea" || stage === "mvp";
  const matched = matchTemplate(input.text);
  const industry = input.industry?.trim() || "this business";

  const build = (
    id: string,
    title: string,
    thesis: string,
    objective: string,
    tradeoffs: CompanyDirection["tradeoffs"],
    roleIds: string[],
    roadmap: Array<{ phase: WorkPhase; title: string }>,
    rationale: string[],
  ): CompanyDirection => {
    const roles = resolveRoles(["exec.ceo", ...roleIds]);
    return {
      id,
      title,
      thesis,
      stage,
      objective,
      tradeoffs,
      roles,
      roadmap,
      estimatedTokens: roles.length * TOKENS_PER_ROLE,
      rationale,
    };
  };

  const classification = matched
    ? [`Matched the "${matched.id}" blueprint.`]
    : [
        `Couldn't confidently classify ${industry} from the source — this is a safe, general product team you can edit.`,
      ];

  const productCore = matched
    ? matched.core.filter((roleId) =>
        PRODUCT_DEPARTMENTS.has(ROLE_BY_ID.get(roleId)?.department as Department),
      )
    : [];
  const productRoles = productCore.length > 0 ? productCore : PRODUCT_LEAD;

  const product = build(
    "dir_product",
    early ? "Ship the MVP" : "Extend the product",
    early
      ? `Get a first usable version of ${industry} in front of real users as fast as possible.`
      : `Keep ${industry} ahead by shipping the highest-value product improvements.`,
    early ? "A working MVP in real users' hands" : "A meaningful product improvement shipped",
    { speed: 2, quality: 3, cost: 2, risk: 3 },
    productRoles,
    early
      ? [
          { phase: "mvp", title: "Define the MVP" },
          { phase: "mvp", title: "Design the core flow" },
          { phase: "mvp", title: "Build the first version" },
          { phase: "mvp", title: "Test and release" },
        ]
      : [
          { phase: "phase2", title: "Prioritise the next product bets" },
          { phase: "phase2", title: "Ship the highest-value improvement" },
          { phase: "phase2", title: "Test and release" },
        ],
    [
      ...classification,
      early
        ? "Early stage → product and engineering first; hire growth later."
        : "Existing product → deepen the product before scaling spend.",
    ],
  );

  const growth = build(
    "dir_growth",
    "Go to market",
    `Put ${industry} in front of buyers now: positioning, channels and outreach.`,
    "A repeatable pipeline and the first customers",
    { speed: 3, quality: 2, cost: 3, risk: 3 },
    GROWTH_LEAD,
    [
      { phase: "mvp", title: "Write the positioning" },
      { phase: "mvp", title: "Build the marketing site" },
      { phase: "mvp", title: "Launch outreach" },
      { phase: "phase2", title: "Set up analytics" },
    ],
    ["Growth-led: marketing, sales and success carry the quarter.", "Publishing and sending stay behind approval."],
  );

  const scale = build(
    "dir_scale",
    "Serve and scale",
    `Make ${industry} reliable and keep customers: onboarding, support and metrics.`,
    "Happy customers, stable operations, clear numbers",
    { speed: 2, quality: 4, cost: 2, risk: 1 },
    SCALE_LEAD,
    [
      { phase: "phase2", title: "Onboard the first customers" },
      { phase: "phase2", title: "Set up support" },
      { phase: "phase2", title: "Track the core metrics" },
      { phase: "phase3", title: "Harden operations" },
    ],
    ["Scale-led: success, data and operations own the quarter."],
  );

  return early ? [product, growth, scale] : [growth, product, scale];
}
