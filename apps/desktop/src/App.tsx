import { invoke } from "@tauri-apps/api/core";
import { BotifyrApp, type BotBridge } from "@botifyr/ui";

/**
 * The desktop app is just the shared Botifyr UI plus a Tauri bridge. The web
 * portal renders the exact same `BotifyrApp` with a browser bridge, so the two
 * are identical by construction.
 */
const tauriBridge: BotBridge = {
  openExternal: async (url: string) => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  },
  focusWindow: async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.unminimize();
    await win.setFocus();
  },
  notify: async (title: string, body: string) => {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } =
        await import("@tauri-apps/plugin-notification");
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body });
    } catch {
      // Notifications are best-effort; never block the app.
    }
  },
  startLocalNode: async (token: string) => {
    await invoke("start_local_node", { token });
  },
  stopLocalNode: async () => {
    await invoke("stop_local_node");
  },
};

export default function App() {
  return <BotifyrApp bridge={tauriBridge} />;
}
