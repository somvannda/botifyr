// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BotifyrClient, FeedPost } from "@botifyr/client";
import { FeedView } from "./FeedView";

/**
 * Feed action hierarchy (docs/feed-improvement-plan.md FEED-1): primary actions
 * stay on the card, rare/destructive actions live behind one "More options" menu.
 */

function makePost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: "post-1",
    author: { id: "author-1", handle: "alice", displayName: "Alice", online: false },
    body: "A quiet feed is a happy feed.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    likes: 0,
    comments: 0,
    shares: 0,
    likedByMe: false,
    sharedByMe: false,
    reactions: {},
    myReaction: null,
    ...overrides,
  };
}

function makeClient(posts: FeedPost[]): BotifyrClient {
  return {
    listFeed: vi.fn().mockResolvedValue({ items: posts, nextCursor: null }),
    listStories: vi.fn().mockResolvedValue([]),
    listMyPages: vi.fn().mockResolvedValue([]),
    reportPost: vi.fn().mockResolvedValue(undefined),
    blockUser: vi.fn().mockResolvedValue(undefined),
    muteAuthor: vi.fn().mockResolvedValue(undefined),
    hidePost: vi.fn().mockResolvedValue(undefined),
    savePost: vi.fn().mockResolvedValue(undefined),
    deletePost: vi.fn().mockResolvedValue(undefined),
  } as unknown as BotifyrClient;
}

afterEach(cleanup);

describe("FeedView action hierarchy", () => {
  it("keeps four primary actions plus one More-options button on the card", async () => {
    render(<FeedView client={makeClient([makePost()])} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    for (const name of ["Like", "Comment", "Share", "Save"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "More options" })).toBeTruthy();
    // Destructive actions are NOT top-level buttons.
    expect(screen.queryByRole("button", { name: /report post/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^block /i })).toBeNull();
  });

  it("reveals rare/destructive actions only inside the More-options menu", async () => {
    render(<FeedView client={makeClient([makePost()])} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "More options" }));

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Report post" })).toBeTruthy();
    });
    expect(screen.getByRole("menuitem", { name: /^block alice$/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Hide this post" })).toBeTruthy();
  });

  it("shows a Delete action in the menu for the viewer's own post", async () => {
    const own = makePost({ author: { id: "viewer-1", handle: "me", displayName: "Me", online: true } });
    render(<FeedView client={makeClient([own])} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Delete post" })).toBeTruthy();
    });
    expect(screen.queryByRole("menuitem", { name: "Report post" })).toBeNull();
  });

  it("clamps a long post body behind a See more toggle (FEED-8)", async () => {
    const longBody = Array.from(
      { length: 20 },
      (_, index) => `Paragraph ${index + 1}: ${"lorem ipsum ".repeat(8)}`,
    ).join("\n\n");
    render(
      <FeedView
        client={makeClient([makePost({ body: longBody })])}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
      />,
    );

    const body = await screen.findByText(/Paragraph 20/);
    expect(body.className).toContain("feed-body-clamped");

    fireEvent.click(screen.getByRole("button", { name: "See more" }));
    expect(screen.getByRole("button", { name: "See less" })).toBeTruthy();
    expect(screen.getByText(/Paragraph 20/).className).not.toContain("feed-body-clamped");
  });
});
