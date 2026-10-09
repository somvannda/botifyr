// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BotifyrClient, FeedPost, Page } from "@botifyr/client";
import type { User } from "@botifyr/shared";
import { FeedSidebar } from "./FeedSidebar";
import { FeedView } from "./FeedView";

const user: User = {
  id: "viewer-1",
  email: "me@example.com",
  createdAt: new Date().toISOString(),
  role: "user",
  handle: "me",
  displayName: "Me",
  avatarEmoji: "🙂",
};

const studio: Page = {
  id: "page-1",
  handle: "studio",
  name: "Studio",
  verified: false,
  followers: 3,
  following: false,
  role: "admin",
  createdAt: new Date().toISOString(),
};

function makePost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: "post-1",
    author: { id: "author-1", handle: "alice", displayName: "Alice", online: false },
    body: "A post body",
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

function makeClient(overrides: Record<string, unknown> = {}): BotifyrClient {
  return {
    listFeed: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listStories: vi.fn().mockResolvedValue([]),
    listMyPages: vi.fn().mockResolvedValue([]),
    getPostDraft: vi.fn().mockResolvedValue(null),
    savePostDraft: vi.fn().mockResolvedValue({ ok: true }),
    deletePostDraft: vi.fn().mockResolvedValue({ ok: true }),
    listSaved: vi.fn().mockResolvedValue([]),
    viewPost: vi.fn().mockResolvedValue(undefined),
    listMemories: vi.fn().mockResolvedValue([]),
    listBirthdays: vi.fn().mockResolvedValue([]),
    listUserPosts: vi.fn().mockResolvedValue([]),
    listFriends: vi.fn().mockResolvedValue([]),
    listFriendRequests: vi.fn().mockResolvedValue([]),
    suggestPeople: vi.fn().mockResolvedValue([]),
    getDashboard: vi.fn().mockResolvedValue({
      posts: 0,
      reactions: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      reach: 0,
      friends: 0,
      pages: 0,
      followers: 0,
      recent: [],
    }),
    ...overrides,
  } as unknown as BotifyrClient;
}

function renderSidebar(over: Partial<Parameters<typeof FeedSidebar>[0]> = {}) {
  const props = {
    user,
    cloudUrl: "http://cloud",
    active: "feed" as const,
    onNavigate: vi.fn(),
    pages: [studio],
    actingPage: null,
    onActPage: vi.fn(),
    onOpenPage: vi.fn(),
    onCreatePage: vi.fn(),
    friendRequests: 2,
    birthdays: 1,
    ...over,
  };
  render(<FeedSidebar {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("FeedSidebar", () => {
  it("renders every destination and reports navigation", () => {
    const props = renderSidebar();
    for (const label of ["Profile", "Friends", "Dashboard", "Pages", "Memories", "Saved", "Birthdays"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: /Friends/ }));
    expect(props.onNavigate).toHaveBeenCalledWith("friends");
  });

  it("expands the Pages switcher and switches identity", () => {
    const onActPage = vi.fn();
    renderSidebar({ onActPage });
    fireEvent.click(screen.getByRole("button", { name: /Pages/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Studio$/ }));
    expect(onActPage).toHaveBeenCalledWith(studio);
  });
});

describe("Feed sidebar destinations", () => {
  it("renders the Saved page with saved posts", async () => {
    const client = makeClient({
      listSaved: vi.fn().mockResolvedValue([makePost({ id: "saved-1", body: "Saved body" })]),
    });
    render(
      <FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" section="saved" />,
    );
    expect(await screen.findByText("Saved body")).toBeTruthy();
  });

  it("renders dashboard stats", async () => {
    const client = makeClient({
      getDashboard: vi.fn().mockResolvedValue({
        posts: 7,
        reactions: 3,
        comments: 1,
        shares: 0,
        saves: 2,
        reach: 9,
        friends: 4,
        pages: 1,
        followers: 5,
        recent: [],
      }),
    });
    render(
      <FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" section="dashboard" />,
    );
    expect(await screen.findByText("Reach")).toBeTruthy();
    expect(await screen.findByText("7")).toBeTruthy();
  });
});
