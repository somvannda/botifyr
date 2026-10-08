/**
 * The 3D office scene: one building envelope with rooms built around the
 * perimeter and an open-plan middle (bench desks + planters) — like a real
 * floor plan. Loaded lazily (pulls in three.js; never in the main bundle).
 */

import { Suspense, useEffect } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls } from "@react-three/drei";
import {
  activityColor,
  type BenchLayout,
  type DeskLayout,
  type OfficeLayout,
  type PlanterLayout,
  type RoomLayout,
  type WallSide,
} from "./layout";
import { Prop } from "./assets";
import { Person } from "./people";
import { HDRI_URL, useFloorMaps } from "./textures";
import { OFFICE3D, OFFICE_STYLES, type OfficeStyle, type OfficeStyleId } from "./theme";
import {
  Chair,
  DeskLamp,
  Plant,
  ReceptionDesk,
  WallScreen,
  WaterCooler,
} from "./props";

const FRAME = 0.07;

/** Styles that use the real HDRI + wood PBR floors rather than flat colors. */
const REALISM_STYLES = new Set<OfficeStyleId>(["iso", "nordic", "cartoon", "comic", "mono"]);

/** Filmic tone-mapping so the lighting reads photographic rather than flat. */
function RendererSetup() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
  }, [gl]);
  return null;
}

function FrameMaterial({ style }: { style: OfficeStyle }) {
  return (
    <meshStandardMaterial
      color={style.frame}
      emissive={style.frame}
      emissiveIntensity={style.frameEmissive ?? 0}
      metalness={0.6}
      roughness={0.4}
    />
  );
}

function GlassMaterial({ style }: { style: OfficeStyle }) {
  return (
    <meshStandardMaterial
      color={style.glass.color}
      transparent
      opacity={style.glass.opacity}
      roughness={0.08}
      metalness={0.05}
      depthWrite={false}
    />
  );
}

function PaneMaterial({ style, glazed }: { style: OfficeStyle; glazed: boolean }) {
  if (glazed) return <GlassMaterial style={style} />;
  return <meshStandardMaterial color={style.wallSolid} roughness={0.92} metalness={0.02} />;
}

/** A partition wall with an optional centred doorway (`doorWidth` 0 = none). */
function Wall({
  axis,
  length,
  height,
  doorWidth,
  glazed,
  style,
  position,
}: {
  axis: "x" | "z";
  length: number;
  height: number;
  doorWidth: number;
  glazed: boolean;
  style: OfficeStyle;
  position: [number, number, number];
}) {
  const thickness = OFFICE3D.wallThickness;
  const gap = Math.min(Math.max(doorWidth, 0), Math.max(0, length - 1.4));
  const seg = (length - gap) / 2;
  const offset = gap / 2 + seg / 2;
  const paneArgs: [number, number, number] = axis === "x" ? [seg, height, thickness] : [thickness, height, seg];
  const railArgs: [number, number, number] =
    axis === "x" ? [length, FRAME, thickness + 0.02] : [thickness + 0.02, FRAME, length];
  const postArgs: [number, number, number] =
    axis === "x" ? [FRAME, height, thickness] : [thickness, height, FRAME];
  const place = (along: number, y: number): [number, number, number] =>
    axis === "x" ? [along, y, 0] : [0, y, along];

  const mullions: number[] = [];
  const divisions = Math.max(1, Math.round(length / 2.4));
  for (let i = 0; i <= divisions; i += 1) {
    const along = -length / 2 + (length * i) / divisions;
    if (gap > 0 && Math.abs(along) <= gap / 2 + 0.01) continue;
    mullions.push(along);
  }

  return (
    <group position={position}>
      {gap > 0.05 ? (
        <>
          <mesh position={place(-offset, height / 2)}>
            <boxGeometry args={paneArgs} />
            <PaneMaterial style={style} glazed={glazed} />
          </mesh>
          <mesh position={place(offset, height / 2)}>
            <boxGeometry args={paneArgs} />
            <PaneMaterial style={style} glazed={glazed} />
          </mesh>
        </>
      ) : (
        <mesh position={[0, height / 2, 0]}>
          <boxGeometry args={axis === "x" ? [length, height, thickness] : [thickness, height, length]} />
          <PaneMaterial style={style} glazed={glazed} />
        </mesh>
      )}

      <mesh castShadow position={[0, height - FRAME / 2, 0]}>
        <boxGeometry args={railArgs} />
        <FrameMaterial style={style} />
      </mesh>
      <mesh castShadow position={[0, FRAME / 2, 0]}>
        <boxGeometry args={railArgs} />
        <FrameMaterial style={style} />
      </mesh>

      {mullions.map((along) => (
        <mesh key={`m${along}`} castShadow position={place(along, height / 2)}>
          <boxGeometry args={postArgs} />
          <FrameMaterial style={style} />
        </mesh>
      ))}

      {gap > 0.05 &&
        [-gap / 2, gap / 2].map((along) => (
          <mesh key={`d${along}`} castShadow position={place(along, height / 2)}>
            <boxGeometry args={postArgs} />
            <FrameMaterial style={style} />
          </mesh>
        ))}
    </group>
  );
}

/** A room floor with real wood PBR maps (suspends while the texture loads). */
function TexturedFloor({ width, depth }: { width: number; depth: number }) {
  const { map, normalMap, roughnessMap } = useFloorMaps();
  return (
    <mesh receiveShadow position={[0, -0.1, 0]}>
      <boxGeometry args={[width, 0.2, depth]} />
      <meshStandardMaterial
        map={map}
        normalMap={normalMap}
        roughnessMap={roughnessMap}
        roughness={1}
        metalness={0.03}
      />
    </mesh>
  );
}

function Floor({ width, depth, style, realism }: { width: number; depth: number; style: OfficeStyle; realism: boolean }) {
  if (realism) {
    return (
      <Suspense fallback={null}>
        <TexturedFloor width={width} depth={depth} />
      </Suspense>
    );
  }
  return (
    <mesh receiveShadow position={[0, -0.1, 0]}>
      <boxGeometry args={[width, 0.2, depth]} />
      <meshStandardMaterial color={style.floor} roughness={0.75} metalness={0.03} />
    </mesh>
  );
}

function Boardroom({ width, depth }: { width: number; depth: number }) {
  const tableW = Math.min(width - 3, 9);
  const tableD = Math.min(depth - 4, 1.4);
  const chairXs = [-tableW / 2 + 1, -tableW / 6, tableW / 6, tableW / 2 - 1];
  return (
    <group>
      <mesh castShadow position={[0, 0.74, 0]}>
        <boxGeometry args={[tableW, 0.12, tableD]} />
        <meshStandardMaterial color="#8a6a4c" roughness={0.5} metalness={0.05} />
      </mesh>
      {chairXs.flatMap((x) =>
        [-1, 1].map((side) => (
          <mesh key={`${x}:${side}`} castShadow position={[x, 0.28, side * (tableD / 2 + 0.6)]}>
            <boxGeometry args={[0.5, 0.56, 0.5]} />
            <meshStandardMaterial color="#3b4256" roughness={0.8} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Kitchen({ width, depth }: { width: number; depth: number }) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const island = Math.min(width - 4, 6);
  return (
    <group>
      <mesh castShadow position={[0, 0.45, 0.4]}>
        <boxGeometry args={[island, 0.9, 1.4]} />
        <meshStandardMaterial color="#e7e2d8" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0, 0.92, 0.4]}>
        <boxGeometry args={[island + 0.2, 0.08, 1.6]} />
        <meshStandardMaterial color="#cfc7b8" roughness={0.4} />
      </mesh>
      <mesh castShadow position={[0, 0.45, -halfD + 0.6]}>
        <boxGeometry args={[width - 2, 0.9, 0.6]} />
        <meshStandardMaterial color="#d8d2c6" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[-halfW + 0.8, 0.9, -halfD + 0.6]}>
        <boxGeometry args={[0.9, 1.8, 0.7]} />
        <meshStandardMaterial color="#c9ccd4" metalness={0.4} roughness={0.3} />
      </mesh>
      <Plant position={[halfW - 0.7, 0, halfD - 0.7]} />
    </group>
  );
}

function Gym({ width, depth }: { width: number; depth: number }) {
  const halfW = width / 2;
  const halfD = depth / 2;
  return (
    <group>
      {/* mirror wall */}
      <mesh position={[0, 1.25, -halfD + 0.15]}>
        <boxGeometry args={[Math.max(2, width - 1.4), 1.9, 0.06]} />
        <meshStandardMaterial color="#cfe3ef" metalness={0.6} roughness={0.15} />
      </mesh>
      {/* treadmills */}
      <mesh castShadow position={[-halfW + 1.7, 0.3, -halfD + 1.7]}>
        <boxGeometry args={[2.4, 0.6, 1]} />
        <meshStandardMaterial color="#4a5163" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[-halfW + 1.7, 0.3, halfD - 1.7]}>
        <boxGeometry args={[2.4, 0.6, 1]} />
        <meshStandardMaterial color="#4a5163" roughness={0.7} />
      </mesh>
      {/* weights rack */}
      <mesh castShadow position={[halfW - 1.2, 0.6, -halfD + 1.3]}>
        <boxGeometry args={[1.3, 1.2, 0.7]} />
        <meshStandardMaterial color="#3a4152" roughness={0.7} />
      </mesh>
      {/* bench */}
      <mesh castShadow position={[halfW - 1.6, 0.35, 0.2]}>
        <boxGeometry args={[1.8, 0.7, 0.7]} />
        <meshStandardMaterial color="#55607a" roughness={0.7} />
      </mesh>
      {/* yoga mats */}
      <mesh position={[0.4, 0.03, halfD - 1.4]}>
        <boxGeometry args={[2.6, 0.06, 1.8]} />
        <meshStandardMaterial color="#4a7f6a" roughness={0.95} />
      </mesh>
      <Plant position={[halfW - 0.7, 0, halfD - 0.7]} />
    </group>
  );
}

/** A ping-pong table with a net and two paddles. */
function PingPong({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh castShadow position={[0, 0.76, 0]}>
        <boxGeometry args={[2.74, 0.06, 1.52]} />
        <meshStandardMaterial color="#1f5f9e" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.795, 0]}>
        <boxGeometry args={[2.74, 0.006, 0.05]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0.92, 0]}>
        <boxGeometry args={[0.02, 0.16, 1.6]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.85} />
      </mesh>
      {[
        [-1.2, -0.6],
        [1.2, -0.6],
        [-1.2, 0.6],
        [1.2, 0.6],
      ].map(([lx, lz]) => (
        <mesh key={`${lx}:${lz}`} position={[lx, 0.38, lz]}>
          <boxGeometry args={[0.08, 0.76, 0.08]} />
          <meshStandardMaterial color="#3a4152" />
        </mesh>
      ))}
      <mesh position={[-0.6, 0.8, 0.95]} rotation={[0.25, 0, 0]}>
        <boxGeometry args={[0.16, 0.02, 0.2]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
      <mesh position={[0.6, 0.8, -0.95]} rotation={[-0.25, 0, 0]}>
        <boxGeometry args={[0.16, 0.02, 0.2]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
    </group>
  );
}

function Lounge({ width }: { width: number }) {
  const offsetX = Math.min(width / 4, 2.2);
  return (
    <group>
      {[-offsetX, offsetX].map((x) => (
        <mesh key={x} castShadow position={[x, 0.32, 0]}>
          <boxGeometry args={[2.2, 0.64, 1]} />
          <meshStandardMaterial color="#5d7a63" roughness={0.85} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.25, -1.6]}>
        <boxGeometry args={[1.8, 0.5, 0.8]} />
        <meshStandardMaterial color="#4f6a55" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** Corner and edge furniture for a room, kept clear of the desk area. */
function RoomFurniture({ room }: { room: RoomLayout }) {
  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  if (room.kind === "lounge") {
    return (
      <group>
        <Suspense fallback={null}>
          <Prop kind="sofa" position={[0, 0, -halfD + 1.3]}>
            <Lounge width={room.width} />
          </Prop>
        </Suspense>
        <Suspense fallback={null}>
          <Prop kind="loungeChair" position={[halfW - 1.5, 0, halfD - 1.8]} rotationY={Math.PI}>
            <Plant />
          </Prop>
        </Suspense>
        <Suspense fallback={null}>
          <Prop kind="armChair" position={[-halfW + 1.6, 0, halfD - 1.8]} rotationY={Math.PI}>
            <Plant />
          </Prop>
        </Suspense>
        <Suspense fallback={null}>
          <Prop kind="coffeeTable" position={[0, 0, -halfD + 3.4]}>
            <Plant />
          </Prop>
        </Suspense>
        <Plant position={[-halfW + 0.8, 0, halfD - 0.8]} />
      </group>
    );
  }
  if (room.kind === "gym") {
    return <WaterCooler position={[-halfW + 0.5, 0, -halfD + 0.5]} />;
  }
  if (room.kind === "lobby") {
    return (
      <group>
        <ReceptionDesk position={[0, 0, -halfD + 0.9]} />
        <Chair position={[0, 0, -halfD + 2]} />
        <Plant position={[halfW - 0.7, 0, halfD - 0.7]} />
        <Plant position={[-halfW + 0.7, 0, halfD - 0.7]} />
      </group>
    );
  }
  if (room.kind === "kitchen") {
    return null;
  }
  if (room.kind === "meeting") {
    return null;
  }
  return (
    <group>
      <WallScreen position={[0, 1.6, -halfD + 0.2]} width={1.8} />
      <Suspense fallback={null}>
        <Prop kind="shelf" position={[halfW - 0.8, 0, -halfD + 0.5]}>
          <mesh castShadow position={[0, 0.8, 0]}>
            <boxGeometry args={[1, 1.6, 0.35]} />
            <meshStandardMaterial color="#7a5c42" roughness={0.8} />
          </mesh>
        </Prop>
      </Suspense>
      <Suspense fallback={null}>
        <Prop kind="plant" position={[-halfW + 0.9, 0, halfD - 0.9]}>
          <Plant />
        </Prop>
      </Suspense>
      <WaterCooler position={[-halfW + 0.5, 0, -halfD + 0.5]} />
    </group>
  );
}

const OPPOSITE: Record<WallSide, WallSide> = { N: "S", S: "N", E: "W", W: "E" };

function Room({
  room,
  style,
  realism,
  labels,
}: {
  room: RoomLayout;
  style: OfficeStyle;
  realism: boolean;
  labels: boolean;
}) {
  const thickness = OFFICE3D.wallThickness;
  const height = OFFICE3D.wallHeight;
  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  const outer = OPPOSITE[room.door];
  const doorFor = (side: WallSide): number => (room.door === side ? OFFICE3D.doorWidth : 0);

  return (
    <group position={[room.x, 0, room.z]}>
      <Floor width={room.width} depth={room.depth} style={style} realism={realism} />
      <mesh receiveShadow position={[0, 0.012, 0.2]}>
        <boxGeometry args={[room.width * 0.42, 0.02, room.depth * 0.4]} />
        <meshStandardMaterial color={mixColor(room.color)} roughness={0.96} />
      </mesh>

      {outer !== "N" && (
        <Wall axis="x" length={room.width} height={height} doorWidth={doorFor("N")} glazed={room.glazed} style={style} position={[0, 0, -halfD + thickness / 2]} />
      )}
      {outer !== "S" && (
        <Wall axis="x" length={room.width} height={height} doorWidth={doorFor("S")} glazed={room.glazed} style={style} position={[0, 0, halfD - thickness / 2]} />
      )}
      {outer !== "W" && (
        <Wall axis="z" length={room.depth} height={height} doorWidth={doorFor("W")} glazed={room.glazed} style={style} position={[-halfW + thickness / 2, 0, 0]} />
      )}
      {outer !== "E" && (
        <Wall axis="z" length={room.depth} height={height} doorWidth={doorFor("E")} glazed={room.glazed} style={style} position={[halfW - thickness / 2, 0, 0]} />
      )}

      {room.kind === "meeting" && <Boardroom width={room.width} depth={room.depth} />}
      {room.kind === "kitchen" && <Kitchen width={room.width} depth={room.depth} />}
      {room.kind === "gym" && <Gym width={room.width} depth={room.depth} />}
      {room.kind === "lounge" && <Lounge width={room.width} />}
      <RoomFurniture room={room} />

      {labels && (
        <Html center distanceFactor={32} position={[0, height + 0.35, -halfD + 0.3]} className="office3d-room-label">
          <span style={{ background: room.color }}>{room.label}</span>
        </Html>
      )}
    </group>
  );
}

function mixColor(hex: string): string {
  const value = hex.replace("#", "");
  const c = (i: number): number => {
    const v = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
    return Math.round(v + (255 - v) * 0.6);
  };
  return `#${[0, 1, 2].map((i) => c(i).toString(16).padStart(2, "0")).join("")}`;
}

function Bench({ bench, style }: { bench: BenchLayout; style: OfficeStyle }) {
  const monitorCount = Math.max(2, Math.floor(bench.width / 1.8));
  return (
    <group position={[bench.x, 0, bench.z]}>
      <mesh castShadow position={[0, 0.72, 0]}>
        <boxGeometry args={[bench.width, 0.09, 1.5]} />
        <meshStandardMaterial color={style.desk} roughness={0.6} metalness={0.04} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <boxGeometry args={[bench.width * 0.86, 0.5, 0.5]} />
        <meshStandardMaterial color="#3a4152" roughness={0.7} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, 0.05, side * 0.6]}>
          <boxGeometry args={[bench.width * 0.9, 0.1, 0.1]} />
          <meshStandardMaterial color="#9aa3b5" metalness={0.3} roughness={0.5} />
        </mesh>
      ))}
      {/* Monitors on both sides so every bench (including spare ones) reads as a desk row. */}
      {[-1, 1].flatMap((side) =>
        Array.from({ length: monitorCount }, (_, index) => {
          const x = -bench.width / 2 + (bench.width / (monitorCount + 1)) * (index + 1);
          return (
            <mesh key={`${side}:${index}`} castShadow position={[x, 1.0, side * 0.28]}>
              <boxGeometry args={[0.6, 0.4, 0.05]} />
              <meshStandardMaterial
                color={style.monitor.color}
                emissive={style.monitor.color}
                emissiveIntensity={style.monitor.emissive}
                roughness={0.4}
                metalness={0.25}
              />
            </mesh>
          );
        }),
      )}
    </group>
  );
}

function Planter({ planter }: { planter: PlanterLayout }) {
  return (
    <Suspense fallback={null}>
      <Prop kind="planterBox" position={[planter.x, 0, planter.z]}>
        <group>
          <mesh castShadow position={[0, 0.3, 0]}>
            <boxGeometry args={[1.6, 0.6, 1.6]} />
            <meshStandardMaterial color="#d7dbe3" roughness={0.8} />
          </mesh>
          <Plant position={[0, 0.55, 0]} />
        </group>
      </Prop>
    </Suspense>
  );
}

const DESK_LEGS: Array<[number, number]> = [
  [-0.7, -0.38],
  [0.7, -0.38],
  [-0.7, 0.38],
  [0.7, 0.38],
];

function Desk({ desk, style, labels, onSelect }: { desk: DeskLayout; style: OfficeStyle; labels: boolean; onSelect?: (botId: string) => void }) {
  const status = activityColor(desk.agent.activity);
  return (
    <group position={[desk.x, 0, desk.z]} rotation={[0, desk.rotation, 0]}>
      <Suspense fallback={null}>
        <Prop kind="desk">
          <group>
            <mesh castShadow position={[0, 0.72, 0]}>
              <boxGeometry args={[1.5, 0.09, 0.85]} />
              <meshStandardMaterial color={style.desk} roughness={0.6} metalness={0.04} />
            </mesh>
            {DESK_LEGS.map(([legX, legZ]) => (
              <mesh key={`${legX}:${legZ}`} position={[legX, 0.36, legZ]}>
                <boxGeometry args={[0.08, 0.72, 0.08]} />
                <meshStandardMaterial color="#9aa3b5" roughness={0.6} metalness={0.1} />
              </mesh>
            ))}
          </group>
        </Prop>
      </Suspense>
      <mesh castShadow position={[0, 1.0, -0.22]}>
        <boxGeometry args={[0.68, 0.42, 0.06]} />
        <meshStandardMaterial
          color={style.monitor.color}
          emissive={style.monitor.color}
          emissiveIntensity={style.monitor.emissive}
          roughness={0.4}
          metalness={0.25}
        />
      </mesh>
      <mesh position={[0, 0.84, -0.15]}>
        <boxGeometry args={[0.1, 0.28, 0.1]} />
        <meshStandardMaterial color="#3a4152" roughness={0.5} />
      </mesh>
      <DeskLamp position={[-0.5, 0.765, 0.1]} />
      <Suspense fallback={null}>
        <Prop kind={desk.botId.charCodeAt(0) % 2 === 0 ? "chair" : "chair2"} position={[0, 0, 0.95]}>
          <Chair />
        </Prop>
      </Suspense>
      <Suspense fallback={null}>
        <Person position={[0, 0, 1.15]} rotationY={Math.PI} agentId={desk.botId} />
      </Suspense>
      {labels && (
        <Html
          center
          distanceFactor={28}
          position={[0, 1.7, 0]}
          className="office3d-desk-label"
          style={{ pointerEvents: onSelect ? "auto" : "none" }}
        >
          <button type="button" onClick={() => onSelect?.(desk.botId)} title={desk.agent.title}>
            <i style={{ background: status }} />
            <span>
              {desk.agent.emoji} {desk.agent.name}
            </span>
            <em>{desk.agent.title}</em>
          </button>
        </Html>
      )}
    </group>
  );
}

export interface OfficeControls {
  object: {
    position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
  };
  target: { x: number; y: number; z: number };
  update: () => void;
  reset: () => void;
}

export function OfficeScene({
  layout,
  styleId = "nordic",
  labels = true,
  onSelect,
  onControls,
}: {
  layout: OfficeLayout;
  styleId?: OfficeStyleId;
  labels?: boolean;
  onSelect?: (botId: string) => void;
  onControls?: (controls: OfficeControls | null) => void;
}) {
  const style: OfficeStyle = OFFICE_STYLES[styleId];
  const realism = REALISM_STYLES.has(styleId);
  const span = Math.max(layout.width, layout.depth);
  const cameraY = span * style.camera.lift + 8;
  const cameraZ = span * style.camera.pull + 10;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ position: [0, cameraY, cameraZ], fov: style.camera.fov, near: 0.1, far: 1200 }}
    >
      <RendererSetup />
      <color attach="background" args={[style.background]} />
      {style.fog && <fog attach="fog" args={[style.background, span * 1.6, span * 3.6]} />}
      {realism ? (
        <Suspense fallback={null}>
          <Environment files={HDRI_URL} />
        </Suspense>
      ) : (
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[0, 14, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[span, span, 1]} />
          <Lightformer form="rect" intensity={1} color="#dfe9ff" position={[span, 9, span * 0.4]} rotation={[0, -Math.PI / 2.4, 0]} scale={[span, span * 0.6, 1]} />
          <Lightformer form="rect" intensity={0.7} color="#ffe9c9" position={[-span, 8, -span * 0.4]} rotation={[0, Math.PI / 2.4, 0]} scale={[span, span * 0.6, 1]} />
        </Environment>
      )}
      <hemisphereLight args={style.lights.hemi} />
      <ambientLight intensity={style.lights.ambient} />
      <directionalLight
        castShadow
        color={style.lights.key[0]}
        position={[span * 0.5, span * 0.9, span * 0.4]}
        intensity={style.lights.key[1]}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight color={style.lights.fill[0]} position={[-span * 0.4, span * 0.6, -span * 0.3]} intensity={style.lights.fill[1]} />
      <ContactShadows position={[0, 0.04, 0]} scale={span * 1.4} resolution={1024} blur={2.6} opacity={0.3} far={14} frames={1} />

      {/* Building shell: grey tile floor plate flush with the glass curtain wall.
          Rooms add their own wood floors on top. */}
      <group>
        <mesh receiveShadow position={[0, -0.12, 0]}>
          <boxGeometry args={[layout.width, 0.2, layout.depth]} />
          <meshStandardMaterial color={style.corridor} roughness={0.85} metalness={0.02} />
        </mesh>
        <Wall axis="x" length={layout.width} height={2.9} doorWidth={0} glazed style={style} position={[0, 0, -layout.depth / 2]} />
        <Wall axis="x" length={layout.width} height={2.9} doorWidth={0} glazed style={style} position={[0, 0, layout.depth / 2]} />
        <Wall axis="z" length={layout.depth} height={2.9} doorWidth={0} glazed style={style} position={[-layout.width / 2, 0, 0]} />
        <Wall axis="z" length={layout.depth} height={2.9} doorWidth={0} glazed style={style} position={[layout.width / 2, 0, 0]} />
      </group>

      {layout.rooms.map((room) => (
        <Room key={room.key} room={room} style={style} realism={realism} labels={labels} />
      ))}
      {layout.benches.map((bench) => (
        <Bench key={bench.key} bench={bench} style={style} />
      ))}
      {layout.planters.map((planter, index) => (
        <Planter key={index} planter={planter} />
      ))}
      {layout.gameTables.map((table, index) => (
        <PingPong key={index} x={table.x} z={table.z} />
      ))}
      {layout.desks.map((desk) => (
        <Desk key={desk.botId} desk={desk} style={style} labels={labels} onSelect={onSelect} />
      ))}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        ref={(instance) => {
          onControls?.(instance as unknown as OfficeControls | null);
        }}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={14}
        maxDistance={span * 3}
      />
    </Canvas>
  );
}
