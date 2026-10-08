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

/** A muted (pastel) version of an accent colour, for rugs and soft surfaces. */
export function tint(hex: string, amount = 0.7): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * amount);
  return `#${[mix(r), mix(g), mix(b)]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** A modern-office material palette: floors, halls, walls and trim. */
export const PALETTE = {
  floor: "#e4d7bd", // light oak laminate
  rug: "#e9edf3",
  corridor: "#c9ccd4", // pale stone / terrazzo
  corridorRunner: "#b6bcc8",
  wall: "#f1f3f8", // off-white partition
  wallSolid: "#eaeef6",
  trim: "#aeb6c2",
  baseboard: "#c6ccd6",
  artFrame: "#3a4152",
} as const;

/* -------------------------------------------------------------------------- */
/* Office design styles — palette + lighting + camera per art direction       */
/* -------------------------------------------------------------------------- */

export type OfficeStyleId =
  | "iso"
  | "nordic"
  | "tech"
  | "cartoon"
  | "blueprint"
  | "neon"
  | "comic"
  | "mono";

/** Blend a hex colour toward white or black. */
export function mix(hex: string, target: "#ffffff" | "#000000", amount: number): string {
  const value = hex.replace("#", "");
  const to = target === "#ffffff" ? 255 : 0;
  const channel = (index: number): number => {
    const c = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    return Math.round(c + (to - c) * amount);
  };
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

export interface OfficeStyle {
  id: OfficeStyleId;
  label: string;
  background: string;
  fog: boolean;
  floor: string;
  rug: { target: "#ffffff" | "#000000"; amount: number };
  corridor: string;
  corridorRunner: string;
  wallSolid: string;
  accent: { target: "#ffffff" | "#000000"; amount: number };
  frame: string;
  glass: { color: string; opacity: number };
  desk: string;
  monitor: { color: string; emissive: number };
  lights: {
    ambient: number;
    hemi: [string, string, number];
    key: [string, number];
    fill: [string, number];
  };
  camera: { fov: number; lift: number; pull: number };
  /** Architectural top-down view uses an orthographic camera. */
  projection?: "perspective" | "orthographic";
  /** Optional glowing grid over the corridor (blueprint / neon looks). */
  grid?: string;
  /** Emissive intensity for the wall frames. */
  frameEmissive?: number;
}

export const OFFICE_STYLES: Record<OfficeStyleId, OfficeStyle> = {
  iso: {
    id: "iso",
    label: "Bright isometric toy",
    background: "#eaf1fb",
    fog: false,
    floor: "#f2f4f8",
    rug: { target: "#ffffff", amount: 0.55 },
    corridor: "#dbe2ec",
    corridorRunner: "#c8d1de",
    wallSolid: "#ffffff",
    accent: { target: "#ffffff", amount: 0.18 },
    frame: "#a7b4c6",
    glass: { color: "#cfe6f7", opacity: 0.3 },
    desk: "#f3ead8",
    monitor: { color: "#2b3242", emissive: 0 },
    lights: {
      ambient: 0.8,
      hemi: ["#ffffff", "#dbe4f0", 0.9],
      key: ["#ffffff", 1.0],
      fill: ["#dfe9ff", 0.35],
    },
    camera: { fov: 30, lift: 1.0, pull: 1.5 },
  },
  nordic: {
    id: "nordic",
    label: "Nordic / biophilic",
    background: "#eef1ec",
    fog: false,
    floor: "#ddc9a4",
    rug: { target: "#ffffff", amount: 0.68 },
    corridor: "#d9dde3",
    corridorRunner: "#c6ccd4",
    wallSolid: "#f7f5f0",
    accent: { target: "#ffffff", amount: 0.3 },
    frame: "#a9a291",
    glass: { color: "#c9dbe6", opacity: 0.22 },
    desk: "#ead9b8",
    monitor: { color: "#2b3242", emissive: 0 },
    lights: {
      ambient: 0.5,
      hemi: ["#fff7e8", "#c9c2b2", 0.8],
      key: ["#ffe9c9", 1.0],
      fill: ["#dbe8d5", 0.3],
    },
    camera: { fov: 40, lift: 0.85, pull: 0.9 },
  },
  tech: {
    id: "tech",
    label: "Dark tech HQ",
    background: "#080b12",
    fog: true,
    floor: "#151b28",
    rug: { target: "#000000", amount: 0.25 },
    corridor: "#0f141d",
    corridorRunner: "#1a2334",
    wallSolid: "#1b2331",
    accent: { target: "#000000", amount: 0.45 },
    frame: "#2c3849",
    glass: { color: "#7fb2d9", opacity: 0.16 },
    desk: "#232b3a",
    monitor: { color: "#7fe3ff", emissive: 1.2 },
    lights: {
      ambient: 0.22,
      hemi: ["#25324a", "#05070b", 0.5],
      key: ["#9fc4ff", 1.2],
      fill: ["#7a5cff", 0.55],
    },
    camera: { fov: 42, lift: 0.8, pull: 0.9 },
  },
  cartoon: {
    id: "cartoon",
    label: "Pixar-ish cartoon",
    background: "#bfe3ff",
    fog: false,
    floor: "#f5e4c2",
    rug: { target: "#ffffff", amount: 0.5 },
    corridor: "#e9dcc4",
    corridorRunner: "#dbc9a8",
    wallSolid: "#fff7ea",
    accent: { target: "#ffffff", amount: 0.1 },
    frame: "#6f5c48",
    glass: { color: "#cfeaff", opacity: 0.32 },
    desk: "#f2ddb4",
    monitor: { color: "#2b3242", emissive: 0 },
    lights: {
      ambient: 0.75,
      hemi: ["#ffffff", "#ffe6c0", 0.95],
      key: ["#fff2d8", 1.15],
      fill: ["#ffd9b0", 0.3],
    },
    camera: { fov: 38, lift: 0.9, pull: 0.95 },
  },
  blueprint: {
    id: "blueprint",
    label: "Blueprint hologram",
    background: "#081428",
    fog: true,
    floor: "#0e2444",
    rug: { target: "#000000", amount: 0.3 },
    corridor: "#0a1c38",
    corridorRunner: "#123059",
    wallSolid: "#12315c",
    accent: { target: "#ffffff", amount: 0.55 },
    frame: "#5fd0ff",
    frameEmissive: 1.4,
    glass: { color: "#7fc7ff", opacity: 0.28 },
    desk: "#12345f",
    monitor: { color: "#7ff0ff", emissive: 1.6 },
    lights: {
      ambient: 0.35,
      hemi: ["#3a6ea8", "#050b16", 0.6],
      key: ["#a9e0ff", 1.0],
      fill: ["#3a7bd5", 0.6],
    },
    camera: { fov: 38, lift: 0.95, pull: 0.95 },
    grid: "#2f6fb0",
  },
  neon: {
    id: "neon",
    label: "Cyberpunk neon",
    background: "#0a0614",
    fog: true,
    floor: "#14101f",
    rug: { target: "#000000", amount: 0.2 },
    corridor: "#0d0a16",
    corridorRunner: "#1a1230",
    wallSolid: "#171126",
    accent: { target: "#000000", amount: 0.3 },
    frame: "#ff4fd8",
    frameEmissive: 0.9,
    glass: { color: "#b07cff", opacity: 0.2 },
    desk: "#1d1730",
    monitor: { color: "#39ffd0", emissive: 1.6 },
    lights: {
      ambient: 0.28,
      hemi: ["#3a1f5c", "#07030f", 0.5],
      key: ["#ff2fb0", 1.1],
      fill: ["#22e6ff", 0.7],
    },
    camera: { fov: 42, lift: 0.8, pull: 0.9 },
    grid: "#ff2fb0",
  },
  comic: {
    id: "comic",
    label: "Comic / ink outline",
    background: "#fdf6e8",
    fog: false,
    floor: "#fff3d6",
    rug: { target: "#ffffff", amount: 0.35 },
    corridor: "#ffe9c2",
    corridorRunner: "#f6d9a8",
    wallSolid: "#fffaf0",
    accent: { target: "#ffffff", amount: 0.05 },
    frame: "#241f1a",
    glass: { color: "#bfe6ff", opacity: 0.3 },
    desk: "#f6e2b8",
    monitor: { color: "#241f1a", emissive: 0 },
    lights: {
      ambient: 0.9,
      hemi: ["#ffffff", "#ffe9c2", 1.0],
      key: ["#ffffff", 1.0],
      fill: ["#ffe0b0", 0.35],
    },
    camera: { fov: 34, lift: 0.95, pull: 0.95 },
  },
  mono: {
    id: "mono",
    label: "Executive minimal",
    background: "#f4f5f7",
    fog: false,
    floor: "#ffffff",
    rug: { target: "#ffffff", amount: 0.5 },
    corridor: "#e9ebef",
    corridorRunner: "#dcdfe6",
    wallSolid: "#ffffff",
    accent: { target: "#ffffff", amount: 0.35 },
    frame: "#9aa1ad",
    glass: { color: "#d5dde8", opacity: 0.26 },
    desk: "#f2f3f5",
    monitor: { color: "#2b3242", emissive: 0 },
    lights: {
      ambient: 0.85,
      hemi: ["#ffffff", "#e6e9ef", 0.95],
      key: ["#ffffff", 0.9],
      fill: ["#eef1f6", 0.3],
    },
    camera: { fov: 32, lift: 0.95, pull: 0.95 },
  },
};

export const DEFAULT_OFFICE_STYLE: OfficeStyleId = "nordic";

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
