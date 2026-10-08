/**
 * Fetch the 3D office assets (CC0 furniture/plants + an MIT character) into the
 * hosts' public folders. The binaries are git-ignored, so run this after cloning:
 *
 *   node scripts/fetch-office-assets.mjs
 *
 * Sources
 *  - Poly Haven (CC0): https://polyhaven.com — real-world (metre) scale glTF.
 *  - three.js (MIT):    Soldier.glb — Mixamo character with Idle/Walk/Run clips.
 */

import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const RES = "1k";
const HOSTS = ["apps/portal/public/office3d", "apps/desktop/public/office3d"];
const MODELS = [
  "WoodenChair_01",
  "painted_wooden_chair_01",
  "mid_century_lounge_chair",
  "metal_office_desk",
  "CoffeeTable_01",
  "Sofa_01",
  "ArmChair_01",
  "Shelf_01",
  "planter_box_01",
  "periwinkle_plant",
];
const CHARACTERS = [
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb",
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Xbot.glb",
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  if (await exists(dest)) return false;
  await mkdir(dirname(dest), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
  return true;
}

async function fetchModel(base, id) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const gltf = files?.gltf?.[RES]?.gltf;
  if (!gltf) throw new Error(`no ${RES} gltf for ${id}`);
  const dir = join(base, id);
  await download(gltf.url, join(dir, gltf.url.split("/").pop()));
  for (const [name, info] of Object.entries(gltf.include ?? {})) {
    await download(info.url, join(dir, name)); // `name` keeps its relative path
  }
}

async function main() {
  const root = process.cwd();
  for (const host of HOSTS) {
    const base = join(root, host);
    for (const id of MODELS) {
      await fetchModel(base, id);
      process.stdout.write(`.`);
    }
    await download(CHARACTERS[0], join(base, "soldier.glb"));
    await download(CHARACTERS[1], join(base, "xbot.glb"));
    process.stdout.write(`\n${host} ready\n`);
  }
  // Keep the two hosts identical.
  for (const id of MODELS) {
    await copyFile(
      join(root, HOSTS[0], id, `${id}_${RES}.gltf`),
      join(root, HOSTS[1], id, `${id}_${RES}.gltf`),
    ).catch(() => {});
  }
  console.log("office assets fetched.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
