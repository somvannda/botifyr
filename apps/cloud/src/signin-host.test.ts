import { describe, expect, it } from "vitest";
import { signinHost } from "./server.js";

/**
 * Google sign-in round-trips the caller's host through the OAuth `state`
 * prefix, so the callback can send a browser user back to the portal/console
 * instead of deep-linking into the desktop app. Legacy clients send a bare
 * UUID and must keep the original desktop behaviour.
 */
describe("signinHost", () => {
  it("routes the web portal back to the browser", () => {
    expect(signinHost("web:6f0c...")).toBe("web");
  });

  it("routes the admin console back to the browser", () => {
    expect(signinHost("admin:6f0c...")).toBe("admin");
  });

  it("routes the desktop app to the deep link", () => {
    expect(signinHost("desktop:6f0c...")).toBe("desktop");
  });

  it("treats a bare UUID (older clients) as desktop", () => {
    expect(signinHost("6f0c5e2a-0000-0000-0000-000000000000")).toBe("desktop");
  });

  it("treats an empty state as desktop rather than throwing", () => {
    expect(signinHost("")).toBe("desktop");
  });
});
