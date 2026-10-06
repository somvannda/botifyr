import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guardrail: the desktop app and the web portal must render the SAME UI.
 * Both are thin hosts around `BotifyrApp` from this package — if either grows a
 * bespoke UI (another component tree, its own screens), they will drift and the
 * same fix will have to be made twice. See AGENTS.md §7.
 */
describe("UI parity (one shared app, two hosts)", () => {
  const hosts = [
    { name: "desktop", path: "apps/desktop/src/App.tsx", maxBytes: 2500 },
    { name: "portal", path: "apps/portal/src/App.tsx", maxBytes: 1200 },
  ];

  for (const host of hosts) {
    it(`${host.name} renders the shared BotifyrApp`, () => {
      const source = readFileSync(host.path, "utf8");
      expect(source).toContain("BotifyrApp");
      // Hosts must stay thin: a bridge plus the shared app, nothing more.
      expect(source.length).toBeLessThan(host.maxBytes);
    });
  }

  it("the shared app is the single source of the interface", () => {
    const app = readFileSync("packages/ui/src/BotifyrApp.tsx", "utf8");
    expect(app).toContain("export function BotifyrApp");
    // It must not reach back into a host (which would couple it to one platform).
    expect(app).not.toContain("@tauri-apps");
    expect(app).not.toContain("apps/desktop");
    expect(app).not.toContain("apps/portal");
  });
});
