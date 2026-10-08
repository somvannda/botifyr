# Office 3D — interactive view + offline render

Two ways to show the virtual office. They share **one** scene definition.

## 1. Interactive (shipped)

Live WebGL view in the app (`packages/ui/src/office3d`), rendered by three.js /
React Three Fiber. Reachable from **Company HQ → 3D Workspace** (dock/float,
rotate, zoom), with **8 colour themes**.

- Layout: `layout.ts` — one building envelope, perimeter rooms flush to the
  glass curtain wall, grey-tile open centre with wood-floored rooms, open-plan
  benches, planters, ping-pong, gym, lounge, kitchen, reception.
- Assets: real CC0 Poly Haven furniture + HDRI, ambientCG wood PBR floor, MIT
  Mixamo characters — compressed to `.glb` (see `scripts/`).
- Live: each employee is a desk + avatar + status dot, driven by real tasks.

## 2. Offline render (Blender / Cycles) — *near-photoreal stills*

Real-time WebGL ≈ a game; a Cycles render is the route to the look of a
photoreal architectural image. It needs **Blender installed**.

Pipeline:

```bash
# 1. Emit the scene description from the REAL layout code:
npx tsx scripts/export-office-scene.ts office-scene.json

# 2. Render it (install Blender first: https://blender.org):
blender -b -P scripts/blender/office_render.py -- office-scene.json office-render.png
```

`office_render.py` builds floors, glass partitions, desks, planters and a
low-poly person per desk from the JSON, sets a near-orthographic camera and
Cycles, and writes a PNG.

### To reach true photorealism
The scene skeleton and camera are done; the remaining gap is **assets**, not code:
- Replace the primitive furniture with **PBR furniture** (Poly Haven/Fab).
- Replace the low-poly people with **scanned humans** (Renderpeople / Human Alloy).
- Add **HDRI lighting** and a few **area lights** for soft shadows / GI.
- Then a container (the repo already has Docker sandbox infra) can run the
  render headlessly and surface a "Render presentation image" button.

## Assets

`scripts/fetch-office-assets.mjs` downloads the CC0/MIT sources;
`scripts/compress-office-assets.mjs` optimises them to `.glb`
(22.9 MB → 8.4 MB). Binaries are git-ignored (`apps/*/public/office3d/`);
`apps/desktop/public/office3d` is a **junction** to the portal copy.

> Restart the portal dev server after changing a module's exports — Vite can't
> hot-refresh when exports are removed and will serve a stale module.
