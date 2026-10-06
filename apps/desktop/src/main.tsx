import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TitleBar } from "./TitleBar";
import { ErrorBoundary } from "./ErrorBoundary";

// Entry point. Edits to this module force a full reload of the webview.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <TitleBar />
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
