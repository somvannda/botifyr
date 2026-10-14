import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CONNECTORS,
  ROLE_CATALOG,
  capabilitiesFor,
  connectorById,
  connectorsProviding,
  preferredConnectorId,
  providedCapabilities,
  resolveConnector,
} from "./index.js";

/** The connector registry is data the marketplace and role binding read from. */
describe("connector registry", () => {
  const capabilityIds = new Set(CAPABILITIES.map((capability) => capability.id));
  const connectorIds = new Set(CONNECTORS.map((connector) => connector.id));

  it("has unique, well-formed connector ids", () => {
    expect(connectorIds.size).toBe(CONNECTORS.length);
    for (const connector of CONNECTORS) {
      expect(connector.id, connector.id).toMatch(/^[a-z0-9-]+$/);
      expect(connector.setup.length).toBeGreaterThan(0);
      expect(connector.actsOnBehalf.length).toBeGreaterThan(0);
    }
  });

  it("every connector only declares real capability ids", () => {
    for (const connector of CONNECTORS) {
      expect(connector.provides.length, connector.id).toBeGreaterThan(0);
      for (const capability of connector.provides) {
        expect(capabilityIds.has(capability), `${connector.id} -> ${capability}`).toBe(true);
      }
    }
  });

  it("declares ads as a Zernio-only capability today", () => {
    expect(connectorsProviding("ads.manage").map((connector) => connector.id)).toEqual(["zernio"]);
  });

  it("covers every social/ads capability a catalog role can hold", () => {
    const provided = providedCapabilities(CONNECTORS.map((connector) => connector.id));
    const socialish = new Set(
      ROLE_CATALOG.flatMap((role) => role.capabilities).filter((capability) =>
        capability.startsWith("social.") || capability.startsWith("ads."),
      ),
    );
    for (const capability of socialish) {
      expect(provided.has(capability), `no connector provides ${capability}`).toBe(true);
    }
  });

  it("routes a capability to the first connected connector that provides it", () => {
    expect(resolveConnector("social.publish", ["publora", "zernio"])?.id).toBe("zernio");
    expect(resolveConnector("social.publish", ["publora"])?.id).toBe("publora");
    expect(resolveConnector("ads.manage", ["publora", "socialapi"])).toBeUndefined();
  });

  it("only unlocks a role's ads capability when an ads-capable connector is connected", () => {
    const marketer = ROLE_CATALOG.find((role) => role.capabilities.includes("ads.manage"));
    expect(marketer, "a catalog role holding ads.manage").toBeTruthy();
    if (!marketer) throw new Error("expected a role with ads.manage in the catalog");

    const withoutAds = capabilitiesFor(marketer, { connected: ["publora"] });
    expect(withoutAds.enabled).not.toContain("ads.manage");
    expect(withoutAds.missing.find((entry) => entry.capability === "ads.manage")?.reason).toBe(
      "not-connected",
    );

    const withAds = capabilitiesFor(marketer, { connected: ["zernio"] });
    expect(withAds.enabled).toContain("ads.manage");
    expect(withAds.enabledBy["ads.manage"]).toEqual(["zernio"]);
  });

  it("reports not-granted when a capability is provided but the grant is withheld", () => {
    const role = { capabilities: ["social.publish"] };
    const result = capabilitiesFor(role, {
      connected: ["zernio"],
      granted: [{ capability: "social.publish", granted: false }],
    });
    expect(result.enabled).toEqual([]);
    expect(result.missing[0]?.reason).toBe("not-granted");
  });

  it("lists Post for Me as a publishing-only connector", () => {
    const postforme = connectorById("postforme");
    expect(postforme?.provides).toEqual(["social.publish", "social.read_insights"]);
    expect(postforme?.provides).not.toContain("social.reply");
    expect(postforme?.platforms).not.toContain("telegram");
  });

  it("honours an employee's app preference, then falls back to registry order", () => {
    expect(resolveConnector("social.publish", ["zernio", "publora"])?.id).toBe("zernio");
    expect(resolveConnector("social.publish", ["zernio", "publora"], "publora")?.id).toBe("publora");
    // A preference for an app that doesn't provide the capability is ignored.
    expect(resolveConnector("social.publish", ["zernio"], "publora")?.id).toBe("zernio");
  });

  it("resolves a subject's preferred connector id, exact before wildcard", () => {
    const preferences = [
      { workspaceId: "w", subject: "role:Marketer", capability: "*", connectorId: "publora" },
      { workspaceId: "w", subject: "role:Marketer", capability: "ads.manage", connectorId: "zernio" },
    ];
    expect(preferredConnectorId(preferences, "role:Marketer", "ads.manage")).toBe("zernio");
    expect(preferredConnectorId(preferences, "role:Marketer", "social.publish")).toBe("publora");
    expect(preferredConnectorId(preferences, "role:Sales", "social.publish")).toBeUndefined();
  });
});
