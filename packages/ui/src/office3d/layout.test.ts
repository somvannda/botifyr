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
  it("always shows the amenity rooms, including a wide boardroom", () => {
    const layout = buildOfficeLayout([]);
    expect(layout.desks).toHaveLength(0);
    expect(layout.rooms.map((room) => room.key)).toEqual(["meeting", "lobby", "gym", "lounge"]);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.depth).toBeGreaterThan(0);
  });

  it("makes the boardroom span two cells (the widest room)", () => {
    const layout = buildOfficeLayout([
      agent({ botId: "a", department: "engineering" }),
      agent({ botId: "b", department: "sales" }),
    ]);
    const boardroom = layout.rooms.find((room) => room.key === "meeting");
    const widestDept = Math.max(
      ...layout.rooms.filter((room) => room.department).map((room) => room.width),
    );
    expect(boardroom).toBeDefined();
    expect(boardroom?.width).toBeGreaterThan(widestDept);
  });

  it("creates one room per department and one desk per employee", () => {
    const layout = buildOfficeLayout([
      agent({ botId: "a", department: "engineering" }),
      agent({ botId: "b", department: "engineering" }),
      agent({ botId: "c", department: "sales" }),
    ]);

    expect(layout.desks.map((desk) => desk.botId).sort()).toEqual(["a", "b", "c"]);
    const departments = layout.rooms
      .filter((room) => room.department)
      .map((room) => room.department)
      .sort();
    expect(departments).toEqual(["engineering", "sales"]);
    expect(layout.rooms.find((room) => room.department === "engineering")?.agents).toHaveLength(2);

    for (const desk of layout.desks) {
      expect(Number.isFinite(desk.x)).toBe(true);
      expect(Number.isFinite(desk.z)).toBe(true);
    }
  });

  it("leaves a corridor gap between rooms", () => {
    const layout = buildOfficeLayout([agent({ botId: "a", department: "engineering" })]);
    const room = layout.rooms.find((entry) => entry.department === "engineering");
    expect(room).toBeDefined();
    if (!room) return;
    // The building is wider than the sum of its rooms because of the corridors.
    expect(layout.width).toBeGreaterThan(room.width);
  });

  it("keeps every desk inside its own room", () => {
    const layout = buildOfficeLayout(
      Array.from({ length: 7 }, (_, index) => agent({ botId: `b${index}`, department: "product" })),
    );
    const room = layout.rooms.find((entry) => entry.department === "product");
    expect(room).toBeDefined();
    if (!room) return;

    for (const desk of layout.desks) {
      const relX = Math.abs(desk.x - room.x);
      const relZ = Math.abs(desk.z - room.z);
      expect(relX).toBeLessThanOrEqual(room.width / 2 + 1e-6);
      expect(relZ).toBeLessThanOrEqual(room.depth / 2 + 1e-6);
    }
  });
});
