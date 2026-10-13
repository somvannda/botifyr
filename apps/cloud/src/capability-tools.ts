import type { CapabilityGrant, RoleDefinition } from "@botifyr/shared";
import { ROLE_CATALOG } from "@botifyr/shared";

/**
 * Role-driven authorization (docs/virtual-workspace-implementation-plan.md §0.1).
 *
 * The catalog declares what each role *is designed to do* — its default
 * capabilities. A workspace's `capability_grants` then override per employee:
 *
 *   - `granted: true`  → **add** a capability the role doesn't declare by default
 *   - `granted: false` → **remove** a capability
 *
 * This replaces the old department-string gating, so the catalog (not the
 * department label) is the source of truth and grants work in both directions.
 * Consequential capabilities stay approval-gated at run time, so an added
 * capability is never executed silently.
 */

const ROLE_BY_TITLE = new Map(ROLE_CATALOG.map((role) => [role.title.trim().toLowerCase(), role]));

/**
 * Department → the capabilities shared by *every* catalog role in it. Used as a
 * conservative baseline for a custom (non-catalog) title: a role we can't place
 * only gets what every sibling role is trusted with.
 */
const DEPARTMENT_BASELINE: Record<string, string[]> = (() => {
  const byDepartment = new Map<string, string[][]>();
  for (const role of ROLE_CATALOG) {
    const lists = byDepartment.get(role.department) ?? [];
    lists.push(role.capabilities);
    byDepartment.set(role.department, lists);
  }
  const out: Record<string, string[]> = {};
  for (const [department, lists] of byDepartment) {
    const [first, ...rest] = lists;
    if (!first) continue;
    out[department] = first.filter((capability) => rest.every((list) => list.includes(capability)));
  }
  return out;
})();

/** The minimum a company employee is trusted with when we can't place their role. */
const FALLBACK_CAPABILITIES = ["research.web", "files.read", "files.write"];

/** The fields of an employee's seat we need to resolve their capabilities. */
export interface EmployeeRole {
  title: string;
  department: string;
}

/** The catalog role an employee's seat maps to, matched by title, else null. */
export function catalogRoleFor(role: EmployeeRole): RoleDefinition | null {
  return ROLE_BY_TITLE.get(role.title.trim().toLowerCase()) ?? null;
}

/** The capabilities a role has by default (catalog), falling back to its department. */
export function defaultCapabilitiesFor(role: EmployeeRole): Set<string> {
  const catalog = catalogRoleFor(role);
  if (catalog) return new Set(catalog.capabilities);
  const baseline = DEPARTMENT_BASELINE[role.department];
  return new Set(baseline ?? FALLBACK_CAPABILITIES);
}

export interface ResolvedCapabilities {
  /** The effective capability set the employee may use. */
  allowed: Set<string>;
  /** Capabilities removed by an explicit deny/block. */
  blocked: Set<string>;
  /** Capabilities added by an explicit grant beyond the role's defaults. */
  added: Set<string>;
}

/**
 * Combine a role's default capabilities with the grants that apply to it.
 * `subjects` is the set of grant subjects matching this employee
 * (`bot:<id>` and `role:<title>`). A later deny beats an earlier add.
 */
export function resolveCapabilities(
  role: EmployeeRole,
  grants: CapabilityGrant[],
  subjects: Set<string>,
): ResolvedCapabilities {
  const allowed = defaultCapabilitiesFor(role);
  const blocked = new Set<string>();
  const added = new Set<string>();
  const mine = grants.filter((grant) => subjects.has(grant.subject));
  for (const entry of mine.filter((grant) => grant.granted)) {
    if (!allowed.has(entry.capability)) added.add(entry.capability);
    allowed.add(entry.capability);
  }
  for (const entry of mine.filter((grant) => !grant.granted)) {
    allowed.delete(entry.capability);
    blocked.add(entry.capability);
  }
  return { allowed, blocked, added };
}

/**
 * The low-level "hands" the catalog can gate per role (plan §0.1b): the browser,
 * the code sandbox, and the Library. Higher-level capabilities (social, ads,
 * email, …) are gated by the caller wiring their tools.
 */
const HAND_CAPABILITIES = new Set(["browser.use", "code.run", "files.read", "files.write"]);

/**
 * Whether a tool exercising `capability` should stay in a company employee's tool
 * set, given the capabilities it holds. Tools with no mapped capability are left
 * alone (structural tools like `company.delegate`). `research.web` implies
 * browsing, so a research role keeps the browser even without `browser.use`.
 */
export function handAllowed(capability: string | null, allowed: Set<string>): boolean {
  if (!capability || !HAND_CAPABILITIES.has(capability)) return true;
  if (allowed.has(capability)) return true;
  return capability === "browser.use" && allowed.has("research.web");
}
