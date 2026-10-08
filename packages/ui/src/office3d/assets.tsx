/**
 * GLB asset layer (Phase A).
 *
 * Real CC0/MIT models replace the primitives. Set an entry to a URL to swap
 * that prop; the primitive `children` stay as the fallback.
 *
 * Current assets:
 *  - chair  : three.js "SheenChair" (MIT)
 *  - person : three.js "Xbot" (MIT) — see people.tsx
 *
 * Recommended next: Draco + KTX2 compression, and instancing for repeats.
 */

import { Clone, useGLTF } from "@react-three/drei";
import type { ReactNode } from "react";

export interface OfficeAsset {
  /** URL of the .glb (Vite `?url` import or a CDN). */
  url: string;
  scale?: number;
  /** Vertical offset so the model sits on the floor. */
  y?: number;
  rotationY?: number;
}

/** Set an entry to an asset to swap that prop from primitive to GLB. */
export const OFFICE_ASSETS: Record<string, OfficeAsset | null> = {
  chair: null,
  desk: null,
  plantLarge: null,
  plantSmall: null,
  sofa: null,
  monitor: null,
  meetingTable: null,
  receptionDesk: null,
  bookcase: null,
  pingPong: null,
};

/** True once any real model has been configured. */
export function hasOfficeAssets(): boolean {
  return Object.values(OFFICE_ASSETS).some((asset) => asset !== null);
}

function GltfModel({ asset }: { asset: OfficeAsset }) {
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
 * Renders the GLB configured for `kind`, otherwise the primitive `children`.
 * Wrap the scene in `<Suspense>` when assets are present (they load lazily).
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
      {asset ? <GltfModel asset={asset} /> : children}
    </group>
  );
}
