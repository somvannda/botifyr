/**
 * Dev-only preview of the 3D office with real assets (GLB chair + animated
 * humans). Renders one style at a time with a switcher, using the shared scene.
 *
 * Open: http://localhost:1421/office-preview.html  or  ?style=tech
 */

import { useState } from "react";
import ReactDOM from "react-dom/client";
import { OfficeScene } from "../../../packages/ui/src/office3d/OfficeScene";
import { buildOfficeLayout, type LayoutAgent } from "../../../packages/ui/src/office3d/layout";
import { OFFICE_STYLES, type OfficeStyleId } from "../../../packages/ui/src/office3d/theme";
import "@botifyr/ui/styles.css";
import "./portal.css";

const AGENTS: LayoutAgent[] = [
  { botId: "1", name: "Maya", emoji: "🦊", title: "CEO", department: "exec", activity: "running" },
  { botId: "2", name: "Leo", emoji: "🐻", title: "CTO", department: "engineering", activity: "running" },
  { botId: "3", name: "Nora", emoji: "🐼", title: "QA Engineer", department: "engineering", activity: "awaiting_approval" },
  { botId: "4", name: "Sam", emoji: "🦉", title: "Product Manager", department: "product", activity: "running" },
  { botId: "5", name: "Ivy", emoji: "🐨", title: "UX Designer", department: "design", activity: "queued" },
  { botId: "6", name: "Ravi", emoji: "🐧", title: "Growth Lead", department: "growth", activity: "running" },
  { botId: "7", name: "Ava", emoji: "🦄", title: "Content Marketer", department: "marketing", activity: "idle" },
  { botId: "8", name: "Kai", emoji: "🐯", title: "Account Executive", department: "sales", activity: "completed" },
  { botId: "9", name: "Zoe", emoji: "🐸", title: "Support Lead", department: "support", activity: "running" },
  { botId: "10", name: "Milo", emoji: "🐵", title: "Data Analyst", department: "data", activity: "idle" },
  { botId: "11", name: "Luna", emoji: "🐙", title: "AI Engineer", department: "ai", activity: "running" },
  { botId: "12", name: "Theo", emoji: "🦁", title: "Ops Manager", department: "ops", activity: "failed" },
];

const layout = buildOfficeLayout(AGENTS);
const ALL = Object.keys(OFFICE_STYLES) as OfficeStyleId[];

function Preview() {
  const requested = new URLSearchParams(window.location.search).get("style") as OfficeStyleId | null;
  const [style, setStyle] = useState<OfficeStyleId>(
    requested && ALL.includes(requested) ? requested : "nordic",
  );

  return (
    <div
      style={{
        position: "relative",
        height: "100vh",
        background: "#0b0d12",
        color: "#ececef",
        fontFamily: "system-ui, Segoe UI, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          zIndex: 2,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          maxWidth: "64%",
        }}
      >
        {ALL.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setStyle(id)}
            style={{
              fontSize: 12,
              padding: "3px 9px",
              borderRadius: 8,
              border: "1px solid #333",
              cursor: "pointer",
              background: id === style ? "#6d8bff" : "rgba(10,14,24,0.72)",
              color: "#fff",
            }}
          >
            {OFFICE_STYLES[id].label}
          </button>
        ))}
      </div>
      <OfficeScene layout={layout} styleId={style} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Preview />);
