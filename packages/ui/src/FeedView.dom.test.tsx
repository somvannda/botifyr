// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BotifyrClient, FeedPost, Page, Story } from "@botifyr/client";
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

function makeClient(
  posts: FeedPost[],
  extras: { stories?: Story[]; reels?: FeedPost[] } = {},
): BotifyrClient {
  return {
    listFeed: vi.fn().mockResolvedValue({ items: posts, nextCursor: null }),
    listStories: vi.fn().mockResolvedValue(extras.stories ?? []),
    viewStory: vi.fn().mockResolvedValue({ ok: true }),
    reactStory: vi.fn().mockResolvedValue({ ok: true }),
    listReels: vi.fn().mockResolvedValue({ items: extras.reels ?? [], nextCursor: null }),
    listMyPages: vi.fn().mockResolvedValue([]),
    getPostDraft: vi.fn().mockResolvedValue(null),
    savePostDraft: vi.fn().mockResolvedValue({ ok: true }),
    deletePostDraft: vi.fn().mockResolvedValue({ ok: true }),
    openDm: vi.fn().mockResolvedValue({
      id: "dm-1",
      kind: "dm",
      title: "Alice",
      participants: ["viewer-1", "author-s1"],
      messages: [],
      createdAt: new Date().toISOString(),
    }),
    sendDm: vi.fn().mockResolvedValue({
      session: {
        id: "dm-1",
        kind: "dm",
        title: "Alice",
        participants: [],
        messages: [],
        createdAt: new Date().toISOString(),
      },
    }),
    reportPost: vi.fn().mockResolvedValue(undefined),
    blockUser: vi.fn().mockResolvedValue(undefined),
    muteAuthor: vi.fn().mockResolvedValue(undefined),
    hidePost: vi.fn().mockResolvedValue(undefined),
    savePost: vi.fn().mockResolvedValue(undefined),
    deletePost: vi.fn().mockResolvedValue(undefined),
    likePost: vi.fn().mockResolvedValue(undefined),
    repost: vi.fn().mockResolvedValue(makePost()),
    getPage: vi.fn().mockResolvedValue({
      id: "page-1",
      handle: "studio",
      name: "Studio",
      verified: false,
      followers: 5,
      following: false,
      role: null,
      createdAt: new Date().toISOString(),
    }),
    followPage: vi.fn().mockResolvedValue({ ok: true }),
    unfollowPage: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    listCommentsPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getPost: vi.fn().mockImplementation((id: string) => Promise.resolve(makePost({ id }))),
    editPost: vi
      .fn()
      .mockImplementation((id: string, body: string) => Promise.resolve(makePost({ id, body }))),
    getPersonByHandle: vi.fn().mockResolvedValue({
      person: { id: "author-1", handle: "alice", displayName: "Alice", online: false },
      posts: [],
    }),
    addComment: vi.fn().mockImplementation((_id: string, body: string) =>
      Promise.resolve({
        id: `comment-${body}`,
        author: { id: "viewer-1", handle: "me", displayName: "Me", online: false },
        body,
        createdAt: new Date().toISOString(),
      }),
    ),
  } as unknown as BotifyrClient;
}

/** Cast a client method to the vitest mock it really is. */
function asMock<T>(value: T): ReturnType<typeof vi.fn> {
  return value as unknown as ReturnType<typeof vi.fn>;
}

function makeStory(
  id: string,
  name: string,
  authorId = `author-${id}`,
  createdAt = new Date().toISOString(),
): Story {
  return {
    id,
    author: { id: authorId, handle: name.toLowerCase(), displayName: name, online: false },
    caption: `Story ${id}`,
    createdAt,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

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

  it("renders an author's uploaded avatar photo (FEED-6)", async () => {
    const withPhoto = makePost({
      author: {
        id: "author-1",
        handle: "alice",
        displayName: "Alice",
        online: false,
        avatarUrl: "https://cdn.example/a.png",
      },
    });
    const { container } = render(
      <FeedView client={makeClient([withPhoto])} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );
    await screen.findByText("A quiet feed is a happy feed.");
    const img = container.querySelector("img.feed-avatar-photo");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("https://cdn.example/a.png");
  });

  it("exposes a per-type reaction breakdown on the summary (FEED-7)", async () => {
    const { container } = render(
      <FeedView
        client={makeClient([makePost({ likes: 3, reactions: { like: 2, love: 1 } })])}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
      />,
    );
    await screen.findByText("A quiet feed is a happy feed.");
    const title = container.querySelector(".feed-reaction-summary")?.getAttribute("title") ?? "";
    expect(title).toContain("Like: 2");
    expect(title).toContain("Love: 1");
  });

  it("gives the composer controls accessible names (FEED-9)", async () => {
    render(<FeedView client={makeClient([makePost()])} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");
    expect(screen.getByRole("combobox", { name: "Post as" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Audience" })).toBeTruthy();
  });

  it("opens a full-screen lightbox when an image is clicked (FEED-10)", async () => {
    const post = makePost({ images: ["/v1/feed/image?t=a", "/v1/feed/image?t=b"] });
    render(<FeedView client={makeClient([post])} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    const images = screen.getAllByRole("button", { name: /open image/i });
    expect(images).toHaveLength(2);

    fireEvent.click(images[0]);
    expect(await screen.findByRole("dialog", { name: "Image viewer" })).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  it("restores the reader's saved feed tab (FEED-11)", async () => {
    localStorage.setItem("botifyr.feedTab", "pages");
    render(<FeedView client={makeClient([makePost()])} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");
    expect(screen.getByRole("button", { name: "Pages" }).className).toContain("active");
    expect(screen.getByRole("button", { name: "All" }).className).not.toContain("active");
  });

  it("opens the story viewer with per-creator progress and navigates (EXP-1)", async () => {
    const stories = [
      makeStory("a1", "Alice", "author-alice", new Date(Date.now() - 2000).toISOString()),
      makeStory("a2", "Alice", "author-alice", new Date(Date.now() - 1000).toISOString()),
      makeStory("b1", "Bob", "author-bob"),
    ];
    const { container } = render(
      <FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    expect(await screen.findByRole("dialog", { name: /Story by Alice/ })).toBeTruthy();
    // Progress segments cover only the active creator's collection.
    expect(container.querySelectorAll(".story-seg")).toHaveLength(2);
    expect(container.querySelectorAll(".story-seg.done")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Next story" }));
    // Second story from the same creator.
    expect(screen.getByRole("dialog", { name: /Story by Alice/ })).toBeTruthy();
    expect(container.querySelectorAll(".story-seg.done")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Next story" }));
    // Collection finished — advance to the next creator.
    expect(await screen.findByRole("dialog", { name: /Story by Bob/ })).toBeTruthy();
    expect(container.querySelectorAll(".story-seg")).toHaveLength(1);
  });

  it("groups a creator's stories into a single tray tile (EXP-1)", async () => {
    const stories = [
      makeStory("a1", "Alice", "author-alice"),
      makeStory("a2", "Alice", "author-alice"),
      makeStory("b1", "Bob", "author-bob"),
    ];
    render(<FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />);

    await screen.findByRole("button", { name: /Alice/ });
    expect(screen.getAllByRole("button", { name: /Alice/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Bob/ })).toHaveLength(1);
  });

  it("dims a story tile once viewed (EXP-2)", async () => {
    const stories = [makeStory("s1", "Alice")];
    const { container } = render(
      <FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );

    const tile = await screen.findByRole("button", { name: /Alice/ });
    expect(tile.querySelector(".story-avatar.seen")).toBeNull();
    fireEvent.click(tile);
    await screen.findByRole("dialog", { name: /Story by Alice/ });
    expect(container.querySelector(".story-avatar.seen")).toBeTruthy();
  });

  it("remembers viewed stories across remounts (EXP-2)", async () => {
    const stories = [makeStory("s1", "Alice")];
    const { unmount } = render(
      <FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    await screen.findByRole("dialog", { name: /Story by Alice/ });
    expect(localStorage.getItem("botifyr.seenStories")).toContain("s1");
    unmount();

    const { container } = render(
      <FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );
    const tile = await screen.findByRole("button", { name: /Alice/ });
    expect(tile.querySelector(".story-avatar.seen")).toBeTruthy();
    expect(container.querySelector(".story-viewer")).toBeNull();
  });

  it("pauses and resumes story progression (EXP-1)", async () => {
    vi.useFakeTimers();
    try {
      const stories = [makeStory("s1", "Alice"), makeStory("s2", "Bob")];
      const { container } = render(
        <FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />,
      );
      await act(async () => {});

      fireEvent.click(screen.getByRole("button", { name: /Alice/ }));
      await act(async () => {});
      expect(screen.getByRole("dialog", { name: /Story by Alice/ })).toBeTruthy();

      // Space pauses.
      fireEvent.keyDown(document, { key: " " });
      await act(async () => {});
      expect(container.querySelector(".story-paused")).toBeTruthy();

      // No progression while paused.
      await act(async () => {
        vi.advanceTimersByTime(8000);
      });
      expect(screen.getByRole("dialog", { name: /Story by Alice/ })).toBeTruthy();

      // Space resumes; the timer then advances to the next creator.
      fireEvent.keyDown(document, { key: " " });
      await act(async () => {});
      expect(container.querySelector(".story-paused")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(8000);
      });
      expect(screen.getByRole("dialog", { name: /Story by Bob/ })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a story reply through the DM channel (EXP-9)", async () => {
    const stories = [makeStory("s1", "Alice")];
    const client = makeClient([], { stories });
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    await screen.findByRole("dialog", { name: /Story by Alice/ });

    fireEvent.change(screen.getByRole("textbox", { name: /Reply to Alice/ }), {
      target: { value: "nice story" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText(/Sent/);
    expect(asMock(client.openDm)).toHaveBeenCalledWith("author-s1");
    expect(asMock(client.sendDm)).toHaveBeenCalledWith("dm-1", "nice story");
  });

  it("opens the DM after a story reply when the host handles it (EXP-9)", async () => {
    const stories = [makeStory("s1", "Alice")];
    const client = makeClient([], { stories });
    const onStoryReplySent = vi.fn();
    render(
      <FeedView
        client={client}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
        onStoryReplySent={onStoryReplySent}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    await screen.findByRole("dialog", { name: /Story by Alice/ });
    fireEvent.change(screen.getByRole("textbox", { name: /Reply to Alice/ }), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onStoryReplySent).toHaveBeenCalledTimes(1));
    expect(onStoryReplySent.mock.calls[0][0]).toMatchObject({ id: "dm-1" });
  });

  it("records a story view through the API when opened (EXP-2)", async () => {
    const stories = [makeStory("s1", "Alice")];
    const client = makeClient([], { stories });
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    await screen.findByRole("dialog", { name: /Story by Alice/ });
    await waitFor(() => expect(asMock(client.viewStory)).toHaveBeenCalledWith("s1"));
  });

  it("toggles a story reaction through the API (EXP-9)", async () => {
    const stories = [makeStory("s1", "Alice")];
    const client = makeClient([], { stories });
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    await screen.findByRole("dialog", { name: /Story by Alice/ });

    const love = screen.getByRole("button", { name: "React ❤️" });
    fireEvent.click(love);
    await waitFor(() => expect(asMock(client.reactStory)).toHaveBeenCalledWith("s1", "❤️"));
    expect(screen.getByRole("button", { name: "React ❤️" }).getAttribute("aria-pressed")).toBe("true");

    // Tapping the active reaction clears it.
    fireEvent.click(screen.getByRole("button", { name: "React ❤️" }));
    await waitFor(() => expect(asMock(client.reactStory)).toHaveBeenCalledWith("s1", ""));
  });

  it("shows a recoverable error when story media fails (EXP-1)", async () => {
    const stories = [{ ...makeStory("s1", "Alice"), imageUrl: "/v1/feed/image?t=broken" }];
    const { container } = render(
      <FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    const image = container.querySelector(".story-viewer img");
    expect(image).toBeTruthy();
    fireEvent.error(image as HTMLImageElement);

    expect(await screen.findByText(/couldn/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("hides an expired story from the tray (EXP-1)", async () => {
    const stories = [{ ...makeStory("s1", "Alice"), expiresAt: new Date(Date.now() - 1000).toISOString() }];
    render(<FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />);

    await screen.findByText(/No stories yet/i);
    expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();
  });

  it("closes the viewer after the last creator's last story (EXP-1)", async () => {
    const stories = [makeStory("s1", "Alice")];
    render(<FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    await screen.findByRole("dialog", { name: /Story by Alice/ });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("navigates with the keyboard and closes with Escape (EXP-1)", async () => {
    const stories = [makeStory("s1", "Alice"), makeStory("s2", "Bob")];
    render(<FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    await screen.findByRole("dialog", { name: /Story by Alice/ });

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(await screen.findByRole("dialog", { name: /Story by Bob/ })).toBeTruthy();

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(await screen.findByRole("dialog", { name: /Story by Alice/ })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("pauses while the tab is hidden and resumes on return (EXP-1)", async () => {
    vi.useFakeTimers();
    try {
      const stories = [makeStory("s1", "Alice"), makeStory("s2", "Bob")];
      render(<FeedView client={makeClient([], { stories })} cloudUrl="http://cloud" viewerId="viewer-1" />);
      await act(async () => {});

      fireEvent.click(screen.getByRole("button", { name: /Alice/ }));
      await act(async () => {});
      expect(screen.getByRole("dialog", { name: /Story by Alice/ })).toBeTruthy();

      // Background the tab: progression must freeze.
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(8000);
      });
      expect(screen.getByRole("dialog", { name: /Story by Alice/ })).toBeTruthy();

      // Return to the tab: progression resumes and advances.
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(8000);
      });
      expect(screen.getByRole("dialog", { name: /Story by Bob/ })).toBeTruthy();
    } finally {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      vi.useRealTimers();
    }
  });

  it("offers a mute toggle in Reels (EXP-3)", async () => {
    const reels = [makePost({ videos: ["/v1/feed/image?t=v"], body: "reel body" })];
    render(
      <FeedView client={makeClient([makePost()], { reels })} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "Reels" }));
    const unmute = await screen.findByRole("button", { name: "Unmute reels" });
    expect(unmute).toBeTruthy();
    fireEvent.click(unmute);
    expect(await screen.findByRole("button", { name: "Mute reels" })).toBeTruthy();
  });

  it("shows a character counter in the composer (EXP-5)", async () => {
    render(<FeedView client={makeClient([makePost()])} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.change(screen.getByPlaceholderText("Share an update…"), { target: { value: "hello" } });
    expect(screen.getByText("5 / 4000")).toBeTruthy();
  });
});

/**
 * Feed & Discovery timeline mechanics: pagination integrity, infinite scroll,
 * end-of-feed, and manual refresh. See docs/feed-discovery-plan.md.
 */
describe("Feed timeline & discovery", () => {
  it("de-duplicates posts when loading more pages (FEED-D3)", async () => {
    const p1 = makePost({ id: "p1", body: "first post" });
    const p2 = makePost({ id: "p2", body: "second post" });
    const client = {
      ...makeClient([]),
      listFeed: vi
        .fn()
        .mockResolvedValueOnce({ items: [p1], nextCursor: "c1" })
        .mockResolvedValueOnce({ items: [p1, p2], nextCursor: null }),
    } as unknown as BotifyrClient;

    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("first post");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("second post");
    // The overlapping post is not rendered a second time.
    expect(screen.getAllByText("first post")).toHaveLength(1);
  });

  it("shows an end-of-feed state once there are no more pages (FEED-D2)", async () => {
    const client = {
      ...makeClient([]),
      listFeed: vi.fn().mockResolvedValue({ items: [makePost({ body: "only post" })], nextCursor: null }),
    } as unknown as BotifyrClient;

    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("only post");
    expect(screen.getByText("You're all caught up")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("auto-loads the next page when the bottom sentinel is visible (FEED-D1)", async () => {
    class FakeIO {
      static instances: FakeIO[] = [];
      callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        FakeIO.instances.push(this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);
    try {
      const p1 = makePost({ id: "p1", body: "page one" });
      const p2 = makePost({ id: "p2", body: "page two" });
      const listFeed = vi
        .fn()
        .mockResolvedValueOnce({ items: [p1], nextCursor: "c1" })
        .mockResolvedValueOnce({ items: [p2], nextCursor: null });
      const client = { ...makeClient([]), listFeed } as unknown as BotifyrClient;

      render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
      await screen.findByText("page one");
      await waitFor(() => expect(FakeIO.instances.length).toBeGreaterThan(0));

      const observer = FakeIO.instances[FakeIO.instances.length - 1];
      observer.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      );

      await screen.findByText("page two");
      expect(listFeed).toHaveBeenCalledTimes(2);
      // The second request paginates from the cursor returned by the first.
      expect(listFeed.mock.calls[1][0]).toBe("c1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refreshes the feed from the topbar (FEED-D5)", async () => {
    const client = makeClient([makePost({ body: "hello world" })]);
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("hello world");

    fireEvent.click(screen.getByRole("button", { name: "Refresh feed" }));
    await waitFor(() => expect(client.listFeed).toHaveBeenCalledTimes(2));
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("holds a realtime update behind a New activity banner while reading (FEED-D6)", async () => {
    const listFeed = vi
      .fn()
      .mockResolvedValue({ items: [makePost({ body: "base post" })], nextCursor: null });
    const client = { ...makeClient([]), listFeed } as unknown as BotifyrClient;
    const { container, rerender } = render(
      <FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" refreshKey={0} />,
    );
    await screen.findByText("base post");

    // The reader has scrolled into the timeline.
    const scroll = container.querySelector(".feed-scroll") as HTMLDivElement;
    Object.defineProperty(scroll, "scrollTop", { value: 400, writable: true, configurable: true });
    fireEvent.scroll(scroll);

    // A realtime event bumps the refresh key.
    rerender(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" refreshKey={1} />);
    const banner = await screen.findByRole("button", { name: /New activity/ });
    // The list was NOT silently replaced.
    expect(listFeed).toHaveBeenCalledTimes(1);

    fireEvent.click(banner);
    await waitFor(() => expect(listFeed).toHaveBeenCalledTimes(2));
  });

  it("exposes an explicit, labelled sort control (FEED-D7)", async () => {
    const listFeed = vi
      .fn()
      .mockResolvedValue({ items: [makePost({ body: "sortable post" })], nextCursor: null });
    const client = { ...makeClient([]), listFeed } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("sortable post");

    const select = screen.getByRole("combobox", { name: "Sort feed" }) as HTMLSelectElement;
    expect(select.value).toBe("recent");

    fireEvent.change(select, { target: { value: "top" } });
    await waitFor(() => expect(listFeed).toHaveBeenCalledTimes(2));
    // The refetch carried the new sort.
    expect(listFeed.mock.calls[1][2]).toEqual({ tab: "all", sort: "top" });
  });

  it("surfaces newer posts behind the banner when the app regains focus (FEED-D10)", async () => {
    const older = makePost({ id: "old", body: "old top post" });
    const newer = makePost({ id: "new", body: "brand new post" });
    const listFeed = vi
      .fn()
      .mockResolvedValueOnce({ items: [older], nextCursor: null })
      .mockResolvedValue({ items: [newer, older], nextCursor: null });
    const client = { ...makeClient([]), listFeed } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("old top post");

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    const banner = await screen.findByRole("button", { name: /New activity/ });
    expect(banner).toBeTruthy();
    // The list was NOT silently replaced — the old top is still rendered.
    expect(screen.getByText("old top post")).toBeTruthy();
  });

  it("announces newly loaded posts to screen readers (FEED-D11)", async () => {
    const p1 = makePost({ id: "a1", body: "first page post" });
    const p2 = makePost({ id: "a2", body: "second page post" });
    const listFeed = vi
      .fn()
      .mockResolvedValueOnce({ items: [p1], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [p2], nextCursor: null });
    const client = { ...makeClient([]), listFeed } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("first page post");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("second page post");
    expect(screen.getByText("1 more post loaded")).toBeTruthy();
  });
});

/**
 * Pages experience (docs/pages-ux-audit.md, docs/pages-implementation-plan.md):
 * identity, section navigation, CTA safety, permissions, follow state, error
 * handling, and empty states. `PageView` renders when `pageHandle` is set.
 */
function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: "page-1",
    handle: "acme",
    name: "Acme Coffee",
    category: "Coffee shop",
    about: "We roast beans daily.",
    verified: false,
    followers: 3,
    following: false,
    role: null,
    createdAt: new Date("2024-01-01").toISOString(),
    ...overrides,
  };
}

function makePageClient(
  page: Page,
  posts: FeedPost[] = [],
  overrides: Partial<BotifyrClient> = {},
): BotifyrClient {
  return {
    ...makeClient(posts),
    getPage: vi.fn().mockResolvedValue(page),
    listPagePosts: vi.fn().mockResolvedValue(posts),
    listPageRoles: vi.fn().mockResolvedValue([]),
    followPage: vi.fn().mockResolvedValue({ ok: true }),
    unfollowPage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as BotifyrClient;
}

function renderPage(client: BotifyrClient) {
  return render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" pageHandle="acme" />);
}

describe("Pages experience", () => {
  it("renders Page identity and reuses the shared post card", async () => {
    const client = makePageClient(makePage(), [makePost({ body: "Fresh roast today" })]);
    renderPage(client);

    expect(await screen.findByRole("heading", { name: /Acme Coffee/ })).toBeTruthy();
    expect(await screen.findByText(/@acme · Coffee shop · 3 followers/)).toBeTruthy();
    expect(await screen.findByText("Fresh roast today")).toBeTruthy();
  });

  it("shows an uploaded Page avatar and falls back to the emoji glyph", async () => {
    const withPhoto = makePage({ avatarUrl: "https://cdn.example/logo.png" });
    const { container, unmount } = renderPage(makePageClient(withPhoto));
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    expect(container.querySelector(".page-head img.feed-avatar-photo")?.getAttribute("src")).toBe(
      "https://cdn.example/logo.png",
    );
    unmount();

    const withEmoji = makePage({ avatarEmoji: "☕" });
    const fallback = renderPage(makePageClient(withEmoji));
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    expect(fallback.container.querySelector(".page-head .feed-avatar")?.textContent).toBe("☕");
  });

  it("shows a recoverable error when the Page fails to load (PG-01)", async () => {
    const getPage = vi.fn().mockRejectedValue(new Error("offline"));
    const client = makePageClient(makePage(), [], { getPage });
    renderPage(client);

    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(2));
  });

  it("navigates between Posts and About sections (PG-06)", async () => {
    const client = makePageClient(makePage(), [makePost({ body: "Fresh roast today" })]);
    const { container } = renderPage(client);
    await screen.findByText("Fresh roast today");

    const postsTab = screen.getByRole("tab", { name: "Posts" });
    const aboutTab = screen.getByRole("tab", { name: "About" });
    expect(postsTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(aboutTab);
    expect(aboutTab.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".page-about-panel")).toBeTruthy();
    expect(screen.getByText("Created")).toBeTruthy();
    // The posts feed is not shown while About is active.
    expect(screen.queryByText("Fresh roast today")).toBeNull();
  });

  it("renders a CTA as a link only when it is a URL, never a dead control (PG-11/PG-12)", async () => {
    const { container, unmount } = renderPage(makePageClient(makePage({ cta: "https://acme.co/menu" })));
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    const link = container.querySelector("a.feed-follow-btn");
    expect(link?.getAttribute("href")).toBe("https://acme.co/menu");
    unmount();

    const nonUrl = renderPage(makePageClient(makePage({ cta: "Order now" })));
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    expect(screen.queryByRole("button", { name: "Order now" })).toBeNull();
    expect(nonUrl.container.querySelector(".page-cta-badge")?.textContent).toBe("Order now");
  });

  it("links the CTA label to a dedicated ctaUrl (EXP-8)", async () => {
    const { container } = renderPage(
      makePageClient(makePage({ cta: "Visit shop", ctaUrl: "https://acme.co/shop" })),
    );
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    const link = container.querySelector("a.feed-follow-btn");
    expect(link?.getAttribute("href")).toBe("https://acme.co/shop");
    // The button shows the owner's label, not the raw URL.
    expect(link?.textContent).toBe("Visit shop");

    // The About section surfaces the same destination.
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(container.querySelector(".page-fact a")?.getAttribute("href")).toBe("https://acme.co/shop");
  });

  it("shows owner controls only to managers (permissions)", async () => {
    const { unmount } = renderPage(makePageClient(makePage({ role: "admin" })));
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Community" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Insights" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    unmount();

    // A moderator can moderate community but not edit settings or view insights.
    const mod = renderPage(makePageClient(makePage({ role: "moderator" })));
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    expect(screen.getByRole("button", { name: "Community" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Insights" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    mod.unmount();

    // An analyst can view insights only.
    const analyst = renderPage(makePageClient(makePage({ role: "analyst" })));
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    expect(screen.getByRole("button", { name: "Insights" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Community" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    analyst.unmount();

    renderPage(makePageClient(makePage({ role: null })));
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    expect(screen.getByRole("button", { name: "Follow" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });

  it("updates follow state on success and surfaces failures (PG-13)", async () => {
    const followPage = vi.fn().mockResolvedValue({ ok: true });
    const { unmount } = renderPage(makePageClient(makePage(), [], { followPage }));
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    await screen.findByRole("button", { name: "Following" });
    expect(followPage).toHaveBeenCalledWith("page-1");
    unmount();

    const failing = makePageClient(makePage(), [], {
      followPage: vi.fn().mockRejectedValue(new Error("nope")),
    });
    renderPage(failing);
    await screen.findByRole("heading", { name: /Acme Coffee/ });
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Follow" })).toBeTruthy();
  });

  it("tailors the empty state for owners and visitors (PG-08)", async () => {
    const { unmount } = renderPage(makePageClient(makePage(), []));
    expect(await screen.findByText("This Page hasn't posted yet.")).toBeTruthy();
    unmount();

    renderPage(makePageClient(makePage({ role: "admin" }), []));
    expect(
      await screen.findByText("You haven't posted yet — use the composer to publish as this Page."),
    ).toBeTruthy();
  });
});

/**
 * Reels (Reels Manager): playback orchestration, navigation, engagement and
 * error/empty states. jsdom has no media engine, so media events are dispatched
 * by hand and scroll/observer APIs are stubbed. See docs/reels-ux-audit.md.
 */
describe("Reels experience", () => {
  function reel(overrides: Partial<FeedPost> = {}): FeedPost {
    return makePost({
      id: "reel-1",
      videos: ["/v1/feed/image?t=video"],
      body: "reel body",
      shares: 0,
      comments: 0,
      ...overrides,
    });
  }

  async function openReels(): Promise<HTMLElement> {
    await screen.findByText("A quiet feed is a happy feed.");
    fireEvent.click(screen.getByRole("button", { name: "Reels" }));
    return screen.getByRole("region", { name: "Reels" });
  }

  beforeEach(() => {
    // jsdom does not implement media playback or responsive-match APIs.
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the action rail for a reel (R-01)", async () => {
    render(
      <FeedView
        client={makeClient([makePost()], { reels: [reel()] })}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
      />,
    );
    await openReels();
    for (const name of ["Like", "Comments", "Share", "Save", "More options"]) {
      expect(await screen.findByRole("button", { name })).toBeTruthy();
    }
  });

  it("shows an empty state when there are no reels (EXP-4)", async () => {
    render(
      <FeedView
        client={makeClient([makePost()], { reels: [] })}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
      />,
    );
    await openReels();
    expect(await screen.findByText("No reels yet")).toBeTruthy();
  });

  it("marks a reel without a video as unavailable (R-09)", async () => {
    render(
      <FeedView
        client={makeClient([makePost()], { reels: [makePost({ id: "r-missing" })] })}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
      />,
    );
    await openReels();
    expect(await screen.findByText("Video unavailable")).toBeTruthy();
  });

  it("shows a recoverable error and retries (EXP-4)", async () => {
    const client = makeClient([makePost()], {});
    asMock(client.listReels).mockRejectedValueOnce(new Error("network down"));
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await openReels();

    expect(await screen.findByText("network down")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(asMock(client.listReels)).toHaveBeenCalledTimes(2));
  });

  it("navigates between reels with the keyboard (R-03)", async () => {
    const { container } = render(
      <FeedView
        client={makeClient([makePost()], { reels: [reel({ id: "r1" }), reel({ id: "r2" })] })}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
      />,
    );
    const region = await openReels();
    await waitFor(() => expect(container.querySelectorAll(".reel")).toHaveLength(2));

    expect(container.querySelectorAll(".reel")[0].className).toContain("reel--active");
    fireEvent.keyDown(region, { key: "ArrowDown" });
    expect(container.querySelectorAll(".reel")[1].className).toContain("reel--active");
    fireEvent.keyDown(region, { key: "ArrowUp" });
    expect(container.querySelectorAll(".reel")[0].className).toContain("reel--active");
  });

  it("likes a reel optimistically (R-01)", async () => {
    const client = makeClient([makePost()], { reels: [reel()] });
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await openReels();

    fireEvent.click(await screen.findByRole("button", { name: "Like" }));
    expect(await screen.findByRole("button", { name: "Unlike" })).toBeTruthy();
    expect(asMock(client.likePost)).toHaveBeenCalledWith("reel-1", true);
  });

  it("rolls a failed like back (R-01)", async () => {
    const client = makeClient([makePost()], { reels: [reel()] });
    asMock(client.likePost).mockRejectedValueOnce(new Error("nope"));
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await openReels();

    fireEvent.click(await screen.findByRole("button", { name: "Like" }));
    expect(await screen.findByRole("button", { name: "Unlike" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Like" })).toBeTruthy());
  });

  it("offers Follow for a Page-authored reel and toggles it (R-01)", async () => {
    const client = makeClient([makePost()], {
      reels: [
        reel({
          pageId: "page-1",
          author: { id: "page-1", handle: "studio", displayName: "Studio", online: false, page: true },
        }),
      ],
    });
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await openReels();

    fireEvent.click(await screen.findByRole("button", { name: "Follow" }));
    expect(await screen.findByRole("button", { name: "Following" })).toBeTruthy();
    expect(asMock(client.followPage)).toHaveBeenCalledWith("page-1");
  });

  it("shares a reel to the feed (R-01)", async () => {
    const client = makeClient([makePost()], { reels: [reel()] });
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await openReels();

    fireEvent.click(await screen.findByRole("button", { name: "Share" }));
    await waitFor(() => expect(asMock(client.repost)).toHaveBeenCalledWith("reel-1"));
    expect(await screen.findByText("Shared to your feed")).toBeTruthy();
  });

  it("opens the comment sheet and posts a comment (R-01)", async () => {
    const client = makeClient([makePost()], { reels: [reel({ comments: 1 })] });
    asMock(client.listComments).mockResolvedValue([
      {
        id: "c1",
        author: { id: "u2", handle: "bob", displayName: "Bob", online: false },
        body: "Nice one",
        createdAt: new Date().toISOString(),
      },
    ]);
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await openReels();

    fireEvent.click(await screen.findByRole("button", { name: "Comments" }));
    expect(await screen.findByRole("dialog", { name: /Comments on Alice/ })).toBeTruthy();
    expect(await screen.findByText("Nice one")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "Sweet" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(asMock(client.addComment)).toHaveBeenCalledWith("reel-1", "Sweet"));
    expect(await screen.findByText("Sweet")).toBeTruthy();
  });

  it("shows buffering and a retry when playback fails (R-02)", async () => {
    const { container } = render(
      <FeedView
        client={makeClient([makePost()], { reels: [reel()] })}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
      />,
    );
    await openReels();
    const video = await waitFor(() => {
      const element = container.querySelector("video.reel-video");
      expect(element).toBeTruthy();
      return element as HTMLVideoElement;
    });

    fireEvent.waiting(video);
    expect(container.querySelector(".reel-spinner")).toBeTruthy();

    fireEvent.error(video);
    expect(await screen.findByText("Couldn't play this reel.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("loads the next page at the end of the list (R-05)", async () => {
    const client = makeClient([makePost()], { reels: [] });
    asMock(client.listReels).mockResolvedValueOnce({ items: [reel({ id: "r1" })], nextCursor: "c1" });
    asMock(client.listReels).mockResolvedValueOnce({ items: [reel({ id: "r2" })], nextCursor: null });
    const { container } = render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await openReels();

    await waitFor(() => expect(container.querySelectorAll(".reel")).toHaveLength(2));
    expect(asMock(client.listReels)).toHaveBeenCalledWith("c1");
  });

  it("persists the mute preference across sessions (R-08)", async () => {
    const first = render(
      <FeedView
        client={makeClient([makePost()], { reels: [reel()] })}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
      />,
    );
    await openReels();
    fireEvent.click(await screen.findByRole("button", { name: "Unmute reels" }));
    expect(localStorage.getItem("botifyr.reels.muted")).toBe("false");
    first.unmount();

    render(
      <FeedView
        client={makeClient([makePost()], { reels: [reel()] })}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
      />,
    );
    await openReels();
    expect(await screen.findByRole("button", { name: "Mute reels" })).toBeTruthy();
  });

  it("does not autoplay under reduced motion (R-11)", async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    render(
      <FeedView
        client={makeClient([makePost()], { reels: [reel()] })}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
      />,
    );
    await openReels();
    await screen.findByRole("button", { name: "Like" });
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});

/**
 * Post-level interactions (docs/post-improvement-plan.md, POST-1…POST-11):
 * live text, keyboard-operable menus, destructive confirmation, optimistic
 * rollback, comment feedback, repost fidelity and broken-media fallback.
 */
describe("Post interactions", () => {
  it("auto-links URLs and makes inline hashtags actionable (POST-1)", async () => {
    const post = makePost({ body: "Read https://example.com/notes and tag it #design" });
    const { container } = render(
      <FeedView client={makeClient([post])} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );
    await screen.findByText(/Read /);

    const anchor = container.querySelector(".feed-body a.feed-link");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/notes");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByRole("button", { name: "#design" })).toBeTruthy();
  });

  it("closes the More-options menu on Escape (POST-2)", async () => {
    render(<FeedView client={makeClient([makePost()])} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    const trigger = screen.getByRole("button", { name: "More options" });
    fireEvent.click(trigger);
    await screen.findByRole("menuitem", { name: "Report post" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("confirms before deleting an owned post (POST-3)", async () => {
    const own = makePost({ author: { id: "viewer-1", handle: "me", displayName: "Me", online: true } });
    const client = makeClient([own]);
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete post" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(asMock(client.deletePost)).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(asMock(client.deletePost)).toHaveBeenCalledWith("post-1"));
  });

  it("rolls back a failed reaction and shows an inline error (POST-4)", async () => {
    const post = makePost({ likes: 2, reactions: { like: 2 } });
    const client = {
      ...makeClient([post]),
      reactPost: vi.fn().mockRejectedValue(new Error("offline")),
      unreactPost: vi.fn().mockResolvedValue(undefined),
    } as unknown as BotifyrClient;
    const { container } = render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "Like" }));
    fireEvent.click(await screen.findByRole("button", { name: "Love" }));

    await waitFor(() => expect(container.querySelector(".feed-post-feedback.error")).toBeTruthy());
    expect(container.querySelector(".feed-post-feedback.error")?.textContent).toContain("reaction");
    expect(container.querySelector(".feed-reaction-summary")?.textContent).toContain("2");
  });

  it("keeps the draft and reports a failed comment (POST-5)", async () => {
    const client = {
      ...makeClient([makePost()]),
      addComment: vi.fn().mockRejectedValue(new Error("nope")),
    } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    const input = (await screen.findByPlaceholderText("Write a comment…")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));

    expect(await screen.findByText(/Couldn't post your comment/)).toBeTruthy();
    expect(input.value).toBe("hello");
  });

  it("renders the full gallery of a reposted original (POST-6)", async () => {
    const original = makePost({
      id: "orig",
      body: "Original body",
      images: ["/a.png", "/b.png"],
      imageUrl: "/a.png",
    });
    const repost = makePost({ id: "rep", body: "Sharing this", repostOf: "orig", original });
    const { container } = render(
      <FeedView client={makeClient([repost])} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );
    await screen.findByText("Sharing this");
    expect(container.querySelectorAll(".feed-repost .feed-image-grid .feed-image-img")).toHaveLength(2);
  });

  it("degrades a broken image to a placeholder (POST-7)", async () => {
    const post = makePost({ imageUrl: "/broken.png" });
    const { container } = render(
      <FeedView client={makeClient([post])} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );
    await screen.findByText("A quiet feed is a happy feed.");

    const img = container.querySelector("img.feed-image-img");
    expect(img).toBeTruthy();
    fireEvent.error(img as HTMLImageElement);
    expect(await screen.findByText(/Image unavailable/)).toBeTruthy();
    expect(container.querySelector(".feed-media-broken")).toBeTruthy();
  });

  it("lets an author delete their own comment with confirmation (POST-11)", async () => {
    const comment = {
      id: "c1",
      author: { id: "viewer-1", handle: "me", displayName: "Me", online: false },
      body: "my comment",
      createdAt: new Date().toISOString(),
    };
    const deleteComment = vi.fn().mockResolvedValue(undefined);
    const client = {
      ...makeClient([makePost({ comments: 1 })]),
      listCommentsPage: vi.fn().mockResolvedValue({ items: [comment], nextCursor: null }),
      deleteComment,
    } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("my comment");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete comment?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteComment).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.queryByText("my comment")).toBeNull());
  });

  it("cancels the delete confirmation with Escape and focuses Cancel (POST-3)", async () => {
    const own = makePost({ author: { id: "viewer-1", handle: "me", displayName: "Me", online: true } });
    const client = makeClient([own]);
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete post" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(asMock(client.deletePost)).not.toHaveBeenCalled();
    expect(screen.getByText("A quiet feed is a happy feed.")).toBeTruthy();
  });

  it("rolls back a failed save and reports it (POST-4)", async () => {
    const client = {
      ...makeClient([makePost({ savedByMe: false })]),
      savePost: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    expect(save.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText(/Couldn't update your saved posts/)).toBeTruthy();
    await waitFor(() => expect(save.getAttribute("aria-pressed")).toBe("false"));
  });

  it("routes a reply to the selected comment (POST-5)", async () => {
    const comment = {
      id: "c1",
      author: { id: "author-1", handle: "alice", displayName: "Alice", online: false },
      body: "top comment",
      createdAt: new Date().toISOString(),
    };
    const addComment = vi.fn().mockImplementation((_id: string, body: string, parentId?: string) =>
      Promise.resolve({
        id: `r-${body}`,
        author: { id: "viewer-1", handle: "me", displayName: "Me", online: false },
        body,
        parentId,
        createdAt: new Date().toISOString(),
      }),
    );
    const client = {
      ...makeClient([makePost({ comments: 1 })]),
      listCommentsPage: vi.fn().mockResolvedValue({ items: [comment], nextCursor: null }),
      addComment,
    } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("top comment");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const input = (await screen.findByPlaceholderText("Write a reply…")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "nice" } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));
    await waitFor(() => expect(addComment).toHaveBeenCalledWith("post-1", "nice", "c1"));
  });

  it("renders video posts with an accessible name (POST-7)", async () => {
    const post = makePost({ body: "A clip", videos: ["/v1/feed/image?t=v"] });
    const { container } = render(
      <FeedView client={makeClient([post])} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );
    await screen.findByText("A clip");
    const video = container.querySelector("video.feed-video");
    expect(video?.getAttribute("aria-label")).toBe("Video");
  });

  it("exposes a focusable reaction summary (POST-8)", async () => {
    const post = makePost({ likes: 3, reactions: { like: 3 } });
    render(<FeedView client={makeClient([post])} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");
    const summary = screen.getByRole("button", { name: /3 reactions/ });
    expect(summary.getAttribute("title")).toContain("Like: 3");
  });

  it("renders a semantic timestamp (POST-9)", async () => {
    const createdAt = new Date("2024-05-01T10:20:30.000Z").toISOString();
    const { container } = render(
      <FeedView client={makeClient([makePost({ createdAt })])} cloudUrl="http://cloud" viewerId="viewer-1" />,
    );
    await screen.findByText("A quiet feed is a happy feed.");
    const time = container.querySelector(".feed-author time");
    expect(time?.getAttribute("datetime")).toBe(createdAt);
    expect(time?.getAttribute("title")).toBeTruthy();
  });

  it("previews the first two comments behind a View-all action (POST comment preview)", async () => {
    const comments = [1, 2, 3].map((n) => ({
      id: `c${n}`,
      author: { id: "author-1", handle: "alice", displayName: "Alice", online: false },
      body: `comment ${n}`,
      createdAt: new Date().toISOString(),
    }));
    const client = {
      ...makeClient([makePost({ comments: 3 })]),
      listCommentsPage: vi.fn().mockResolvedValue({ items: comments, nextCursor: null }),
    } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("comment 1");
    expect(screen.getByText("comment 2")).toBeTruthy();
    expect(screen.queryByText("comment 3")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /View all 3 comments/ }));
    expect(await screen.findByText("comment 3")).toBeTruthy();
  });

  it("loads more comments a page at a time (POST-12)", async () => {
    const make = (n: number) => ({
      id: `c${n}`,
      author: { id: "author-1", handle: "alice", displayName: "Alice", online: false },
      body: `comment ${n}`,
      createdAt: new Date(Date.now() + n).toISOString(),
    });
    const listCommentsPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [make(1), make(2)], nextCursor: "2" })
      .mockResolvedValueOnce({ items: [make(3)], nextCursor: null });
    const client = {
      ...makeClient([makePost({ comments: 3 })]),
      listCommentsPage,
    } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("comment 1");
    // The first page has two threads and more available.
    expect(screen.queryByText("comment 3")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Load more comments" }));
    expect(await screen.findByText("comment 3")).toBeTruthy();
    expect(listCommentsPage).toHaveBeenLastCalledWith("post-1", "2", 20);
  });

  it("copies a permalink from the post menu (POST-13)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<FeedView client={makeClient([makePost()])} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0] as string).toContain("#post=post-1");
    expect(await screen.findByText(/Link copied/)).toBeTruthy();
  });

  it("edits an owned post inline (POST-edit)", async () => {
    const own = makePost({ author: { id: "viewer-1", handle: "me", displayName: "Me", online: true } });
    const editPost = vi.fn().mockResolvedValue({ ...own, body: "Edited body" });
    const client = { ...makeClient([own]), editPost } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText("A quiet feed is a happy feed.");

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit post" }));
    const input = await screen.findByRole("textbox", { name: "Edit post" });
    fireEvent.change(input, { target: { value: "Edited body" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(editPost).toHaveBeenCalledWith("post-1", "Edited body"));
    expect(await screen.findByText("Edited body")).toBeTruthy();
  });

  it("highlights the permalink-focused post (POST-13)", async () => {
    const { container } = render(
      <FeedView
        client={makeClient([makePost()])}
        cloudUrl="http://cloud"
        viewerId="viewer-1"
        focusPostId="post-1"
      />,
    );
    await screen.findByText("A quiet feed is a happy feed.");
    expect(container.querySelector("article.feed-post.feed-post-focus")).toBeTruthy();
  });

  it("opens a person profile from an @mention (POST-14)", async () => {
    const getPersonByHandle = vi.fn().mockResolvedValue({
      person: { id: "author-1", handle: "alice", displayName: "Alice", online: false },
      posts: [],
    });
    const client = {
      ...makeClient([makePost({ body: "say hi to @alice" })]),
      getPersonByHandle,
    } as unknown as BotifyrClient;
    render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
    await screen.findByText(/say hi to/);

    fireEvent.click(screen.getByRole("button", { name: "@alice" }));
    expect(await screen.findByRole("dialog", { name: "Profile for alice" })).toBeTruthy();
    expect(getPersonByHandle).toHaveBeenCalledWith("alice");
  });
});

/**
 * Reusable post experience: the same `PostCard` (rich text, media, actions)
 * must render consistently in the Group stream and album timelines, not just
 * the main Feed (docs/post-improvement-plan.md §D / §E).
 */
describe("Post reuse across contexts", () => {
  it("renders the shared post card in a Group stream", async () => {
    const post = makePost({ body: "Group post with https://example.com/g and #grouptag" });
    const client = {
      ...makeClient([]),
      getGroup: vi.fn().mockResolvedValue({
        id: "g1",
        handle: "acme",
        name: "Acme",
        ownerId: "owner",
        members: 3,
        joined: true,
        createdAt: new Date().toISOString(),
      }),
      groupPosts: vi.fn().mockResolvedValue([post]),
    } as unknown as BotifyrClient;
    const { container } = render(
      <FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" groupHandle="acme" />,
    );

    await screen.findByText(/Group post/);
    expect(container.querySelector(".feed-post .feed-body a.feed-link")).toBeTruthy();
    expect(screen.getByRole("button", { name: "More options" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Comment" })).toBeTruthy();
  });

  it("renders the shared post card in an album timeline", async () => {
    const post = makePost({
      body: "Album photo caption",
      images: ["/a.png", "/b.png"],
      imageUrl: "/a.png",
    });
    const client = {
      ...makeClient([]),
      listAlbumPosts: vi.fn().mockResolvedValue([post]),
    } as unknown as BotifyrClient;
    const { container } = render(
      <FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" albumName="Trip" />,
    );

    await screen.findByText("Album photo caption");
    expect(container.querySelectorAll(".feed-image-grid .feed-image-img")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "More options" })).toBeTruthy();
  });
});
