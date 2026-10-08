/**
 * Compress the fetched office models into single, texture-embedded `.glb` files
 * (Draco-free, meshopt + WebP textures via gltf-transform). Run after
 * `fetch-office-assets.mjs`:
 *
 *   node scripts/compress-office-assets.mjs
 *
 * Requires the dev dependency `@gltf-transform/cli`. Outputs `<id>.glb` next to
 * the source folders in each host's `public/office3d/`.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const RES = "1k";
const HOSTS = ["apps/portal/public/office3d", "apps/desktop/public/office3d"];
const MODELS = [
  "WoodenChair_01",
  "painted_wooden_chair_01",
  "mid_century_lounge_chair",
  "bar_chair_round_01",
  "modern_arm_chair_01",
  "metal_office_desk",
  "CoffeeTable_01",
  "Sofa_01",
  "ArmChair_01",
  "Shelf_01",
  "planter_box_01",
  "periwinkle_plant",
];

const root = process.cwd();
// Deduplicated host paths (the desktop folder may be a junction to the portal).
const targets = [...new Set(HOSTS.map((host) => join(root, host)))];
const seen = new Set();

for (const base of targets) {
  for (const id of MODELS) {
    const source = join(base, id, `${id}_${RES}.gltf`);
    if (!existsSync(source)) continue;
    const out = join(base, `${id}.glb`);
    if (seen.has(out)) continue;
    seen.add(out);
    execFileSync("npx", ["gltf-transform", "optimize", source, out, "--compress", "false"], {
      stdio: "inherit",
      shell: true,
    });
  }
}
console.log("office assets compressed.");
