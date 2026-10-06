import { BotifyrApp, webBridge } from "@botifyr/ui";

/**
 * The web portal is the exact same `BotifyrApp` as the desktop, rendered in the
 * browser with a web bridge — so the two UIs can never drift apart.
 */
export function Portal() {
  return <BotifyrApp bridge={webBridge} />;
}
