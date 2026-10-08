/**
 * Real material assets for the 3D office (Phase A).
 *
 * CC0 sources:
 *  - HDRI  : Poly Haven — studio_small_08 (CC0)
 *  - Wood  : ambientCG — Wood066 1K (CC0)
 *
 * Bundled via Vite `?url` so both the desktop and portal builds resolve them.
 * Swap these files to re-skin the office.
 */

import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import hdriUrl from "./assets/studio_small_08.hdr?url";
import woodColor from "./assets/wood/Wood066_1K-JPG_Color.jpg?url";
import woodNormal from "./assets/wood/Wood066_1K-JPG_NormalGL.jpg?url";
import woodRoughness from "./assets/wood/Wood066_1K-JPG_Roughness.jpg?url";

export const HDRI_URL = hdriUrl;

export interface FloorMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/** Wood PBR maps, tiled to a sensible plank size. */
export function useFloorMaps(): FloorMaps {
  const [map, normalMap, roughnessMap] = useTexture([woodColor, woodNormal, woodRoughness]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, normalMap, roughnessMap]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.4, 2);
    texture.anisotropy = 4;
    texture.needsUpdate = true;
  }
  return { map, normalMap, roughnessMap };
}
