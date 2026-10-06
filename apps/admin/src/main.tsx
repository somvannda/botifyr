import React from "react";
import ReactDOM from "react-dom/client";
import { Admin } from "./App";
import "@botifyr/ui/styles.css";
import "./admin.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Admin />
  </React.StrictMode>,
);
