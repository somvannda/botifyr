import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CATALOG_SKILLS,
  DEPARTMENTS,
  ROLE_CATALOG,
  type CapabilityDef,
  type Department,
} from "./index.js";

/** The catalog is data the generator selects from — keep it internally consistent. */
describe("capability catalog", () => {
  const departments = new Set<string>(DEPARTMENTS);
  const capabilities = new Map<string, CapabilityDef>(CAPABILITIES.map((c) => [c.id, c]));
  const skills = new Set<string>(CATALOG_SKILLS.map((s) => s.id));
  const roleIds = new Set<string>(ROLE_CATALOG.map((r) => r.id));

  it("has the 16 departments and no duplicates", () => {
    expect(DEPARTMENTS).toHaveLength(16);
    expect(departments.size).toBe(DEPARTMENTS.length);
  });

  it("has unique role ids and capability ids", () => {
    expect(roleIds.size).toBe(ROLE_CATALOG.length);
    expect(new Set(CAPABILITIES.map((c) => c.id)).size).toBe(CAPABILITIES.length);
  });

  it("every role uses valid departments, skills, capabilities and managers", () => {
    for (const role of ROLE_CATALOG) {
      expect(departments.has(role.department), `${role.id} department`).toBe(true);
      for (const skill of role.skills) {
        expect(skills.has(skill), `${role.id} skill ${skill}`).toBe(true);
      }
      for (const capability of role.capabilities) {
        expect(capabilities.has(capability), `${role.id} capability ${capability}`).toBe(true);
      }
      if (role.reportsTo) {
        expect(roleIds.has(role.reportsTo), `${role.id} reportsTo ${role.reportsTo}`).toBe(true);
      }
    }
  });

  it("has exactly one exec chair (the CEO) and no other exec role without a parent", () => {
    const execs = ROLE_CATALOG.filter((role) => role.department === "exec");
    expect(execs.map((role) => role.id)).toEqual(["exec.ceo"]);
    expect(execs[0]?.reportsTo).toBeUndefined();
  });

  it("only tags real risk levels", () => {
    for (const capability of CAPABILITIES) {
      expect(["none", "consequential", "money"]).toContain(capability.risk);
    }
  });

  it("keeps every department type-safe", () => {
    const typed: Department[] = DEPARTMENTS;
    expect(typed).toBe(DEPARTMENTS);
  });
});
