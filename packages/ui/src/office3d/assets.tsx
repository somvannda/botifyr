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
  chair: { url: `${ASSET_BASE}WoodenChair_01/WoodenChair_01_1k.gltf` },
  desk: { url: `${ASSET_BASE}metal_office_desk/metal_office_desk_1k.gltf` },
  coffeeTable: { url: `${ASSET_BASE}CoffeeTable_01/CoffeeTable_01_1k.gltf` },
  sofa: { url: `${ASSET_BASE}Sofa_01/Sofa_01_1k.gltf` },
  armChair: { url: `${ASSET_BASE}ArmChair_01/ArmChair_01_1k.gltf` },
  shelf: { url: `${ASSET_BASE}Shelf_01/Shelf_01_1k.gltf` },
  planterBox: { url: `${ASSET_BASE}planter_box_01/planter_box_01_1k.gltf` },
  plant: { url: `${ASSET_BASE}periwinkle_plant/periwinkle_plant_1k.gltf` },
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
