/**
 * Animated, unique human employees.
 *
 * Uses ONE self-contained rig — `public/office3d/soldier.glb` (three.js, MIT) —
 * which ships both the body AND the Idle/Walk/Run clips on a matching skeleton.
 * That avoids cross-rig retarget warnings entirely and means only one model is
 * fetched (shared by every employee via drei's GLTF cache).
 *
 * Variety comes from tinting (skin / hair / outfit), height and a slight turn,
 * all derived deterministically from the employee id.
 */

import { Clone, useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { Color, type Group, type Mesh, type MeshStandardMaterial } from "three";

/** Self-contained Mixamo rigs (each ships its own body + Idle/Walk/Run clips). */
export const RIGS = ["/office3d/soldier.glb", "/office3d/xbot.glb"];

const OUTFITS = [
  "#c0392b", "#2d6cdf", "#2e8b57", "#8e44ad", "#d35400", "#16a085",
  "#c2185b", "#3f51b5", "#00897b", "#5d4037", "#455a64", "#e67e22",
];
const SKIN = ["#f3c9a2", "#e6b183", "#d29a6a", "#b57a4b", "#8d5524", "#6b4520"];
const HAIR = ["#1c1c1c", "#2c1b18", "#4b3621", "#7a5230", "#b5651d", "#9e9e9e"];

function hash(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(value);
}

export interface PersonProps {
  position?: [number, number, number];
  rotationY?: number;
  /** Preferred clip name (case-insensitive); falls back gracefully. */
  animation?: string;
  scale?: number;
  /** Stable employee id — drives the unique look. */
  agentId?: string;
}

export function Person({
  position,
  rotationY = 0,
  animation = "idle",
  scale = 1,
  agentId = "agent",
}: PersonProps) {
  const group = useRef<Group>(null);
  const seed = hash(agentId);
  const rigUrl = RIGS[seed % RIGS.length];
  const { scene, animations } = useGLTF(rigUrl);
  const { actions } = useAnimations(animations, group);

  const outfit = OUTFITS[seed % OUTFITS.length];
  const skin = SKIN[(seed >> 2) % SKIN.length];
  const hair = HAIR[(seed >> 4) % HAIR.length];
  const height = 0.94 + ((seed >> 7) % 9) / 100; // 0.94 – 1.02
  const turn = (((seed >> 11) % 5) - 2) * 0.05;

  // Stagger the idle so everyone isn't breathing in lockstep.
  useEffect(() => {
    const names = Object.keys(actions);
    const lower = animation.toLowerCase();
    const chosen =
      actions[animation] ??
      actions[names.find((name) => name.toLowerCase() === lower) ?? ""] ??
      actions[names.find((name) => name.toLowerCase().includes(lower)) ?? ""] ??
      actions[names.find((name) => name.toLowerCase().includes("idle")) ?? ""] ??
      actions[names[0]];
    if (!chosen) return;
    const action = chosen.reset().fadeIn(0.3).play();
    action.time = (seed % 100) / 100 * 2;
    return () => {
      action.fadeOut(0.2);
    };
  }, [actions, animation, seed]);

  // Per-employee material pass: clone (clones are per-instance), calm for HDRI,
  // and tint so each person looks different.
  useEffect(() => {
    const root = group.current;
    if (!root) return;
    const outfitColor = new Color(outfit);
    const skinColor = new Color(skin);
    const hairColor = new Color(hair);
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = materials.map((material) => {
        const next = (material as MeshStandardMaterial).clone();
        if ("metalness" in next) {
          next.metalness = 0;
          next.roughness = Math.max(next.roughness ?? 1, 0.7);
          next.envMapIntensity = 0.5;
        }
        const name = next.name ?? "";
        if (/hair/i.test(name)) next.color = hairColor;
        else if (/outfit|top|bottom|shirt|cloth|shoe|feet|soldier|camo/i.test(name)) {
          next.color = outfitColor;
        } else if (/body|head|skin|avatar|face|hand/i.test(name)) next.color = skinColor;
        return next;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
    });
  }, [scene, outfit, skin, hair]);

  return (
    <Clone
      ref={group}
      object={scene}
      position={position}
      rotation={[0, rotationY + turn, 0]}
      scale={scale * height}
    />
  );
}
