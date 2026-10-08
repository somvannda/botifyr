/**
 * The 3D office scene (P1): a dollhouse view of the building.
 *
 * Loaded lazily — importing this module pulls in three.js, which must never be
 * part of the main bundle. The whole look (palette, lighting, camera) comes from
 * an `OfficeStyle` (see theme.ts), so the same model can be rendered in several
 * art directions. Characters arrive in P2.
 */

import { Suspense, useEffect } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls } from "@react-three/drei";
import { activityColor, type DeskLayout, type OfficeLayout, type RoomLayout } from "./layout";
import { Prop } from "./assets";
import { HDRI_URL, useFloorMaps } from "./textures";
import {
  DEFAULT_OFFICE_STYLE,
  DOOR_HEIGHT,
  GLASS,
  OFFICE3D,
  OFFICE_STYLES,
  mix,
  type OfficeStyle,
  type OfficeStyleId,
} from "./theme";
import {
  Bookcase,
  Chair,
  CoffeeMachine,
  DeskLamp,
  Picture,
  Plant,
  ReceptionDesk,
  WallScreen,
  WaterCooler,
} from "./props";

const FRAME = GLASS.frameThickness;

/** Styles that use the real HDRI + wood PBR floors rather than flat colors. */
const REALISM_STYLES = new Set<OfficeStyleId>(["iso", "nordic", "cartoon", "comic", "mono"]);

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

/**
 * A partition wall with a centred doorway: two panes either side of the opening,
 * metal top/bottom rails, vertical mullions, door frame posts and (when the wall
 * is tall enough) a transom above the door. `glazed` swaps glass for solid.
 */
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
  const lintelHeight = height - DOOR_HEIGHT;
  const lintelArgs: [number, number, number] =
    axis === "x" ? [gap, lintelHeight, thickness] : [thickness, lintelHeight, gap];

  const place = (along: number, y: number): [number, number, number] =>
    axis === "x" ? [along, y, 0] : [0, y, along];

  const mullions: number[] = [];
  const divisions = Math.max(1, Math.round(length / 2.4));
  for (let i = 0; i <= divisions; i += 1) {
    const along = -length / 2 + (length * i) / divisions;
    if (Math.abs(along) <= gap / 2 + 0.01) continue;
    mullions.push(along);
  }

  return (
    <group position={position}>
      <mesh position={place(-offset, height / 2)}>
        <boxGeometry args={paneArgs} />
        <PaneMaterial style={style} glazed={glazed} />
      </mesh>
      <mesh position={place(offset, height / 2)}>
        <boxGeometry args={paneArgs} />
        <PaneMaterial style={style} glazed={glazed} />
      </mesh>

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

      {[-gap / 2, gap / 2].map((along) => (
        <mesh key={`d${along}`} castShadow position={place(along, height / 2)}>
          <boxGeometry args={postArgs} />
          <FrameMaterial style={style} />
        </mesh>
      ))}

      {lintelHeight > 0.2 && (
        <mesh position={[0, DOOR_HEIGHT + lintelHeight / 2, 0]}>
          <boxGeometry args={lintelArgs} />
          <PaneMaterial style={style} glazed={glazed} />
        </mesh>
      )}
    </group>
  );
}

function Boardroom({ width, depth }: { width: number; depth: number }) {
  const tableW = Math.min(width - 4.5, 10);
  const tableD = Math.min(depth - 3.4, 1.6);
  const chairXs = [-tableW / 2 + 1.2, -tableW / 6, tableW / 6, tableW / 2 - 1.2];
  return (
    <group>
      <mesh castShadow position={[0, 0.74, 0]}>
        <boxGeometry args={[tableW, 0.12, tableD]} />
        <meshStandardMaterial color="#8a6a4c" roughness={0.5} metalness={0.05} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} castShadow position={[0, 0.36, side * (tableD / 2 - 0.2)]}>
          <boxGeometry args={[tableW * 0.5, 0.6, 0.12]} />
          <meshStandardMaterial color="#6f563e" roughness={0.6} />
        </mesh>
      ))}
      {chairXs.flatMap((x) =>
        [-1, 1].map((side) => (
          <mesh key={`${x}:${side}`} castShadow position={[x, 0.28, side * (tableD / 2 + 0.55)]}>
            <boxGeometry args={[0.5, 0.56, 0.5]} />
            <meshStandardMaterial color="#3b4256" roughness={0.8} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Gym({ width }: { width: number }) {
  const left = -width / 2;
  const right = width / 2;
  return (
    <group>
      <mesh castShadow position={[left + 2.4, 0.3, -1.6]}>
        <boxGeometry args={[3, 0.6, 1]} />
        <meshStandardMaterial color="#4a5163" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[left + 5.6, 0.3, -1.6]}>
        <boxGeometry args={[3, 0.6, 1]} />
        <meshStandardMaterial color="#4a5163" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[right - 2.4, 0.35, 1.6]}>
        <boxGeometry args={[2.2, 0.7, 1]} />
        <meshStandardMaterial color="#3a4152" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[right - 5.6, 0.6, 1.4]}>
        <boxGeometry args={[1.6, 1.2, 0.7]} />
        <meshStandardMaterial color="#55607a" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.03, 0.6]}>
        <boxGeometry args={[3, 0.06, 2]} />
        <meshStandardMaterial color="#4a7f6a" roughness={0.95} />
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
          <boxGeometry args={[2.4, 0.64, 1]} />
          <meshStandardMaterial color="#5d7a63" roughness={0.85} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.25, -1.8]}>
        <boxGeometry args={[2, 0.5, 0.8]} />
        <meshStandardMaterial color="#4f6a55" roughness={0.85} />
      </mesh>
    </group>
  );
}

function CoffeeTable() {
  const legs: Array<[number, number]> = [
    [-0.55, -0.28],
    [0.55, -0.28],
    [-0.55, 0.28],
    [0.55, 0.28],
  ];
  return (
    <group position={[0, 0, 0.2]}>
      <mesh castShadow position={[0, 0.4, 0]}>
        <boxGeometry args={[1.3, 0.08, 0.7]} />
        <meshStandardMaterial color="#8a6a4c" roughness={0.6} />
      </mesh>
      {legs.map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.2, z]}>
          <boxGeometry args={[0.06, 0.4, 0.06]} />
          <meshStandardMaterial color="#6f563e" roughness={0.7} />
        </mesh>
      ))}
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
        <CoffeeTable />
        <Plant position={[halfW - 0.7, 0, -halfD + 0.7]} />
        <CoffeeMachine position={[halfW - 0.9, 0, halfD - 0.7]} rotation={[0, -Math.PI / 2, 0]} />
      </group>
    );
  }
  if (room.kind === "gym") {
    return (
      <group>
        <Plant position={[halfW - 0.7, 0, -halfD + 0.7]} />
        <WaterCooler position={[-halfW + 0.5, 0, -halfD + 0.5]} />
      </group>
    );
  }
  if (room.kind === "lobby") {
    return (
      <group>
        <ReceptionDesk position={[0, 0, -halfD + 0.8]} />
        <Chair position={[0, 0, -halfD + 2.1]} />
        <Plant position={[halfW - 0.7, 0, halfD - 0.7]} />
        <Plant position={[-halfW + 0.7, 0, halfD - 0.7]} />
        <CoffeeMachine position={[-halfW + 0.6, 0, -halfD + 0.6]} rotation={[0, Math.PI / 2, 0]} />
      </group>
    );
  }
  if (room.kind === "meeting") {
    return (
      <group>
        <WallScreen position={[-halfW + 2.2, 1.6, -halfD + 0.2]} width={3} />
        <Plant position={[halfW - 0.7, 0, -halfD + 0.7]} />
        <Plant position={[-halfW + 0.7, 0, halfD - 0.7]} />
      </group>
    );
  }
  return (
    <group>
      <WallScreen position={[-1.6, 1.6, -halfD + 0.2]} width={2.2} />
      <Prop kind="plantLarge" position={[halfW - 0.7, 0, halfD - 0.7]}>
        <Plant />
      </Prop>
      <Bookcase position={[halfW - 0.9, 0, -halfD + 0.45]} />
      <WaterCooler position={[-halfW + 0.5, 0, -halfD + 0.5]} />
    </group>
  );
}

function Corridor({ width, depth, style }: { width: number; depth: number; style: OfficeStyle }) {
  return (
    <group>
      <mesh receiveShadow position={[0, -0.16, 0]}>
        <boxGeometry args={[width + OFFICE3D.corridor, 0.2, depth + OFFICE3D.corridor]} />
        <meshStandardMaterial color={style.corridor} roughness={0.95} metalness={0} />
      </mesh>
      <mesh receiveShadow position={[0, -0.03, 0]}>
        <boxGeometry args={[width + OFFICE3D.corridor * 0.5, 0.02, depth + OFFICE3D.corridor * 0.5]} />
        <meshStandardMaterial color={style.corridorRunner} roughness={0.9} metalness={0} />
      </mesh>
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

function Room({ room, style, realism }: { room: RoomLayout; style: OfficeStyle; realism: boolean }) {
  const thickness = OFFICE3D.wallThickness;
  const height = OFFICE3D.wallHeight;
  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  return (
    <group position={[room.x, 0, room.z]}>
      {realism ? (
        <Suspense fallback={null}>
          <TexturedFloor width={room.width} depth={room.depth} />
        </Suspense>
      ) : (
        <mesh receiveShadow position={[0, -0.1, 0]}>
          <boxGeometry args={[room.width, 0.2, room.depth]} />
          <meshStandardMaterial color={style.floor} roughness={0.75} metalness={0.03} />
        </mesh>
      )}
      <mesh receiveShadow position={[0, 0.012, 0.25]}>
        <boxGeometry args={[room.width * 0.52, 0.02, room.depth * 0.46]} />
        <meshStandardMaterial color={mix(room.color, style.rug.target, style.rug.amount)} roughness={0.96} />
      </mesh>
      <mesh position={[-halfW + thickness + 0.02, 1.35, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[room.depth * 0.46, 2.2, 0.04]} />
        <meshStandardMaterial color={mix(room.color, style.accent.target, style.accent.amount)} roughness={0.9} />
      </mesh>
      <Picture
        color={room.color}
        position={[halfW - thickness - 0.03, 1.5, 0.7]}
        rotation={[0, -Math.PI / 2, 0]}
      />

      <Wall
        axis="x"
        length={room.width}
        height={height}
        doorWidth={OFFICE3D.doorWidth}
        glazed={room.glazed}
        style={style}
        position={[0, 0, -halfD + thickness / 2]}
      />
      <Wall
        axis="z"
        length={room.depth}
        height={height}
        doorWidth={OFFICE3D.doorWidth}
        glazed={room.glazed}
        style={style}
        position={[-halfW + thickness / 2, 0, 0]}
      />
      <Wall
        axis="z"
        length={room.depth}
        height={height}
        doorWidth={OFFICE3D.doorWidth}
        glazed={room.glazed}
        style={style}
        position={[halfW - thickness / 2, 0, 0]}
      />
      <Wall
        axis="x"
        length={room.width}
        height={OFFICE3D.lowWallHeight}
        doorWidth={OFFICE3D.doorWidth}
        glazed={room.glazed}
        style={style}
        position={[0, 0, halfD - thickness / 2]}
      />

      {room.kind === "meeting" && <Boardroom width={room.width} depth={room.depth} />}
      {room.kind === "gym" && <Gym width={room.width} />}
      {room.kind === "lounge" && <Lounge width={room.width} />}
      <RoomFurniture room={room} />

      <Html
        center
        distanceFactor={30}
        position={[0, height + 0.35, -halfD + 0.3]}
        className="office3d-room-label"
      >
        <span style={{ background: room.color }}>{room.label}</span>
      </Html>
    </group>
  );
}

const DESK_LEGS: Array<[number, number]> = [
  [-0.7, -0.38],
  [0.7, -0.38],
  [-0.7, 0.38],
  [0.7, 0.38],
];

function Desk({
  desk,
  style,
  onSelect,
}: {
  desk: DeskLayout;
  style: OfficeStyle;
  onSelect?: (botId: string) => void;
}) {
  const status = activityColor(desk.agent.activity);
  return (
    <group position={[desk.x, 0, desk.z]}>
      <mesh castShadow position={[0, 0.72, 0]}>
        <boxGeometry args={[1.6, 0.09, 0.9]} />
        <meshStandardMaterial color={style.desk} roughness={0.6} metalness={0.04} />
      </mesh>
      {DESK_LEGS.map(([legX, legZ]) => (
        <mesh key={`${legX}:${legZ}`} position={[legX, 0.36, legZ]}>
          <boxGeometry args={[0.08, 0.72, 0.08]} />
          <meshStandardMaterial color="#9aa3b5" roughness={0.6} metalness={0.1} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 1.02, -0.24]}>
        <boxGeometry args={[0.72, 0.46, 0.06]} />
        <meshStandardMaterial
          color={style.monitor.color}
          emissive={style.monitor.color}
          emissiveIntensity={style.monitor.emissive}
          roughness={0.4}
          metalness={0.25}
        />
      </mesh>
      <mesh position={[0, 0.85, -0.16]}>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color="#3a4152" roughness={0.5} />
      </mesh>
      <DeskLamp position={[-0.55, 0.765, 0.1]} />
      <Chair position={[0, 0, 0.95]} />
      <Html
        center
        distanceFactor={26}
        position={[0, 1.8, 0]}
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
    </group>
  );
}

/** Filmic tone-mapping so the lighting reads photographic rather than flat. */
function RendererSetup() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
  }, [gl]);
  return null;
}

/** Fits an orthographic camera to the office, so the view reads architectural. */
function CameraRig({ span, ortho }: { span: number; ortho: boolean }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  useEffect(() => {
    if (!ortho) return;
    const cam = camera as THREE.OrthographicCamera;
    cam.zoom = size.height / (span * 1.18);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height, span, ortho]);
  return null;
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
  styleId = DEFAULT_OFFICE_STYLE,
  onSelect,
  onControls,
}: {
  layout: OfficeLayout;
  styleId?: OfficeStyleId;
  onSelect?: (botId: string) => void;
  onControls?: (controls: OfficeControls | null) => void;
}) {
  const style = OFFICE_STYLES[styleId];
  const realism = REALISM_STYLES.has(styleId);
  const span = Math.max(layout.width, layout.depth);
  const ortho = style.projection === "orthographic";
  const cameraY = span * style.camera.lift + 10;
  const cameraZ = span * style.camera.pull + 12;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      orthographic={ortho}
      gl={{ antialias: true }}
      camera={
        ortho
          ? { position: [span * 0.04, span * 1.15, span * 0.82], near: -1000, far: 3000, zoom: 1 }
          : { position: [0, cameraY, cameraZ], fov: style.camera.fov, near: 0.1, far: 900 }
      }
    >
      <RendererSetup />
      <CameraRig span={span} ortho={ortho} />
      <color attach="background" args={[style.background]} />
      {style.fog && <fog attach="fog" args={[style.background, span * 1.7, span * 3.8]} />}
      {/* Real CC0 HDRI for image-based lighting on organic styles; baked
          lightformers for the dark/neon looks so they stay moody. */}
      {realism ? (
        <Suspense fallback={null}>
          <Environment files={HDRI_URL} />
        </Suspense>
      ) : (
        <Environment resolution={256} frames={1}>
          <Lightformer
            form="rect"
            intensity={2.2}
            color="#ffffff"
            position={[0, 14, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[span, span, 1]}
          />
          <Lightformer
            form="rect"
            intensity={1}
            color="#dfe9ff"
            position={[span, 9, span * 0.4]}
            rotation={[0, -Math.PI / 2.4, 0]}
            scale={[span, span * 0.6, 1]}
          />
          <Lightformer
            form="rect"
            intensity={0.7}
            color="#ffe9c9"
            position={[-span, 8, -span * 0.4]}
            rotation={[0, Math.PI / 2.4, 0]}
            scale={[span, span * 0.6, 1]}
          />
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
      <directionalLight
        color={style.lights.fill[0]}
        position={[-span * 0.4, span * 0.6, -span * 0.3]}
        intensity={style.lights.fill[1]}
      />
      <ContactShadows
        position={[0, 0.03, 0]}
        scale={span * 1.7}
        resolution={1024}
        blur={2.6}
        opacity={0.32}
        far={14}
        frames={1}
      />
      <Corridor width={layout.width} depth={layout.depth} style={style} />
      {style.grid && <gridHelper args={[span * 1.9, 30, style.grid, style.grid]} position={[0, -0.02, 0]} />}
      {layout.rooms.map((room) => (
        <Room key={room.key} room={room} style={style} realism={realism} />
      ))}
      {layout.desks.map((desk) => (
        <Desk key={desk.botId} desk={desk} style={style} onSelect={onSelect} />
      ))}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        ref={(instance) => {
          onControls?.(instance as unknown as OfficeControls | null);
        }}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={8}
        maxDistance={span * 3.2}
      />
    </Canvas>
  );
}
