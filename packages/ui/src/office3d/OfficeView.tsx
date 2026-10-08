/* @refresh reset */
/**
 * Lazy entry point for the 3D office overlay.
 *
 * Default export so `BotifyrApp` can `React.lazy(() => import(...))` it and keep
 * three.js out of the initial bundle. The overlay is pure presentation — the
 * host app owns all data and close/select behaviour.
 */

import { useMemo, useRef, useState } from "react";
import { buildOfficeLayout, type LayoutAgent } from "./layout";
import { OfficeScene, type OfficeControls } from "./OfficeScene";
import type { OfficeStyleId } from "./theme";

export type OfficeAgent = LayoutAgent;

export interface OfficeViewProps {
  /** Company name, shown in the header. */
  company: string;
  /** Every employee in the company, with their live activity. */
  agents: OfficeAgent[];
  /** True when the company is paused (schedules off). */
  paused?: boolean;
  /** Render as a docked side panel (default) or a floating full-screen overlay. */
  docked?: boolean;
  /** Which art direction to render (see theme.ts OFFICE_STYLES). */
  style?: OfficeStyleId;
  /** Switch between docked and floating. The button shows only when provided. */
  onToggleDock?: () => void;
  onClose: () => void;
  /** Called with a bot id when the CEO clicks an employee. */
  onSelect?: (botId: string) => void;
}

function detectWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Move the camera along the view direction to zoom the orbit controls. */
function zoomBy(controls: OfficeControls | null, factor: number): void {
  if (!controls) return;
  const camera = controls.object;
  const { target } = controls;
  camera.position.set(
    target.x + (camera.position.x - target.x) * factor,
    target.y + (camera.position.y - target.y) * factor,
    target.z + (camera.position.z - target.z) * factor,
  );
  controls.update();
}

export default function OfficeView({
  company,
  agents,
  paused,
  docked = false,
  style,
  onToggleDock,
  onClose,
  onSelect,
}: OfficeViewProps) {
  const [webgl] = useState(detectWebGL);
  const controlsRef = useRef<OfficeControls | null>(null);
  const layout = useMemo(() => buildOfficeLayout(agents), [agents]);

  const departmentRooms = layout.rooms.filter((room) => room.department);
  const working = agents.filter(
    (agent) => agent.activity === "running" || agent.activity === "awaiting_approval",
  ).length;

  return (
    <div
      className={docked ? "office3d-dock-root" : "office3d-overlay"}
      onClick={docked ? undefined : onClose}
      role="presentation"
    >
      <div
        className={`office3d-panel${docked ? " office3d-panel-docked" : ""}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={`${company} live office`}
      >
        <div className="office3d-head">
          <div className="office3d-headings">
            <span className="office3d-title">{company} — Live office</span>
            <span className="office3d-sub">
              {agents.length} employee{agents.length === 1 ? "" : "s"} · {working} working
              {paused ? " · company paused" : ""}
            </span>
          </div>
          <div className="office3d-head-actions">
            {onToggleDock && (
              <button
                className="ghost small"
                type="button"
                onClick={onToggleDock}
                title={docked ? "Float over the chat" : "Dock beside the chat"}
              >
                {docked ? "⤢ Float" : "⇥ Dock"}
              </button>
            )}
            <button className="round small" type="button" onClick={onClose} aria-label="Close the 3D office">
              ✕
            </button>
          </div>
        </div>

        <div className="office3d-stage">
          {webgl ? (
            <>
              <OfficeScene
                layout={layout}
                styleId={style}
                onSelect={onSelect}
                onControls={(instance) => {
                  controlsRef.current = instance;
                }}
              />
              <div className="office3d-controls">
                <button type="button" onClick={() => zoomBy(controlsRef.current, 0.75)} aria-label="Zoom in">
                  +
                </button>
                <button type="button" onClick={() => zoomBy(controlsRef.current, 1.33)} aria-label="Zoom out">
                  −
                </button>
                <button
                  type="button"
                  onClick={() => controlsRef.current?.reset()}
                  aria-label="Reset the view"
                >
                  ⌂
                </button>
              </div>
              <div className="office3d-hint">
                Drag to move · right-drag to rotate · scroll to zoom · arrows/WASD pan · Q/E rotate
              </div>
            </>
          ) : (
            <div className="office3d-fallback">
              <p>3D preview needs WebGL, which this device doesn&apos;t provide.</p>
              <p className="company-hint">The Office tab still lists every employee.</p>
            </div>
          )}
        </div>

        <div className="office3d-legend">
          {departmentRooms.map((room) => (
            <span key={room.key} className="office3d-chip">
              <i style={{ background: room.color }} />
              {room.label}
              <b>{room.agents.length}</b>
            </span>
          ))}
          {departmentRooms.length === 0 && (
            <span className="company-hint">No employees yet — hire a team to populate the office.</span>
          )}
        </div>
      </div>
    </div>
  );
}
