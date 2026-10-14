import { describe, expect, it } from "vitest";
import { scopedChannelIdentity } from "./channel-routing.js";

describe("scopedChannelIdentity", () => {
  const scope = { workspaceId: "ws1", botId: "emp-sales" };

  it("attributes a scoped channel to the employee, billed to the owner", () => {
    expect(scopedChannelIdentity(scope, { ownerId: "u1" })).toEqual({
      userId: "u1",
      authorId: "emp-sales",
    });
  });

  it("falls back (null) for an unscoped adapter", () => {
    expect(scopedChannelIdentity(undefined, { ownerId: "u1" })).toBeNull();
  });

  it("returns null when the workspace owner is unknown", () => {
    expect(scopedChannelIdentity(scope, null)).toBeNull();
    expect(scopedChannelIdentity(scope, { ownerId: "" })).toBeNull();
  });
});
