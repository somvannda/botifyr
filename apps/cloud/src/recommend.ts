import { ROLE_CATALOG, type RoleDefinition } from "@botifyr/shared";

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

/** Pick a team shape from the catalog for a source + stage. */
export function recommendTeam(input: { text: string; stage?: Stage }): Recommendation {
  const text = input.text.toLowerCase();
  const stage: Stage = input.stage ?? "idea";
  const template =
    TEMPLATES.find((entry) => entry.keywords.some((keyword) => text.includes(keyword))) ??
    FALLBACK_TEMPLATE;

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
