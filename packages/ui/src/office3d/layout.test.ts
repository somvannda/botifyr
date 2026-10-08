/**
 * Pure room/desk layout tests (no WebGL — runs in the vitest `node` env).
 */

import { describe, expect, it } from "vitest";
import { buildOfficeLayout, type LayoutAgent } from "./layout";

function agent(overrides: Partial<LayoutAgent> & Pick<LayoutAgent, "botId" | "department">): LayoutAgent {
  return {
    name: overrides.botId,
    emoji: "🤖",
    title: "Engineer",
    activity: "idle",
    ...overrides,
  };
}

describe("buildOfficeLayout", () => {
  it("always builds the amenity rooms and planters", () => {
    const layout = buildOfficeLayout([]);
    expect(layout.desks).toHaveLength(0);
    expect(layout.rooms.map((room) => room.key).sort()).toEqual([
      "gym",
      "kitchen",
      "lobby",
      "lounge",
      "meeting",
    ]);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.depth).toBeGreaterThan(0);
    expect(layout.planters.length).toBeGreaterThan(0);
    expect(layout.benches.length).toBeGreaterThanOrEqual(2);
  });

  it("puts a small team in a perimeter room with a door onto the floor", () => {
    const layout = buildOfficeLayout([agent({ botId: "a", department: "sales" })]);
    const room = layout.rooms.find((entry) => entry.department === "sales");
    expect(room).toBeDefined();
    if (!room) return;
    expect(["N", "S", "E", "W"]).toContain(room.door);
    expect(Math.abs(room.x) + room.width / 2).toBeLessThanOrEqual(layout.width / 2 + 1e-6);
    expect(Math.abs(room.z) + room.depth / 2).toBeLessThanOrEqual(layout.depth / 2 + 1e-6);
  });

  it("puts a larger team in the open plan on a bench (no room)", () => {
    const layout = buildOfficeLayout([
      agent({ botId: "a", department: "engineering" }),
      agent({ botId: "b", department: "engineering" }),
      agent({ botId: "c", department: "engineering" }),
    ]);
    expect(layout.benches.length).toBeGreaterThanOrEqual(1);
    expect(layout.benches.some((bench) => bench.key === "bench:engineering")).toBe(true);
    expect(layout.rooms.find((entry) => entry.department === "engineering")).toBeUndefined();
    expect(layout.desks).toHaveLength(3);
    expect(layout.desks.every((desk) => desk.rotation === 0 || desk.rotation === Math.PI)).toBe(true);
  });

  it("keeps every desk inside the building envelope", () => {
    const layout = buildOfficeLayout([
      agent({ botId: "a", department: "engineering" }),
      agent({ botId: "b", department: "engineering" }),
      agent({ botId: "c", department: "sales" }),
      agent({ botId: "d", department: "design" }),
    ]);
    for (const desk of layout.desks) {
      expect(Math.abs(desk.x)).toBeLessThanOrEqual(layout.width / 2);
      expect(Math.abs(desk.z)).toBeLessThanOrEqual(layout.depth / 2);
      expect(Number.isFinite(desk.x)).toBe(true);
      expect(Number.isFinite(desk.z)).toBe(true);
    }
  });
});
