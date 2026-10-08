/**
 * Visual constants for the 3D office (docs: P1 of the virtual workspace plan).
 *
 * Everything here is plain data so the room layout stays testable without a
 * WebGL context (`layout.ts` imports only from this file).
 */

import type { Department } from "@botifyr/shared";

/** Room, corridor and furniture dimensions in metres (1 unit = 1 m). */
export const OFFICE3D = {
  /** A single-cell room. */
  roomWidth: 9,
  roomDepth: 7,
  /** The hallway between rooms (also the grid pitch gap). */
  corridor: 3.6,
  wallHeight: 2.6,
  wallThickness: 0.14,
  /** The near wall stays low so the dollhouse view isn't blocked. */
  lowWallHeight: 0.55,
  doorWidth: 2.4,
  /** Spacing between desks inside a room. */
  deskGapX: 2.4,
  deskGapZ: 2.2,
} as const;

/** Height a doorway opening reaches (the wall above it becomes a lintel). */
export const DOOR_HEIGHT = 2.0;

/** Glass partition look: tinted, semi-transparent panes inside a metal frame. */
export const GLASS = {
  color: "#bcd8ea",
  opacity: 0.2,
  roughness: 0.06,
  metalness: 0.04,
  frame: "#9fb2c4",
  frameThickness: 0.07,
} as const;

/** A soft, cartoon-leaning colour per department. */
export const DEPARTMENT_COLORS: Record<Department, string> = {
  exec: "#7c5cff",
  product: "#ff8a3d",
  engineering: "#3d9dff",
  design: "#ff5c8a",
  data: "#22c1a4",
  ai: "#a05cff",
  growth: "#39c85c",
  marketing: "#ff4d6d",
  sales: "#f4b740",
  support: "#4dd0e1",
  success: "#66bb6a",
  ops: "#8d9db6",
  finance: "#2fbf71",
  legal: "#c0a062",
  people: "#e07be0",
  logistics: "#5c8dff",
};

/** Display label per department ("ai" → "AI"). */
export const DEPARTMENT_LABELS: Record<Department, string> = {
  exec: "Executive",
  product: "Product",
  engineering: "Engineering",
  design: "Design",
  data: "Data",
  ai: "AI",
  growth: "Growth",
  marketing: "Marketing",
  sales: "Sales",
  support: "Support",
  success: "Customer Success",
  ops: "Operations",
  finance: "Finance",
  legal: "Legal",
  people: "People",
  logistics: "Logistics",
};

/**
 * Amenity rooms that always appear. `colSpan` is how many grid cells the room
 * is wide — the boardroom spans two so it is visibly the biggest room.
 */
export const AMENITIES: Array<{ key: string; label: string; color: string; colSpan: number }> = [
  { key: "meeting", label: "Boardroom", color: "#ff9f68", colSpan: 2 },
  { key: "lobby", label: "Lobby", color: "#ffcf8a", colSpan: 1 },
  { key: "gym", label: "Gym", color: "#7fe3ff", colSpan: 2 },
  { key: "lounge", label: "Lounge", color: "#c8ffb0", colSpan: 1 },
];

/** A small, readable status colour used for desk markers. */
export const ACTIVITY_COLORS: Record<string, string> = {
  running: "#39c85c",
  awaiting_approval: "#ffb020",
  queued: "#3d9dff",
  completed: "#66d1ff",
  failed: "#ff4d6d",
  cancelled: "#8d9db6",
  idle: "#5b6478",
};
