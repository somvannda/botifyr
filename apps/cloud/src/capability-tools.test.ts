import { describe, expect, it } from "vitest";
import type { CapabilityGrant } from "@botifyr/shared";
import {
  catalogRoleFor,
  defaultCapabilitiesFor,
  resolveCapabilities,
} from "./capability-tools.js";

/** Build a grant for a subject. */
function grant(
  capability: string,
  extra: Partial<CapabilityGrant> = {},
): CapabilityGrant {
  return {
    workspaceId: "ws",
    subject: "bot:b1",
    capability,
    granted: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("capability-tools", () => {
  it("maps a seat to its catalog role by title (case-insensitive)", () => {
    expect(catalogRoleFor({ title: "Social Media Manager", department: "marketing" })?.id).toBe(
      "marketing.social",
    );
    expect(catalogRoleFor({ title: "  cto  ", department: "engineering" })?.id).toBe("engineering.cto");
  });

  it("returns null for a title that isn't in the catalog", () => {
    expect(catalogRoleFor({ title: "Chief Vibes Officer", department: "marketing" })).toBeNull();
  });

  it("uses the catalog capabilities for a known role", () => {
    const caps = defaultCapabilitiesFor({ title: "Social Media Manager", department: "marketing" });
    expect(caps.has("social.publish")).toBe(true);
    expect(caps.has("social.reply")).toBe(true);
    expect(caps.has("email.send")).toBe(false);
  });

  it("falls back to the department baseline for a custom title", () => {
    // Every engineering role shares code.run + files.*; no role-specific extras leak in.
    const caps = defaultCapabilitiesFor({ title: "Chief Vibes Officer", department: "engineering" });
    expect(caps.has("code.run")).toBe(true);
    expect(caps.has("files.write")).toBe(true);
    expect(caps.has("deploy.production")).toBe(false);
    expect(caps.has("repo.write")).toBe(false);
  });

  it("removes a denied capability and records it as blocked", () => {
    const role = { title: "Social Media Manager", department: "marketing" };
    const subjects = new Set(["bot:b1"]);
    const resolved = resolveCapabilities(role, [grant("social.publish", { granted: false })], subjects);
    expect(resolved.allowed.has("social.publish")).toBe(false);
    expect(resolved.blocked.has("social.publish")).toBe(true);
  });

  it("removes a capability the owner denied (granted=false)", () => {
    const role = { title: "Social Media Manager", department: "marketing" };
    const resolved = resolveCapabilities(role, [grant("social.reply", { granted: false })], new Set(["bot:b1"]));
    expect(resolved.allowed.has("social.reply")).toBe(false);
  });

  it("adds a capability granted beyond the role's defaults (the old subtract-only hole)", () => {
    const role = { title: "Social Media Manager", department: "marketing" };
    const resolved = resolveCapabilities(role, [grant("ads.manage")], new Set(["bot:b1"]));
    expect(resolved.allowed.has("ads.manage")).toBe(true);
    expect(resolved.added.has("ads.manage")).toBe(true);
  });

  it("ignores grants that don't match the employee's subjects", () => {
    const role = { title: "Social Media Manager", department: "marketing" };
    const resolved = resolveCapabilities(role, [grant("social.publish", { subject: "bot:other" })], new Set(["bot:b1"]));
    expect(resolved.allowed.has("social.publish")).toBe(true);
  });

  it("lets a later deny beat an earlier add", () => {
    const role = { title: "Content Manager", department: "marketing" };
    const subjects = new Set(["bot:b1"]);
    const resolved = resolveCapabilities(
      role,
      [grant("email.send"), grant("email.send", { granted: false })],
      subjects,
    );
    expect(resolved.allowed.has("email.send")).toBe(false);
    expect(resolved.blocked.has("email.send")).toBe(true);
  });

  it("keeps the catalog honest: the roles we rely on declare their hands", () => {
    // Guards the data the runner's capability gating depends on.
    expect(defaultCapabilitiesFor({ title: "Head of Marketing", department: "marketing" }).has("ads.manage")).toBe(true);
    expect(defaultCapabilitiesFor({ title: "Visual Designer", department: "design" }).has("design.create")).toBe(true);
    expect(defaultCapabilitiesFor({ title: "Support Agent", department: "support" }).has("social.reply")).toBe(true);
  });

  it("reaches Botifyr's Feed (an owned channel) from social capabilities", () => {
    // 0.2: the Feed is gated by social capabilities, so a brand-new company can
    // publish with no external account. Roles with a social capability get the
    // matching feed tools; roles without one don't.
    const social = (title: string, department: string): boolean =>
      ["social.read_insights", "social.publish", "social.reply"].some((capability) =>
        defaultCapabilitiesFor({ title, department }).has(capability),
      );
    expect(social("Head of Marketing", "marketing")).toBe(true);
    expect(social("Social Media Manager", "marketing")).toBe(true);
    expect(social("Support Agent", "support")).toBe(true);
    expect(social("Finance Analyst", "finance")).toBe(false);
  });
});
