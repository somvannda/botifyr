/**
 * Pure floor-plan layout for the 3D office.
 *
 * The plan matches a real (and the reference) office: ONE building envelope with
 * private rooms built around the perimeter (sharing walls), and a large open
 * middle for open-plan bench desks and planters. Small teams get a room; larger
 * teams sit in the open plan.
 *
 * No three.js here on purpose, so the vitest `node` environment can test it.
 */

import type { Department, TaskStatus } from "@botifyr/shared";
import { DEPARTMENTS } from "@botifyr/shared";
import { ACTIVITY_COLORS, DEPARTMENT_COLORS, DEPARTMENT_LABELS } from "./theme";

export type AgentActivity = "idle" | TaskStatus;
export type WallSide = "N" | "S" | "E" | "W";

export interface LayoutAgent {
  botId: string;
  name: string;
  emoji: string;
  title: string;
  department: Department;
  activity: AgentActivity;
}

export interface RoomLayout {
  key: string;
  kind: string;
  label: string;
  department: Department | null;
  color: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  glazed: boolean;
  /** Which wall has the door onto the open floor (the others are closed). */
  door: WallSide;
  agents: LayoutAgent[];
}

export interface DeskLayout {
  botId: string;
  x: number;
  z: number;
  rotation: number;
  agent: LayoutAgent;
}

export interface BenchLayout {
  key: string;
  x: number;
  z: number;
  width: number;
  color: string;
}

export interface PlanterLayout {
  x: number;
  z: number;
}

export interface OfficeLayout {
  rooms: RoomLayout[];
  desks: DeskLayout[];
  benches: BenchLayout[];
  planters: PlanterLayout[];
  /** Ping-pong / game tables in the open area. */
  gameTables: Array<{ x: number; z: number }>;
  /** Building envelope. */
  width: number;
  depth: number;
}

/** Building size and the depth of the perimeter room band. */
const BUILDING_WIDTH = 64;
const BUILDING_DEPTH = 44;
const BAND = 11;
/** Departments with at least this many employees sit in the open plan. */
const OPEN_PLAN_MIN = 2;

/** Amenity rooms always built around the perimeter. */
const AMENITY_ROOMS: Array<{ key: string; label: string; color: string }> = [
  { key: "meeting", label: "Boardroom", color: "#ff9f68" },
  { key: "lobby", label: "Reception", color: "#ffcf8a" },
  { key: "kitchen", label: "Kitchen", color: "#ffd08a" },
  { key: "lounge", label: "Lounge", color: "#c8ffb0" },
  { key: "gym", label: "Gym", color: "#7fe3ff" },
];

/** Enclosed (solid-walled) rooms rather than glass. */
const PRIVATE_DEPARTMENTS = new Set<Department>(["exec", "finance", "legal", "people"]);

export function activityColor(activity: AgentActivity): string {
  return ACTIVITY_COLORS[activity] ?? ACTIVITY_COLORS.idle;
}

/** Lay desks out inside a room, centred and clamped to the room bounds. */
function deskSlots(room: RoomLayout): DeskLayout[] {
  const count = room.agents.length;
  if (count === 0) return [];
  const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.ceil(count / cols);
  const gapX = cols > 1 ? Math.min(2.6, (room.width - 2.2) / (cols - 1)) : 0;
  const gapZ = rows > 1 ? Math.min(2.2, (room.depth - 2.4) / (rows - 1)) : 0;
  const startX = -((cols - 1) * gapX) / 2;
  const startZ = -((rows - 1) * gapZ) / 2;

  return Array.from({ length: count }, (_, index) => {
    const agent = room.agents[index];
    return {
      botId: agent.botId,
      x: room.x + startX + (index % cols) * gapX,
      z: room.z + startZ + Math.floor(index / cols) * gapZ,
      rotation: 0,
      agent,
    };
  });
}

interface RoomSpec {
  key: string;
  kind: string;
  label: string;
  department: Department | null;
  color: string;
  glazed: boolean;
  agents: LayoutAgent[];
}

/**
 * Build the office: a building envelope with rooms around the four sides (small
 * teams + amenities) and open-plan benches in the middle for larger teams.
 */
export function buildOfficeLayout(agents: LayoutAgent[]): OfficeLayout {
  const grouped = new Map<Department, LayoutAgent[]>();
  for (const agent of agents) {
    const list = grouped.get(agent.department);
    if (list) list.push(agent);
    else grouped.set(agent.department, [agent]);
  }

  const departmentKeys: Department[] = [];
  for (const department of DEPARTMENTS) {
    if (grouped.has(department)) departmentKeys.push(department);
  }
  for (const department of grouped.keys()) {
    if (!departmentKeys.includes(department)) departmentKeys.push(department);
  }

  const privateSpecs: RoomSpec[] = [];
  const openPlanDepts: Department[] = [];
  for (const department of departmentKeys) {
    const members = grouped.get(department) ?? [];
    if (members.length >= OPEN_PLAN_MIN) {
      openPlanDepts.push(department);
      continue;
    }
    privateSpecs.push({
      key: `dept:${department}`,
      kind: "dept",
      label: DEPARTMENT_LABELS[department] ?? department,
      department,
      color: DEPARTMENT_COLORS[department] ?? "#8d9db6",
      glazed: !PRIVATE_DEPARTMENTS.has(department),
      agents: members,
    });
  }

  for (const amenity of AMENITY_ROOMS) {
    privateSpecs.push({
      key: amenity.key,
      kind: amenity.key,
      label: amenity.label,
      department: null,
      color: amenity.color,
      glazed: amenity.key !== "meeting",
      agents: [],
    });
  }

  const coreWidth = BUILDING_WIDTH - 2 * BAND;
  const coreDepth = BUILDING_DEPTH - 2 * BAND;

  // Rooms fill the back and both sides (corners included) so there are no empty
  // corner cells; the FRONT stays open as the entrance / open space.
  const sides: WallSide[] = ["N", "E", "W"];
  const groups: RoomSpec[][] = [[], [], []];
  privateSpecs.forEach((spec, index) => groups[index % sides.length].push(spec));

  const rooms: RoomLayout[] = [];
  groups.forEach((group, sideIndex) => {
    const side = sides[sideIndex];
    const count = group.length;
    if (count === 0) return;

    if (side === "N") {
      const size = BUILDING_WIDTH / count;
      group.forEach((spec, index) => {
        rooms.push({
          key: spec.key,
          kind: spec.kind,
          label: spec.label,
          department: spec.department,
          color: spec.color,
          x: -BUILDING_WIDTH / 2 + (index + 0.5) * size,
          z: -BUILDING_DEPTH / 2 + BAND / 2,
          width: size,
          depth: BAND,
          glazed: spec.glazed,
          door: "S",
          agents: spec.agents,
        });
      });
      return;
    }

    const size = (BUILDING_DEPTH - BAND) / count;
    const x = side === "W" ? -BUILDING_WIDTH / 2 + BAND / 2 : BUILDING_WIDTH / 2 - BAND / 2;
    group.forEach((spec, index) => {
      rooms.push({
        key: spec.key,
        kind: spec.kind,
        label: spec.label,
        department: spec.department,
        color: spec.color,
        x,
        z: -BUILDING_DEPTH / 2 + BAND + (index + 0.5) * size,
        width: BAND,
        depth: size,
        glazed: spec.glazed,
        door: side === "W" ? "E" : "W",
        agents: spec.agents,
      });
    });
  });

  // Open plan: one long bench per large department, plus spare benches so the
  // middle always reads like a real open-plan floor even with small teams.
  const MIN_BENCHES = 2;
  const agentBenchCount = openPlanDepts.length;
  const benchCount = Math.max(agentBenchCount, MIN_BENCHES);
  const benches: BenchLayout[] = [];
  const openDesks: DeskLayout[] = [];
  const gap = 5;
  const width = Math.min(18, (coreWidth - gap * (benchCount + 1)) / benchCount);
  const startX = -((benchCount - 1) * (width + gap)) / 2;
  const benchX = (index: number): number => startX + index * (width + gap);

  openPlanDepts.forEach((department, index) => {
    const members = grouped.get(department) ?? [];
    benches.push({
      key: `bench:${department}`,
      x: benchX(index),
      z: 0,
      width,
      color: DEPARTMENT_COLORS[department] ?? "#8d9db6",
    });
    const cols = Math.max(1, Math.ceil(members.length / 2));
    const step = width / (cols + 1);
    members.forEach((agent, memberIndex) => {
      const row = Math.floor(memberIndex / cols);
      const col = memberIndex % cols;
      const side = row % 2 === 0 ? 1 : -1;
      openDesks.push({
        botId: agent.botId,
        x: benchX(index) - width / 2 + step * (col + 1),
        z: side * 1.15,
        rotation: side > 0 ? 0 : Math.PI,
        agent,
      });
    });
  });
  for (let index = agentBenchCount; index < benchCount; index += 1) {
    benches.push({ key: `bench:spare:${index}`, x: benchX(index), z: 0, width, color: "#c9ccd4" });
  }

  const planters: PlanterLayout[] = [
    { x: -coreWidth / 2 + 4, z: -coreDepth / 2 + 3 },
    { x: coreWidth / 2 - 4, z: -coreDepth / 2 + 3 },
    { x: -10, z: BUILDING_DEPTH / 2 - 3.5 },
    { x: 10, z: BUILDING_DEPTH / 2 - 3.5 },
  ];

  // Recreation: ping-pong tables in the open front area.
  const gameTables = [
    { x: -15, z: BUILDING_DEPTH / 2 - 6 },
    { x: 15, z: BUILDING_DEPTH / 2 - 6 },
  ];

  const desks = [...rooms.flatMap(deskSlots), ...openDesks];

  return {
    rooms,
    desks,
    benches,
    planters,
    gameTables,
    width: BUILDING_WIDTH,
    depth: BUILDING_DEPTH,
  };
}
