import React from "react";
import ReactDOM from "react-dom/client";
import { Portal } from "./App";
import "@botifyr/ui/styles.css";
import "./portal.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Portal />
  </React.StrictMode>,
);

// Offline app shell (see public/sw.js). Best-effort: never block the app.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
