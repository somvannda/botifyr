import { describe, expect, it } from "vitest";
import { defaultCompany, planCompany, sanitizePlan } from "./company.js";

describe("company onboarding planner", () => {
  it("derives a default org with exactly one chair", () => {
    const plan = defaultCompany({ kind: "url", value: "https://www.acme.com" });
    expect(plan.name).toBe("Acme Co");
    expect(plan.members).toHaveLength(5);
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
