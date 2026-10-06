/**
 * Platform bridge: the only things the shared app needs from its host.
 *
 * The desktop app provides a Tauri implementation; the web portal provides a
 * browser one. Everything else in `BotifyrApp` is identical, so the desktop and
 * the web are the same UI.
 */
export interface BotBridge {
  /** Open a URL outside the app (system browser / new tab). */
  openExternal(url: string): void | Promise<void>;
  /** Bring the host window to the front (desktop only). */
  focusWindow?(): void | Promise<void>;
  /** Start the local "my computer" node with a short-lived token (desktop only). */
  startLocalNode?(token: string): void | Promise<void>;
  /** Stop the local node (desktop only). */
  stopLocalNode?(): void | Promise<void>;
}

/** Default browser implementation (used by the web portal). */
export const webBridge: BotBridge = {
  openExternal: (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },
};

/** Shared fallback so `BotifyrApp` can be rendered without props in tests. */
export const defaultBridge: BotBridge = webBridge;
