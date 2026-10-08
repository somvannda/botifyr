/* @refresh reset */
/**
 * The 3D office scene (P1): a dollhouse view of the building.
 *
 * Loaded lazily — importing this module pulls in three.js, which must never be
 * part of the main bundle. Rooms are glass partitions (transparent panes in a
 * metal frame) with real doorway openings onto the corridors that run between
 * every room. Characters arrive in P2; today each employee is a desk with a name
 * tag and a live status marker.
 */

import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { activityColor, type DeskLayout, type OfficeLayout, type RoomLayout } from "./layout";
import { DOOR_HEIGHT, GLASS, OFFICE3D } from "./theme";
import { Bookcase, Chair, CoffeeTable, Plant, ReceptionDesk, WallScreen, WaterCooler } from "./props";

const FRAME = GLASS.frameThickness;

function FrameMaterial() {
  return <meshStandardMaterial color={GLASS.frame} metalness={0.6} roughness={0.35} />;
}

function GlassMaterial() {
  return (
    <meshStandardMaterial
      color={GLASS.color}
      transparent
      opacity={GLASS.opacity}
      roughness={GLASS.roughness}
      metalness={GLASS.metalness}
      depthWrite={false}
    />
  );
}

function PaneMaterial({ glazed }: { glazed: boolean }) {
  if (glazed) return <GlassMaterial />;
  return <meshStandardMaterial color="#e7ecf6" roughness={0.9} metalness={0.02} />;
}

/**
 * A partition wall with a centred doorway. Renders the two panes either
 * side of the opening, a metal top/bottom rail, vertical mullions, the door
 * frame posts, and (when the wall is tall enough) a transom above the door.
 * `glazed` swaps the panes between glass and solid.
 */
function Wall({
  axis,
  length,
  height,
  doorWidth,
  glazed,
  position,
}: {
  axis: "x" | "z";
  length: number;
  height: number;
  doorWidth: number;
  glazed: boolean;
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
        <PaneMaterial glazed={glazed} />
      </mesh>
      <mesh position={place(offset, height / 2)}>
        <boxGeometry args={paneArgs} />
        <PaneMaterial glazed={glazed} />
      </mesh>

      <mesh castShadow position={[0, height - FRAME / 2, 0]}>
        <boxGeometry args={railArgs} />
        <FrameMaterial />
      </mesh>
      <mesh castShadow position={[0, FRAME / 2, 0]}>
        <boxGeometry args={railArgs} />
        <FrameMaterial />
      </mesh>

      {mullions.map((along) => (
        <mesh key={`m${along}`} castShadow position={place(along, height / 2)}>
          <boxGeometry args={postArgs} />
          <FrameMaterial />
        </mesh>
      ))}

      {[-gap / 2, gap / 2].map((along) => (
        <mesh key={`d${along}`} castShadow position={place(along, height / 2)}>
          <boxGeometry args={postArgs} />
          <FrameMaterial />
        </mesh>
      ))}

      {lintelHeight > 0.2 && (
        <mesh position={[0, DOOR_HEIGHT + lintelHeight / 2, 0]}>
          <boxGeometry args={lintelArgs} />
          <PaneMaterial glazed={glazed} />
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
        <meshStandardMaterial color="#6b5b4a" roughness={0.55} metalness={0.05} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} castShadow position={[0, 0.36, side * (tableD / 2 - 0.2)]}>
          <boxGeometry args={[tableW * 0.5, 0.6, 0.12]} />
          <meshStandardMaterial color="#5a4c3d" roughness={0.6} />
        </mesh>
      ))}
      {chairXs.flatMap((x) =>
        [-1, 1].map((side) => (
          <mesh key={`${x}:${side}`} castShadow position={[x, 0.28, side * (tableD / 2 + 0.55)]}>
            <boxGeometry args={[0.5, 0.56, 0.5]} />
            <meshStandardMaterial color="#3a4152" roughness={0.8} />
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
      {/* treadmills */}
      <mesh castShadow position={[left + 2.4, 0.3, -1.6]}>
        <boxGeometry args={[3, 0.6, 1]} />
        <meshStandardMaterial color="#4a5163" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[left + 5.6, 0.3, -1.6]}>
        <boxGeometry args={[3, 0.6, 1]} />
        <meshStandardMaterial color="#4a5163" roughness={0.7} />
      </mesh>
      {/* bench + rack */}
      <mesh castShadow position={[right - 2.4, 0.35, 1.6]}>
        <boxGeometry args={[2.2, 0.7, 1]} />
        <meshStandardMaterial color="#3a4152" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[right - 5.6, 0.6, 1.4]}>
        <boxGeometry args={[1.6, 1.2, 0.7]} />
        <meshStandardMaterial color="#55607a" roughness={0.7} />
      </mesh>
      {/* yoga mats */}
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
          <meshStandardMaterial color="#5b7a5b" roughness={0.85} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.25, -1.8]}>
        <boxGeometry args={[2, 0.5, 0.8]} />
        <meshStandardMaterial color="#4f6a4f" roughness={0.85} />
      </mesh>
    </group>
  );
}

function Corridor({ width, depth }: { width: number; depth: number }) {
  return (
    <group>
      <mesh receiveShadow position={[0, -0.16, 0]}>
        <boxGeometry args={[width + OFFICE3D.corridor, 0.2, depth + OFFICE3D.corridor]} />
        <meshStandardMaterial color="#39425a" roughness={0.95} metalness={0} />
      </mesh>
      {/* A lighter inset runner so the hallways read as one connected floor. */}
      <mesh receiveShadow position={[0, -0.03, 0]}>
        <boxGeometry args={[width + OFFICE3D.corridor * 0.5, 0.02, depth + OFFICE3D.corridor * 0.5]} />
        <meshStandardMaterial color="#4a5573" roughness={0.9} metalness={0} />
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
        <CoffeeTable position={[0, 0, 0.2]} />
        <Plant position={[halfW - 0.7, 0, -halfD + 0.7]} />
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
  // Department room: whiteboard, corner plant, bookcase and a water cooler.
  return (
    <group>
      <WallScreen position={[-1.6, 1.6, -halfD + 0.2]} width={2.2} />
      <Plant position={[halfW - 0.7, 0, halfD - 0.7]} />
      <Bookcase position={[halfW - 0.9, 0, -halfD + 0.45]} />
      <WaterCooler position={[-halfW + 0.5, 0, -halfD + 0.5]} />
    </group>
  );
}

function Room({ room }: { room: RoomLayout }) {
  const thickness = OFFICE3D.wallThickness;
  const height = OFFICE3D.wallHeight;
  return (
    <group position={[room.x, 0, room.z]}>
      <mesh receiveShadow position={[0, -0.1, 0]}>
        <boxGeometry args={[room.width, 0.2, room.depth]} />
        <meshStandardMaterial color={room.color} roughness={0.95} metalness={0} />
      </mesh>

      {/* Back wall — full height with a doorway onto the corridor behind. */}
      <Wall
        axis="x"
        length={room.width}
        height={height}
        doorWidth={OFFICE3D.doorWidth}
        glazed={room.glazed}
        position={[0, 0, -room.depth / 2 + thickness / 2]}
      />
      {/* Side walls — with doorways into the side corridors. */}
      <Wall
        axis="z"
        length={room.depth}
        height={height}
        doorWidth={OFFICE3D.doorWidth}
        glazed={room.glazed}
        position={[-room.width / 2 + thickness / 2, 0, 0]}
      />
      <Wall
        axis="z"
        length={room.depth}
        height={height}
        doorWidth={OFFICE3D.doorWidth}
        glazed={room.glazed}
        position={[room.width / 2 - thickness / 2, 0, 0]}
      />
      {/* Near wall — kept low so the dollhouse view stays open, with a doorway. */}
      <Wall
        axis="x"
        length={room.width}
        height={OFFICE3D.lowWallHeight}
        doorWidth={OFFICE3D.doorWidth}
        glazed={room.glazed}
        position={[0, 0, room.depth / 2 - thickness / 2]}
      />

      {room.kind === "meeting" && <Boardroom width={room.width} depth={room.depth} />}
      {room.kind === "gym" && <Gym width={room.width} />}
      {room.kind === "lounge" && <Lounge width={room.width} />}
      <RoomFurniture room={room} />

      <Html
        center
        distanceFactor={30}
        position={[0, height + 0.35, -room.depth / 2 + 0.3]}
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

function Desk({ desk, onSelect }: { desk: DeskLayout; onSelect?: (botId: string) => void }) {
  const status = activityColor(desk.agent.activity);
  return (
    <group position={[desk.x, 0, desk.z]}>
      <mesh castShadow position={[0, 0.72, 0]}>
        <boxGeometry args={[1.6, 0.09, 0.9]} />
        <meshStandardMaterial color="#d9dee9" roughness={0.7} metalness={0.05} />
      </mesh>
      {DESK_LEGS.map(([legX, legZ]) => (
        <mesh key={`${legX}:${legZ}`} position={[legX, 0.36, legZ]}>
          <boxGeometry args={[0.08, 0.72, 0.08]} />
          <meshStandardMaterial color="#9aa3b5" roughness={0.6} metalness={0.1} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 1.02, -0.24]}>
        <boxGeometry args={[0.72, 0.46, 0.06]} />
        <meshStandardMaterial color="#232838" roughness={0.4} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.85, -0.16]}>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color="#3a4152" roughness={0.5} />
      </mesh>
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
  onSelect,
  onControls,
}: {
  layout: OfficeLayout;
  onSelect?: (botId: string) => void;
  onControls?: (controls: OfficeControls | null) => void;
}) {
  const span = Math.max(layout.width, layout.depth);
  const cameraY = span * 0.85 + 10;
  const cameraZ = span * 0.9 + 12;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, cameraY, cameraZ], fov: 45, near: 0.1, far: 900 }}
    >
      <color attach="background" args={["#0e1320"]} />
      <fog attach="fog" args={["#0e1320", span * 1.6, span * 3.6]} />
      <hemisphereLight args={["#ffffff", "#3a4256", 0.9]} />
      <ambientLight intensity={0.45} />
      <directionalLight
        castShadow
        position={[span * 0.5, span * 0.9, span * 0.4]}
        intensity={1.15}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <Corridor width={layout.width} depth={layout.depth} />
      {layout.rooms.map((room) => (
        <Room key={room.key} room={room} />
      ))}
      {layout.desks.map((desk) => (
        <Desk key={desk.botId} desk={desk} onSelect={onSelect} />
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
