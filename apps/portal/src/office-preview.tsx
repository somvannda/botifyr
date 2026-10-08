/**
 * Dev-only preview of the 3D office (P1) with mock employees.
 *
 * Shows the docked split view (chat + live office side by side) and the floating
 * overlay, using the SAME shared `OfficeView`. Not part of the product build
 * (Vite only bundles `index.html`), and it duplicates no UI.
 *
 * Open: http://localhost:1421/office-preview.html  (`npm run dev -w @botifyr/portal`)
 */

import { useState } from "react";
import ReactDOM from "react-dom/client";
import OfficeView, { type OfficeAgent } from "../../../packages/ui/src/office3d/OfficeView";
import "@botifyr/ui/styles.css";
import "./portal.css";

const AGENTS: OfficeAgent[] = [
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

function Preview() {
  const [docked, setDocked] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const office = (isDocked: boolean) => (
    <OfficeView
      company="Chmaba"
      agents={AGENTS}
      docked={isDocked}
      onToggleDock={() => setDocked((value) => !value)}
      onClose={() => setDocked(true)}
      onSelect={setSelected}
    />
  );

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <main style={{ flex: 1, minWidth: 0, padding: 24, overflow: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Chat</h2>
        <p style={{ color: "var(--muted)", maxWidth: 460 }}>
          This is the chat column. The live 3D office sits beside it — the CEO can keep
          talking to the team while watching the office in real time. Use the{" "}
          <b>Float</b> / <b>Dock</b> button in the office header to toggle.
        </p>
        {selected && <p style={{ color: "var(--muted)" }}>Selected employee: {selected}</p>}
      </main>

      {docked && (
        <aside className="office3d-docked" style={{ width: "min(46vw, 720px)" }}>
          {office(true)}
        </aside>
      )}

      {!docked && office(false)}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Preview />);
