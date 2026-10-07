import { describe, expect, it } from "vitest";
import {
  analyzeSource,
  defaultCompany,
  isBudgetExhausted,
  planCompany,
  sanitizeDNA,
  sanitizePlan,
  shouldRunSchedule,
  withinOperatingHours,
} from "./company.js";

describe("company onboarding planner", () => {
  it("derives a default org with exactly one chair", () => {
    const plan = defaultCompany({ kind: "url", value: "https://www.acme.com" });
    expect(plan.name).toBe("Acme Co");
    expect(plan.members.length).toBeGreaterThanOrEqual(4);
    expect(plan.members.length).toBeLessThanOrEqual(8);
    expect(plan.members.filter((member) => member.isChair)).toHaveLength(1);
    expect(plan.members[0]?.department).toBe("exec");
    expect(plan.source).toEqual({ kind: "url", value: "https://www.acme.com" });
  });

  it("sanitises a model org chart, clamping size and bad fields", () => {
    const plan = sanitizePlan(
      {
        name: "Nimbus",
        mission: "Weather for drones",
        members: [
          { name: "A", title: "CEO", department: "exec", isChair: true },
          { name: "B", department: "nonsense" },
          { name: "   " },
          ...Array.from({ length: 10 }, (_, index) => ({ name: `E${index}`, title: "T" })),
        ],
      },
      { kind: "idea", value: "weather drones" },
    );
    expect(plan?.name).toBe("Nimbus");
    expect(plan?.members.length).toBeLessThanOrEqual(8);
    expect(plan?.members.filter((member) => member.isChair)).toHaveLength(1);
    expect(plan?.members[1]?.title).toBe("Member");
    expect(plan?.members[1]?.department).toBe("ops");
  });

  it("rejects a plan with no usable members", () => {
    expect(sanitizePlan({ members: [{ name: "  " }] }, { kind: "idea", value: "x" })).toBeNull();
    expect(sanitizePlan(null, { kind: "idea", value: "x" })).toBeNull();
  });

  it("forces a chair when the model omits one", () => {
    const plan = sanitizePlan(
      { members: [{ name: "Solo", title: "Founder" }, { name: "Two" }] },
      { kind: "idea", value: "x" },
    );
    expect(plan?.members[0]?.isChair).toBe(true);
    expect(plan?.members[1]?.isChair).toBeFalsy();
  });

  it("uses valid model JSON and falls back to a default org on failure", async () => {
    const good = await planCompany({ kind: "idea", value: "coffee subscription" }, async () =>
      JSON.stringify({ name: "Bean Co", members: [{ name: "Ro", title: "CEO", isChair: true }] }),
    );
    expect(good.name).toBe("Bean Co");

    const failed = await planCompany({ kind: "idea", value: "coffee subscription" }, async () => {
      throw new Error("no key");
    });
    expect(failed.members.length).toBeGreaterThan(0);
    expect(failed.name.length).toBeGreaterThan(0);
    expect(failed.members.filter((member) => member.isChair)).toHaveLength(1);
  });
});

describe("analyzeSource", () => {
  it("sanitises a model DNA and clamps bad fields", () => {
    const fallback = defaultCompany({ kind: "idea", value: "x" }).dna!;
    const dna = sanitizeDNA(
      {
        industry: "Cloud POS",
        stage: "nonsense",
        product: { features: ["POS", 42, "inventory"] },
        targetMarket: [],
      },
      fallback,
    );
    expect(dna.industry).toBe("Cloud POS");
    expect(dna.stage).toBe(fallback.stage);
    expect(dna.product.features).toEqual(["POS", "inventory"]);
    expect(dna.targetMarket).toEqual(fallback.targetMarket);
  });

  it("reads a website via the injected fetch and uses the model", async () => {
    const { dna, notes } = await analyzeSource(
      { kind: "url", value: "https://acme.com" },
      {
        fetchText: async () => "<title>Acme POS</title><h1>Cloud POS for restaurants</h1>",
        complete: async () =>
          JSON.stringify({ industry: "Cloud POS", stage: "launched", product: { features: ["POS"] } }),
      },
    );
    expect(notes).toContain("Read the website.");
    expect(dna.industry).toBe("Cloud POS");
    expect(dna.stage).toBe("launched");
  });

  it("falls back when the page can't be read and the model fails", async () => {
    const { dna, notes } = await analyzeSource(
      { kind: "url", value: "https://acme.com" },
      {
        fetchText: async () => {
          throw new Error("blocked");
        },
        complete: async () => {
          throw new Error("no key");
        },
      },
    );
    expect(notes).toContain("Could not read the website; used the URL only.");
    expect(dna.industry.length).toBeGreaterThan(0);
  });
});

describe("isBudgetExhausted", () => {
  const base = { workspaceId: "w", updatedAt: "now" };
  it("only trips when a limit is set and used is at least the limit", () => {
    expect(isBudgetExhausted(null)).toBe(false);
    expect(isBudgetExhausted({ ...base, limitTokens: 0, usedTokens: 999 })).toBe(false);
    expect(isBudgetExhausted({ ...base, limitTokens: 100, usedTokens: 50 })).toBe(false);
    expect(isBudgetExhausted({ ...base, limitTokens: 100, usedTokens: 100 })).toBe(true);
    expect(isBudgetExhausted({ ...base, limitTokens: 100, usedTokens: 150 })).toBe(true);
  });
});

describe("shouldRunSchedule", () => {
  it("stops schedules for paused or archived companies", () => {
    expect(shouldRunSchedule("active")).toBe(true);
    expect(shouldRunSchedule("onboarding")).toBe(true);
    expect(shouldRunSchedule(undefined)).toBe(true);
    expect(shouldRunSchedule("paused")).toBe(false);
    expect(shouldRunSchedule("archived")).toBe(false);
  });
});

describe("withinOperatingHours", () => {
  it("allows everything when no hours are set", () => {
    expect(withinOperatingHours(undefined, new Date("2026-01-05T03:00:00Z"))).toBe(true);
  });

  it("respects the window (UTC)", () => {
    const hours = { start: 9, end: 18 };
    expect(withinOperatingHours(hours, new Date("2026-01-05T08:00:00Z"))).toBe(false);
    expect(withinOperatingHours(hours, new Date("2026-01-05T10:00:00Z"))).toBe(true);
    expect(withinOperatingHours(hours, new Date("2026-01-05T18:00:00Z"))).toBe(false);
  });

  it("respects the days", () => {
    const weekdays = { days: [1, 2, 3, 4, 5], start: 0, end: 24 };
    expect(withinOperatingHours(weekdays, new Date("2026-01-04T12:00:00Z"))).toBe(false); // Sunday
    expect(withinOperatingHours(weekdays, new Date("2026-01-05T12:00:00Z"))).toBe(true); // Monday
  });

  it("respects the timezone", () => {
    // Asia/Phnom_Penh is UTC+7. 03:00Z = 10:00 local (inside 9–18); 16:00Z = 23:00 (outside).
    const hours = { start: 9, end: 18, timezone: "Asia/Phnom_Penh" };
    expect(withinOperatingHours(hours, new Date("2026-01-05T03:00:00Z"))).toBe(true);
    expect(withinOperatingHours(hours, new Date("2026-01-05T16:00:00Z"))).toBe(false);
  });
});
