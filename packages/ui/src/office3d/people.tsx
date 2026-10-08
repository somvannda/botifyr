/**
 * Animated human employees.
 *
 * Loads a rigged glTF human (MIT — three.js "Soldier", a Mixamo character with
 * Idle/Walk/Run clips) and plays one of its clips. Each instance gets its own
 * skeleton clone and mixer, so many employees animate independently.
 *
 * Model lives in the host's `public/office3d/soldier.glb`.
 */

import { Clone, useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";

export const PERSON_URL = "/office3d/soldier.glb";

export interface PersonProps {
  position?: [number, number, number];
  rotationY?: number;
  /** Preferred clip name (case-insensitive); falls back gracefully. */
  animation?: string;
  scale?: number;
}

export function Person({ position, rotationY = 0, animation = "idle", scale = 1 }: PersonProps) {
  const group = useRef<Group>(null);
  const { scene, animations } = useGLTF(PERSON_URL);
  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    const names = Object.keys(actions);
    const lower = animation.toLowerCase();
    const chosen =
      actions[animation] ??
      actions[names.find((name) => name.toLowerCase() === lower) ?? ""] ??
      actions[names.find((name) => name.toLowerCase().includes(lower)) ?? ""] ??
      actions[names.find((name) => name.toLowerCase().includes("idle")) ?? ""] ??
      actions[names[0]];
    chosen?.reset().fadeIn(0.3).play();
    return () => {
      chosen?.fadeOut(0.2);
    };
  }, [actions, animation]);

  // Tone down the stock materials so characters read correctly under HDRI light.
  useEffect(() => {
    const root = group.current;
    if (!root) return;
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as MeshStandardMaterial | undefined;
      if (material && "metalness" in material) {
        material.metalness = 0;
        material.roughness = Math.max(material.roughness ?? 1, 0.7);
        material.envMapIntensity = 0.5;
      }
    });
  }, [scene]);

  return (
    <Clone ref={group} object={scene} position={position} rotation={[0, rotationY, 0]} scale={scale} />
  );
}
