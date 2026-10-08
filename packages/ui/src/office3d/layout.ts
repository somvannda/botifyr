/**
 * Pure room/desk layout for the 3D office (P1).
 *
 * No three.js here on purpose: this module is plain TypeScript so the vitest
 * `node` environment can test it without a WebGL context. `OfficeScene.tsx`
 * renders whatever this returns.
 *
 * The floor plan packs rooms into rows of `CELLS_PER_ROW` cells with a uniform
 * corridor gap between every room (so the halls all connect), and gives each
 * amenity room a `colSpan` — the boardroom spans two cells so it is visibly the
 * biggest room.
 */

import type { Department, TaskStatus } from "@botifyr/shared";
import { DEPARTMENTS } from "@botifyr/shared";
import {
  ACTIVITY_COLORS,
  AMENITIES,
  DEPARTMENT_COLORS,
  DEPARTMENT_LABELS,
  OFFICE3D,
} from "./theme";

/** What an employee is doing right now, derived from their latest task. */
export type AgentActivity = "idle" | TaskStatus;

export interface LayoutAgent {
  botId: string;
  name: string;
  emoji: string;
  /** Role title, e.g. "CTO". */
  title: string;
  department: Department;
  activity: AgentActivity;
}

export interface RoomLayout {
  key: string;
  /** "dept" | "meeting" | "lobby" | "gym" | "lounge" — drives room furniture. */
  kind: string;
  label: string;
  /** `null` for shared amenity rooms (boardroom, lobby, gym, lounge). */
  department: Department | null;
  color: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  /** True for glass partitions; enclosed rooms (boardroom, exec, legal…) are solid. */
  glazed: boolean;
  agents: LayoutAgent[];
}

export interface DeskLayout {
  botId: string;
  x: number;
  z: number;
  agent: LayoutAgent;
}

export interface OfficeLayout {
  rooms: RoomLayout[];
  desks: DeskLayout[];
  /** Overall building extents, used to frame the camera and draw the corridor. */
  width: number;
  depth: number;
}

/** How many grid cells wide a row of rooms is. */
const CELLS_PER_ROW = 4;

/** Departments whose rooms are enclosed (solid walls) rather than glass. */
const PRIVATE_DEPARTMENTS = new Set<Department>(["exec", "finance", "legal", "people"]);

/** Status marker colour for a desk. */
export function activityColor(activity: AgentActivity): string {
  return ACTIVITY_COLORS[activity] ?? ACTIVITY_COLORS.idle;
}

interface RoomSpec {
  key: string;
  kind: string;
  label: string;
  department: Department | null;
  color: string;
  colSpan: number;
  agents: LayoutAgent[];
}

/** Lay desks out inside a room, centred and clamped to the room bounds. */
function deskSlots(room: RoomLayout): DeskLayout[] {
  const count = room.agents.length;
  if (count === 0) return [];

  const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.ceil(count / cols);
  const maxX = room.width - 2.2;
  const maxZ = room.depth - 2.2;
  const gapX = cols > 1 ? Math.min(OFFICE3D.deskGapX, maxX / (cols - 1)) : 0;
  const gapZ = rows > 1 ? Math.min(OFFICE3D.deskGapZ, maxZ / (rows - 1)) : 0;
  const startX = -((cols - 1) * gapX) / 2;
  const startZ = -((rows - 1) * gapZ) / 2;

  const desks: DeskLayout[] = [];
  for (let index = 0; index < count; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const agent = room.agents[index];
    desks.push({
      botId: agent.botId,
      x: room.x + startX + col * gapX,
      z: room.z + startZ + row * gapZ,
      agent,
    });
  }
  return desks;
}

/**
 * Build the office: one room per occupied department (ordered by the catalog),
 * plus the fixed amenity rooms, packed into rows with corridors between them.
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

  const specs: RoomSpec[] = [
    ...departmentKeys.map((department) => ({
      key: `dept:${department}`,
      kind: "dept",
      label: DEPARTMENT_LABELS[department] ?? department,
      department,
      color: DEPARTMENT_COLORS[department] ?? "#8d9db6",
      colSpan: 1,
      agents: grouped.get(department) ?? [],
    })),
    ...AMENITIES.map((amenity) => ({
      key: amenity.key,
      kind: amenity.key,
      label: amenity.label,
      department: null,
      color: amenity.color,
      colSpan: amenity.colSpan,
      agents: [] as LayoutAgent[],
    })),
  ];

  // Pack rooms left-to-right into rows; a room that doesn't fit starts a new row.
  const rows: Array<Array<{ spec: RoomSpec; startCol: number }>> = [];
  let current: Array<{ spec: RoomSpec; startCol: number }> = [];
  let used = 0;
  for (const spec of specs) {
    if (used + spec.colSpan > CELLS_PER_ROW) {
      rows.push(current);
      current = [];
      used = 0;
    }
    current.push({ spec, startCol: used });
    used += spec.colSpan;
  }
  if (current.length) rows.push(current);

  const pitch = OFFICE3D.roomWidth + OFFICE3D.corridor;
  const pitchZ = OFFICE3D.roomDepth + OFFICE3D.corridor;
  const gridWidth = CELLS_PER_ROW * pitch - OFFICE3D.corridor;
  const gridDepth = rows.length * pitchZ - OFFICE3D.corridor;
  const left = -gridWidth / 2;
  const top = -gridDepth / 2;

  const rooms: RoomLayout[] = [];
  rows.forEach((rowItems, rowIndex) => {
    for (const { spec, startCol } of rowItems) {
      const width = spec.colSpan * pitch - OFFICE3D.corridor;
      rooms.push({
        key: spec.key,
        kind: spec.kind,
        label: spec.label,
        department: spec.department,
        color: spec.color,
        x: left + startCol * pitch + width / 2,
        z: top + rowIndex * pitchZ + OFFICE3D.roomDepth / 2,
        width,
        depth: OFFICE3D.roomDepth,
        glazed:
          spec.kind !== "meeting" &&
          !(spec.department !== null && PRIVATE_DEPARTMENTS.has(spec.department)),
        agents: spec.agents,
      });
    }
  });

  const desks = rooms.flatMap(deskSlots);

  return { rooms, desks, width: gridWidth, depth: gridDepth };
}
