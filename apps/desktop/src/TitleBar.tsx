import { BotLogo } from "./BotLogo";

async function withWindow(run: (window: any) => Promise<unknown>): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await run(getCurrentWindow());
  } catch {
    // Not running inside the desktop app (browser preview).
  }
}

/** Frameless window title bar with drag region + window controls. */
export function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <BotLogo size={16} className="titlebar-logo" />
        <span>Botifyr</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="win-btn"
          type="button"
          title="Minimize"
          onClick={() => void withWindow((w) => w.minimize())}
        >
          —
        </button>
        <button
          className="win-btn"
          type="button"
          title="Maximize"
          onClick={() =>
            void withWindow(async (w) => ((await w.isMaximized()) ? w.unmaximize() : w.maximize()))
          }
        >
          ▢
        </button>
        <button
          className="win-btn close"
          type="button"
          title="Close"
          onClick={() => void withWindow((w) => w.close())}
        >
          ✕
        </button>
      </div>
    </header>
  );
}
