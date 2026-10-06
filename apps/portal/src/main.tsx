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
