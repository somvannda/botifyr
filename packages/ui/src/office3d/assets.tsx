/**
 * GLB/glTF asset layer.
 *
 * Real CC0/MIT models replace the primitives; the primitive `children` stay as a
 * fallback. Files live in each host's `public/office3d/` (served at `/office3d/…`)
 * and are loaded with `useGLTF`.
 *
 * Sources:
 *  - Furniture/plants: Poly Haven (CC0) — real-world (metre) scale.
 *  - Human: three.js "Xbot" (MIT, Mixamo-rigged) — see people.tsx.
 */

import { Clone, useGLTF } from "@react-three/drei";
import type { ReactNode } from "react";

export interface OfficeAsset {
  url: string;
  scale?: number;
  /** Vertical offset so the model sits on the floor. */
  y?: number;
  rotationY?: number;
}

export const ASSET_BASE = "/office3d/";

/** Set an entry to an asset to swap that prop from primitive to model. */
export const OFFICE_ASSETS: Record<string, OfficeAsset | null> = {
  chair: { url: `${ASSET_BASE}WoodenChair_01.glb` },
  chair2: { url: `${ASSET_BASE}painted_wooden_chair_01.glb` },
  loungeChair: { url: `${ASSET_BASE}mid_century_lounge_chair.glb` },
  stool: { url: `${ASSET_BASE}bar_chair_round_01.glb` },
  armChair2: { url: `${ASSET_BASE}modern_arm_chair_01.glb` },
  desk: { url: `${ASSET_BASE}metal_office_desk.glb` },
  coffeeTable: { url: `${ASSET_BASE}CoffeeTable_01.glb` },
  sofa: { url: `${ASSET_BASE}Sofa_01.glb` },
  armChair: { url: `${ASSET_BASE}ArmChair_01.glb` },
  shelf: { url: `${ASSET_BASE}Shelf_01.glb` },
  planterBox: { url: `${ASSET_BASE}planter_box_01.glb` },
  plant: { url: `${ASSET_BASE}periwinkle_plant.glb` },
};

/** True once any real model has been configured. */
export function hasOfficeAssets(): boolean {
  return Object.values(OFFICE_ASSETS).some((asset) => asset !== null);
}

function Model({ asset }: { asset: OfficeAsset }) {
  const { scene } = useGLTF(asset.url);
  return (
    <Clone
      object={scene}
      scale={asset.scale ?? 1}
      position={[0, asset.y ?? 0, 0]}
      rotation={[0, asset.rotationY ?? 0, 0]}
    />
  );
}

/**
 * Renders the model configured for `kind`, otherwise the primitive `children`.
 * Must be inside `<Suspense>` (models load lazily) — the scene wraps it.
 */
export function Prop({
  kind,
  position,
  rotationY,
  children,
}: {
  kind: string;
  position?: [number, number, number];
  rotationY?: number;
  children: ReactNode;
}) {
  const asset = OFFICE_ASSETS[kind];
  return (
    <group position={position} rotation={[0, rotationY ?? 0, 0]}>
      {asset ? <Model asset={asset} /> : children}
    </group>
  );
}
