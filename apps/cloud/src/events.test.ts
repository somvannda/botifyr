import { describe, expect, it } from "vitest";
import { feedEventRecipient } from "./events.js";

/**
 * DB-1 (docs/feed-discovery-plan.md): the feed realtime routing predicate. The
 * existing feed test asserts events are *emitted*; this covers who may *receive*
 * them, which the websocket fan-out (`canReceive`) uses.
 */
describe("feedEventRecipient", () => {
  it("routes interactions to their explicit recipient", () => {
    expect(feedEventRecipient({ type: "feed.like", postId: "p", fromUserId: "a", toUserId: "b" })).toBe("b");
    expect(feedEventRecipient({ type: "feed.comment", postId: "p", fromUserId: "a", toUserId: "b" })).toBe(
      "b",
    );
    expect(feedEventRecipient({ type: "feed.share", postId: "p", fromUserId: "a", toUserId: "b" })).toBe("b");
    expect(feedEventRecipient({ type: "feed.mention", postId: "p", fromUserId: "a", toUserId: "b" })).toBe(
      "b",
    );
  });

  it("routes a new post to its author", () => {
    expect(feedEventRecipient({ type: "feed.post", postId: "p", authorId: "a" })).toBe("a");
  });

  it("returns null for non-feed events", () => {
    expect(feedEventRecipient({ type: "presence", userId: "a", online: true, toUserId: "b" })).toBeNull();
    expect(feedEventRecipient({ type: "typing", sessionId: "s", userId: "a", toUserId: "b" })).toBeNull();
  });
});
