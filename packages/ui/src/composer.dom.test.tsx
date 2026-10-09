// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BotifyrClient, FeedPost, Page } from "@botifyr/client";
import { FeedView } from "./FeedView";

/**
 * Composer reliability (docs/composer-ux-audit.md, docs/composer-implementation-plan.md):
 * client-side limits that match the server, upload progress, error separation,
 * destination reset, schedule validation, and draft persistence.
 */

function makePost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: "post-1",
    author: { id: "author-1", handle: "alice", displayName: "Alice", online: false },
    body: "existing post",
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

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: "page-1",
    handle: "acme",
    name: "Acme",
    verified: false,
    followers: 0,
    following: false,
    role: "admin",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeClient(overrides: Partial<BotifyrClient> = {}): BotifyrClient {
  return {
    listFeed: vi.fn().mockResolvedValue({ items: [makePost()], nextCursor: null }),
    listStories: vi.fn().mockResolvedValue([]),
    listReels: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listMyPages: vi.fn().mockResolvedValue([]),
    searchPeople: vi.fn().mockResolvedValue([]),
    uploadFile: vi.fn().mockResolvedValue({ id: "media-1" }),
    createPost: vi.fn().mockResolvedValue(makePost({ id: "new-post", body: "hello" })),
    reportPost: vi.fn().mockResolvedValue(undefined),
    blockUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as BotifyrClient;
}

function renderFeed(client: BotifyrClient) {
  return render(<FeedView client={client} cloudUrl="http://cloud" viewerId="viewer-1" />);
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"][accept="image/*,video/*"]');
  if (!input) throw new Error("file input not found");
  return input;
}

function imageFile(name = "pic.png", type = "image/png", size = 1024): File {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Composer mood picker", () => {
  it("inserts a chosen emoji into the draft", async () => {
    renderFeed(makeClient());
    await screen.findByText("existing post");

    fireEvent.click(screen.getByRole("button", { name: /Mood/ }));
    const listbox = await screen.findByRole("listbox", { name: "Add a mood emoji" });
    expect(within(listbox).getAllByRole("option").length).toBeGreaterThan(10);

    fireEvent.click(within(listbox).getAllByRole("option")[0]);
    await waitFor(() => expect(screen.getByLabelText("Post text")).toHaveProperty("value", "😀"));
  });
});

describe("Composer media limits", () => {
  it("rejects an oversized video before reading or uploading it", async () => {
    const client = makeClient();
    const { container } = renderFeed(client);
    await screen.findByText("existing post");

    const big = imageFile("clip.mp4", "video/mp4", 16 * 1024 * 1024);
    fireEvent.change(fileInput(container), { target: { files: [big] } });

    expect(await screen.findByText(/too large/)).toBeTruthy();
    expect(client.uploadFile).not.toHaveBeenCalled();
  });

  it("rejects a non-media file with a clear message", async () => {
    const client = makeClient();
    const { container } = renderFeed(client);
    await screen.findByText("existing post");

    const doc = imageFile("notes.txt", "text/plain", 10);
    fireEvent.change(fileInput(container), { target: { files: [doc] } });

    expect(await screen.findByText(/isn't an image or video/)).toBeTruthy();
  });
});

describe("Composer publish lifecycle", () => {
  it("shows upload progress, then confirms success", async () => {
    const upload = deferred<{ id: string }>();
    const client = makeClient({ uploadFile: vi.fn().mockReturnValue(upload.promise) });
    const { container } = renderFeed(client);
    await screen.findByText("existing post");

    fireEvent.change(fileInput(container), { target: { files: [imageFile()] } });
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "hello" } });
    await waitFor(() => expect(container.querySelector(".feed-composer-thumb")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    const bar = await screen.findByRole("progressbar", { name: "Uploading media" });
    expect(bar.getAttribute("aria-valuenow")).toBe("0");

    await act(async () => {
      upload.resolve({ id: "media-1" });
    });

    expect(await screen.findByText("Post published")).toBeTruthy();
    expect(client.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ body: "hello", mediaIds: ["media-1"] }),
    );
    // The composer is reset after a confirmed publish.
    await waitFor(() => expect(screen.getByLabelText("Post text")).toHaveProperty("value", ""));
    expect(container.querySelector(".feed-composer-thumb")).toBeNull();
  });

  it("keeps the draft and shows a composer error when the API fails", async () => {
    const client = makeClient({ createPost: vi.fn().mockRejectedValue(new Error("network down")) });
    renderFeed(client);
    await screen.findByText("existing post");

    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    const alert = await screen.findByText("network down");
    expect(alert.closest(".feed-composer-error")).toBeTruthy();
    expect(screen.getByLabelText("Post text")).toHaveProperty("value", "keep me");
    // The timeline error/Retry must not be used for a publish failure.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("does not silently turn a past schedule into an immediate post", async () => {
    const client = makeClient();
    const { container } = renderFeed(client);
    await screen.findByText("existing post");

    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "later" } });
    const when = container.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    expect(when).toBeTruthy();
    fireEvent.change(when!, { target: { value: "2020-01-01T10:00" } });

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    expect(await screen.findByText(/future time/i)).toBeTruthy();
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("resets the Page destination after publishing as a Page", async () => {
    const page = makePage();
    const client = makeClient({ listMyPages: vi.fn().mockResolvedValue([page]) });
    renderFeed(client);
    await screen.findByText("existing post");

    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "from the brand" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Post as" }), {
      target: { value: page.id },
    });
    expect(await screen.findByText(/Posting as Acme/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByText("Posted as Acme")).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByRole("combobox", { name: "Post as" }) as HTMLSelectElement).value).toBe(""),
    );
  });
});

describe("Composer image descriptions", () => {
  it("sends per-image alt text with the post", async () => {
    const client = makeClient();
    const { container } = renderFeed(client);
    await screen.findByText("existing post");

    fireEvent.change(fileInput(container), { target: { files: [imageFile("cat.png")] } });
    await waitFor(() => expect(container.querySelector(".feed-composer-thumb")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Alt text for cat.png"), {
      target: { value: "A cat on a mat" },
    });
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "look" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(client.createPost).toHaveBeenCalledWith(
        expect.objectContaining({ alts: ["A cat on a mat"] }),
      ),
    );
  });

  it("uses the stored alt text when rendering a post image", async () => {
    const post = makePost({ images: ["/v1/feed/image?t=a"], imageAlts: ["A red fox"] });
    const { container } = renderFeed(makeClient({ listFeed: vi.fn().mockResolvedValue({ items: [post], nextCursor: null }) }));
    await screen.findByText("existing post");

    const img = container.querySelector("img.feed-image-img");
    expect(img?.getAttribute("alt")).toBe("A red fox");
  });
});

describe("Composer draft persistence", () => {
  it("restores a saved draft and lets the user discard it", async () => {
    localStorage.setItem("botifyr.feedDraft", "unfinished thought");
    renderFeed(makeClient());
    await screen.findByText("existing post");

    expect(screen.getByLabelText("Post text")).toHaveProperty("value", "unfinished thought");
    expect(screen.getByText("Draft restored")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Post text")).toHaveProperty("value", "");
    expect(localStorage.getItem("botifyr.feedDraft")).toBeNull();
  });

  it("persists typed text to storage", async () => {
    renderFeed(makeClient());
    await screen.findByText("existing post");

    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "saved locally" } });
    await waitFor(() => expect(localStorage.getItem("botifyr.feedDraft")).toBe("saved locally"));
  });
});
