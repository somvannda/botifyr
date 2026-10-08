/**
 * Export the office layout to `office-scene.json` — a renderer-agnostic
 * description an offline renderer (Blender/Cycles) can build from.
 *
 * Reuses the REAL layout code, so the offline scene matches the app exactly:
 *
 *   npx tsx scripts/export-office-scene.ts [out.json]
 *
 * Then render it (once Blender is installed):
 *
 *   blender -b -P scripts/blender/office_render.py -- office-scene.json out.png
 */

import { writeFileSync } from "node:fs";
import { buildOfficeLayout, type LayoutAgent } from "../packages/ui/src/office3d/layout.ts";

/** A sample company — replace with a real workspace's employees when wiring this up. */
const AGENTS: LayoutAgent[] = [
  { botId: "1", name: "Maya", emoji: "🦊", title: "CEO", department: "exec", activity: "running" },
  { botId: "2", name: "Leo", emoji: "🐻", title: "CTO", department: "engineering", activity: "running" },
  { botId: "3", name: "Nora", emoji: "🐼", title: "QA", department: "engineering", activity: "running" },
  { botId: "4", name: "Sam", emoji: "🦉", title: "PM", department: "product", activity: "running" },
  { botId: "5", name: "Ivy", emoji: "🐨", title: "Designer", department: "design", activity: "idle" },
  { botId: "6", name: "Ravi", emoji: "🐧", title: "Growth", department: "growth", activity: "idle" },
  { botId: "7", name: "Kai", emoji: "🐯", title: "Sales", department: "sales", activity: "idle" },
  { botId: "8", name: "Zoe", emoji: "🐸", title: "Support", department: "support", activity: "idle" },
];

const out = process.argv[2] ?? "office-scene.json";
writeFileSync(out, JSON.stringify(buildOfficeLayout(AGENTS), null, 2));
console.log(`wrote ${out}`);
