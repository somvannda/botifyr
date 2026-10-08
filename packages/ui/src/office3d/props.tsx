/**
 * Low-poly office furniture for the 3D scene.
 *
 * Pure presentation: every prop is a small group of primitives, so P1 needs no
 * external 3D assets. P2 (characters) will swap these for rigged models where it
 * matters; the props stay.
 *
 * Units are metres, and each prop sits on the floor (y = 0).
 */

interface PropProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
}

const WOOD = "#7a5c42";
const WOOD_DARK = "#5a4433";
const METAL = "#8d97a8";
const FABRIC = "#3b4256";
const LEAF = "#3f8f4f";
const LEAF_2 = "#4fa863";

/** Office task chair. Faces -Z by default (into the desk); backrest at +Z. */
export function Chair({ position, rotation }: PropProps) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow position={[0, 0.46, 0]}>
        <boxGeometry args={[0.52, 0.08, 0.52]} />
        <meshStandardMaterial color={FABRIC} roughness={0.85} />
      </mesh>
      <mesh castShadow position={[0, 0.78, 0.24]}>
        <boxGeometry args={[0.5, 0.58, 0.08]} />
        <meshStandardMaterial color={FABRIC} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
        <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.06, 12]} />
        <meshStandardMaterial color={METAL} metalness={0.4} roughness={0.5} />
      </mesh>
    </group>
  );
}

export function Plant({ position, rotation }: PropProps) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.2, 0.15, 0.32, 10]} />
        <meshStandardMaterial color="#b06a4a" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.3, 10, 8]} />
        <meshStandardMaterial color={LEAF} roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0.18, 0.82, 0.05]}>
        <sphereGeometry args={[0.2, 8, 6]} />
        <meshStandardMaterial color={LEAF_2} roughness={0.95} />
      </mesh>
      <mesh castShadow position={[-0.16, 0.78, -0.05]}>
        <sphereGeometry args={[0.18, 8, 6]} />
        <meshStandardMaterial color={LEAF} roughness={0.95} />
      </mesh>
    </group>
  );
}

export function Bookcase({ position, rotation }: PropProps) {
  const books = ["#c0554a", "#3f7cc0", "#d9a441", "#4fa863", "#8a6fd0"];
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow position={[0, 0.8, 0]}>
        <boxGeometry args={[1, 1.6, 0.34]} />
        <meshStandardMaterial color={WOOD} roughness={0.8} />
      </mesh>
      {[0.35, 0.75, 1.15].map((y) => (
        <mesh key={y} position={[0, y, 0.02]}>
          <boxGeometry args={[0.92, 0.06, 0.3]} />
          <meshStandardMaterial color={WOOD_DARK} roughness={0.8} />
        </mesh>
      ))}
      {books.map((color, index) => (
        <mesh key={color} castShadow position={[-0.32 + index * 0.16, 0.5, 0.08]}>
          <boxGeometry args={[0.1, 0.28, 0.2]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** A wall-mounted whiteboard / display. Faces +Z by default. */
export function WallScreen({ position, rotation, width = 2.4 }: PropProps & { width?: number }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[width, 1.4, 0.08]} />
        <meshStandardMaterial color="#e8edf6" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <boxGeometry args={[width - 0.16, 1.24, 0.02]} />
        <meshStandardMaterial color="#d8e3f0" roughness={0.4} />
      </mesh>
    </group>
  );
}

export function WaterCooler({ position }: PropProps) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.4, 0]}>
        <boxGeometry args={[0.36, 0.8, 0.36]} />
        <meshStandardMaterial color="#cfd6e2" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0, 1, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.36, 12]} />
        <meshStandardMaterial color="#8fd3ff" transparent opacity={0.7} roughness={0.2} />
      </mesh>
    </group>
  );
}

export function CoffeeTable({ position, rotation }: PropProps) {
  const legs: Array<[number, number]> = [
    [-0.55, -0.28],
    [0.55, -0.28],
    [-0.55, 0.28],
    [0.55, 0.28],
  ];
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow position={[0, 0.4, 0]}>
        <boxGeometry args={[1.3, 0.08, 0.7]} />
        <meshStandardMaterial color={WOOD} roughness={0.6} />
      </mesh>
      {legs.map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.2, z]}>
          <boxGeometry args={[0.06, 0.4, 0.06]} />
          <meshStandardMaterial color={WOOD_DARK} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/** Lobby reception desk. Faces +Z (toward arriving visitors) by default. */
export function ReceptionDesk({ position, rotation }: PropProps) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[2.6, 1, 0.7]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0, 1.05, 0]}>
        <boxGeometry args={[2.9, 0.1, 0.9]} />
        <meshStandardMaterial color="#8a6a4c" roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Framed wall art. Faces +Z by default. */
export function Picture({
  position,
  rotation,
  color = "#5b7fd6",
  width = 0.9,
  height = 0.68,
}: PropProps & { color?: string; width?: number; height?: number }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[width, height, 0.05]} />
        <meshStandardMaterial color="#3a4152" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[width - 0.12, height - 0.12, 0.02]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
    </group>
  );
}

export function CoffeeMachine({ position, rotation }: PropProps) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow position={[0, 0.45, 0]}>
        <boxGeometry args={[0.6, 0.9, 0.5]} />
        <meshStandardMaterial color="#4a5163" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.52, 0.27]}>
        <boxGeometry args={[0.3, 0.3, 0.06]} />
        <meshStandardMaterial color="#8fd3ff" emissive="#2a6d94" emissiveIntensity={0.5} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.14, 0.3]}>
        <boxGeometry args={[0.24, 0.1, 0.12]} />
        <meshStandardMaterial color="#2a2f3d" roughness={0.6} />
      </mesh>
    </group>
  );
}

/** A small desk lamp; sits on the desk surface (y = 0.77). */
export function DeskLamp({ position }: PropProps) {
  return (
    <group position={position}>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.06, 10]} />
        <meshStandardMaterial color="#2f3546" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.4, 8]} />
        <meshStandardMaterial color="#2f3546" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh castShadow position={[0.08, 0.44, 0]} rotation={[0, 0, -0.5]}>
        <coneGeometry args={[0.12, 0.16, 12]} />
        <meshStandardMaterial
          color="#3a4152"
          emissive="#ffd9a0"
          emissiveIntensity={0.35}
          metalness={0.4}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}
