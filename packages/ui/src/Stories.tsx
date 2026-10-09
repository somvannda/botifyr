import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { BotifyrClient, Story } from "@botifyr/client";
import type { Session } from "@botifyr/shared";
import { authorEmoji, authorName, Avatar, relativeTime, resolveAvatar } from "./feedKit";

/**
 * Stories — the tray + full-screen viewer (docs/feed-next.md §FR-13,
 * docs/stories-implementation-plan.md). Self-contained: it fetches stories,
 * tracks seen state (local + server), and renders its own viewer, so `FeedView`
 * only has to place `<StoriesStrip />`.
 */

/** How long a photo story shows before auto-advancing. */
const STORY_IMAGE_DURATION_MS = 5000;
/** How long a text-only story shows (quicker to read than a photo). */
const STORY_TEXT_DURATION_MS = 4000;
/** A press held longer than this pauses instead of advancing. */
const STORY_HOLD_MS = 220;
const STORY_SEEN_KEY = "botifyr.seenStories";
/** Cap the locally-remembered seen list so it cannot grow without bound. */
const STORY_SEEN_LIMIT = 500;
/** Quick reactions offered on a story (docs/feed-next.md §FR-13). */
const STORY_REACTIONS = ["❤️", "😂", "😮", "😢", "👏"];

/** A creator's collection of active stories, in play order. */
type StoryGroup = { author: Story["author"]; stories: Story[] };

function storyDuration(story: Story): number {
  return story.imageUrl ? STORY_IMAGE_DURATION_MS : STORY_TEXT_DURATION_MS;
}

/** Read the locally-remembered "seen" story ids (seeded by the server view). */
function readSeenStories(): Record<string, true> {
  try {
    const raw = localStorage.getItem(STORY_SEEN_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return {};
    return Object.fromEntries(
      list.filter((id): id is string => typeof id === "string").map((id) => [id, true]),
    );
  } catch {
    return {};
  }
}

/**
 * Group a flat, newest-first story list into per-creator collections. Creators
 * keep the order they first appear in (most recent story first); each creator's
 * own stories play oldest→newest so the collection reads chronologically.
 */
function groupStories(stories: Story[]): StoryGroup[] {
  const now = Date.now();
  const groups = new Map<string, StoryGroup>();
  for (const story of stories) {
    // The server filters expired stories, but one may lapse while the app is open.
    if (new Date(story.expiresAt).getTime() <= now) continue;
    const existing = groups.get(story.author.id);
    if (existing) existing.stories.push(story);
    else groups.set(story.author.id, { author: story.author, stories: [story] });
  }
  for (const group of groups.values()) {
    group.stories.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
  return [...groups.values()];
}

/**
 * Full-screen story viewer. Progress segments cover the active creator's
 * collection; the timer advances within the collection, then to the next
 * creator, then exits. Supports tap zones, hold-to-pause, keyboard, and a reply
 * bar when the host provides one.
 */
function StoryViewer({
  groups,
  groupIndex,
  storyIndex,
  cloudUrl,
  onClose,
  onSeen,
  onNavigate,
  onReplyToStory,
  onReact,
}: {
  groups: StoryGroup[];
  groupIndex: number;
  storyIndex: number;
  cloudUrl: string;
  onClose: () => void;
  onSeen: (storyId: string) => void;
  onNavigate: (groupIndex: number, storyIndex: number) => void;
  onReplyToStory?: (author: Story["author"], text: string) => Promise<void> | void;
  onReact?: (storyId: string, emoji: string) => void;
}) {
  const group = groups[groupIndex];
  const story = group?.stories[storyIndex];
  const duration = story ? storyDuration(story) : STORY_IMAGE_DURATION_MS;

  const [userPaused, setUserPaused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [mediaError, setMediaError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reply, setReply] = useState("");
  const [replyState, setReplyState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const paused = userPaused || pageHidden;
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const heldRef = useRef(false);
  const suppressClickRef = useRef(false);
  const advanceRef = useRef<() => void>(() => {});
  const backRef = useRef<() => void>(() => {});

  // Reset per-story state whenever the active story changes.
  useEffect(() => {
    elapsedRef.current = 0;
    startedAtRef.current = Date.now();
    setElapsed(0);
    setUserPaused(false);
    setMediaError(false);
    setReloadKey(0);
    setReply("");
    setReplyState("idle");
  }, [story?.id]);

  // Record that the active story was viewed (locally + server-side).
  useEffect(() => {
    if (story) onSeen(story.id);
  }, [story, onSeen]);

  // Move focus into the viewer, and restore it to the opener on close.
  useEffect(() => {
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    closeRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  // Backgrounding the tab pauses progression instead of counting down unseen.
  useEffect(() => {
    function onVisibility() {
      const hidden = document.hidden;
      // Freeze the elapsed offset when leaving, so returning resumes (not restarts).
      if (hidden && !pausedRef.current) {
        elapsedRef.current += Date.now() - startedAtRef.current;
        setElapsed(elapsedRef.current);
      }
      setPageHidden(hidden);
    }
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  function restart() {
    elapsedRef.current = 0;
    startedAtRef.current = Date.now();
    setElapsed(0);
    setUserPaused(false);
    setCycle((value) => value + 1);
  }
  function advance() {
    if (!group) return;
    if (storyIndex + 1 < group.stories.length) onNavigate(groupIndex, storyIndex + 1);
    else if (groupIndex + 1 < groups.length) onNavigate(groupIndex + 1, 0);
    else onClose();
  }
  function back() {
    if (!group) return;
    if (storyIndex > 0) onNavigate(groupIndex, storyIndex - 1);
    else if (groupIndex > 0) onNavigate(groupIndex - 1, groups[groupIndex - 1].stories.length - 1);
    else restart();
  }
  advanceRef.current = advance;
  backRef.current = back;

  function pause() {
    if (pausedRef.current) return;
    elapsedRef.current += Date.now() - startedAtRef.current;
    setElapsed(elapsedRef.current);
    setUserPaused(true);
  }
  function resume() {
    setUserPaused(false);
  }

  // Advance timer: restarts only when the story, paused state, duration or an
  // explicit restart changes — not on ordinary re-renders.
  useEffect(() => {
    if (!story || paused) return;
    startedAtRef.current = Date.now();
    const remaining = Math.max(0, duration - elapsedRef.current);
    const timer = window.setTimeout(() => advanceRef.current(), remaining);
    return () => window.clearTimeout(timer);
  }, [story, paused, duration, cycle]);

  // Keyboard: Esc closes; ←/→ navigate; Space toggles pause. Never hijack keys
  // while the reply field is focused.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (typing) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        advanceRef.current();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        backRef.current();
      } else if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        if (pausedRef.current) resume();
        else pause();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!group || !story) return null;

  function startHold() {
    heldRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      heldRef.current = true;
      pause();
    }, STORY_HOLD_MS);
  }
  function endHold() {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (heldRef.current) {
      heldRef.current = false;
      suppressClickRef.current = true;
      resume();
    }
  }
  function tap(next: () => void) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    next();
  }
  async function submitReply() {
    const value = reply.trim();
    if (!value || !onReplyToStory || replyState === "sending") return;
    setReplyState("sending");
    try {
      await onReplyToStory(story.author, value);
      setReply("");
      setReplyState("sent");
    } catch {
      setReplyState("error");
    }
  }

  return (
    <div
      className="story-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Story by ${authorName(story.author)}`}
    >
      <div className="story-progress" aria-hidden="true">
        {group.stories.map((entry, i) => (
          <span key={entry.id} className={`story-seg${i < storyIndex ? " done" : ""}`}>
            {i === storyIndex && (
              <span
                key={entry.id}
                className="story-seg-fill"
                style={{
                  animationDuration: `${duration}ms`,
                  animationDelay: `${-elapsed}ms`,
                  animationPlayState: paused ? "paused" : "running",
                }}
              />
            )}
          </span>
        ))}
      </div>

      <div className="story-viewer-head">
        <Avatar
          emoji={authorEmoji(story.author)}
          name={authorName(story.author)}
          url={resolveAvatar(story.author.avatarUrl, cloudUrl)}
          size={32}
        />
        <span className="story-viewer-name">{authorName(story.author)}</span>
        <span className="story-viewer-when">{relativeTime(story.createdAt)}</span>
        {paused && (
          <span className="story-paused" role="status">
            Paused
          </span>
        )}
        <button
          ref={closeRef}
          type="button"
          className="story-close"
          onClick={onClose}
          aria-label="Close story"
        >
          ✕
        </button>
      </div>

      <div className="story-viewer-body">
        {story.imageUrl && !mediaError && (
          <img
            key={`${story.id}-${reloadKey}`}
            src={`${cloudUrl}${story.imageUrl}`}
            alt=""
            onError={() => setMediaError(true)}
          />
        )}
        {story.imageUrl && mediaError && (
          <div className="story-error" role="alert">
            <p>This story couldn’t load.</p>
            <div className="story-error-actions">
              <button
                type="button"
                onClick={() => {
                  setMediaError(false);
                  setReloadKey((value) => value + 1);
                }}
              >
                Retry
              </button>
              <button type="button" onClick={advance}>
                Next
              </button>
            </div>
          </div>
        )}
        {!story.imageUrl && <div className="story-text">{story.caption}</div>}
        {story.caption && story.imageUrl && !mediaError && (
          <div className="story-caption">{story.caption}</div>
        )}
      </div>

      {/* Tap zones: left third goes back, the rest advances. Hidden from AT —
          the visible nav buttons and arrow keys are the accessible controls. */}
      <div className="story-taps" aria-hidden="true">
        <div
          className="story-tap prev"
          onClick={() => tap(backRef.current)}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
        />
        <div
          className="story-tap next"
          onClick={() => tap(advanceRef.current)}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
        />
      </div>

      {(groups.length > 1 || group.stories.length > 1) && (
        <>
          <button
            type="button"
            className="story-nav prev"
            aria-label="Previous story"
            onClick={(event) => {
              event.stopPropagation();
              back();
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="story-nav next"
            aria-label="Next story"
            onClick={(event) => {
              event.stopPropagation();
              advance();
            }}
          >
            ›
          </button>
        </>
      )}

      {onReact && (
        <div className="story-reactions" role="group" aria-label="React to this story">
          {STORY_REACTIONS.map((emoji) => {
            const count = story.reactions?.[emoji] ?? 0;
            const active = story.myReaction === emoji;
            return (
              <button
                key={emoji}
                type="button"
                className={`story-reaction${active ? " active" : ""}`}
                aria-pressed={active}
                aria-label={`React ${emoji}`}
                onClick={() => onReact(story.id, emoji)}
              >
                <span aria-hidden="true">{emoji}</span>
                {count > 0 && <span className="story-reaction-count">{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {onReplyToStory && (
        <form
          className="story-reply"
          onSubmit={(event) => {
            event.preventDefault();
            void submitReply();
          }}
        >
          <input
            className="story-reply-input"
            type="text"
            value={reply}
            maxLength={500}
            placeholder={`Reply to ${authorName(story.author)}…`}
            aria-label={`Reply to ${authorName(story.author)}`}
            onChange={(event) => {
              setReply(event.target.value);
              if (replyState !== "sending") setReplyState("idle");
            }}
          />
          {replyState === "sent" ? (
            <span className="story-reply-status" role="status">
              Sent ✓
            </span>
          ) : (
            <button
              type="submit"
              className="story-reply-send"
              disabled={!reply.trim() || replyState === "sending"}
            >
              {replyState === "sending" ? "Sending…" : "Send"}
            </button>
          )}
          {replyState === "error" && (
            <span className="story-reply-status error" role="alert">
              Couldn’t send
            </span>
          )}
        </form>
      )}
    </div>
  );
}

/**
 * The story tray + its viewer. Fetches the viewer's active stories, groups them
 * by creator, tracks seen state (locally, seeded by the server's `viewedByMe`),
 * and opens `StoryViewer` on tap.
 */
export function StoriesStrip({
  client,
  cloudUrl,
  viewerId,
  onReplySent,
}: {
  client: BotifyrClient;
  cloudUrl: string;
  viewerId?: string;
  /** Called after a story reply is sent, so the host can open the DM (FR-13). */
  onReplySent?: (session: Session) => void;
}) {
  const [stories, setStories] = useState<Story[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storyError, setStoryError] = useState(false);
  const [storyOpen, setStoryOpen] = useState<{ authorId: string; storyId: string } | null>(null);
  const [seenStories, setSeenStories] = useState<Record<string, boolean>>(() => readSeenStories());
  const storyGroups = useMemo(() => groupStories(stories), [stories]);
  const storyRef = useRef<HTMLInputElement | null>(null);

  const loadStories = useCallback(async () => {
    setStoriesLoading(true);
    setStoryError(false);
    try {
      const list = await client.listStories();
      setStories(list);
      // Adopt server-recorded views so "seen" survives across devices.
      const viewed = list.filter((story) => story.viewedByMe).map((story) => story.id);
      if (viewed.length > 0) {
        setSeenStories((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const id of viewed) {
            if (!next[id]) {
              next[id] = true;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    } catch {
      setStoryError(true);
    } finally {
      setStoriesLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadStories();
  }, [loadStories]);

  // Remember viewed stories locally (the server view is authoritative on load).
  useEffect(() => {
    try {
      const ids = Object.keys(seenStories).slice(-STORY_SEEN_LIMIT);
      localStorage.setItem(STORY_SEEN_KEY, JSON.stringify(ids));
    } catch {
      // Storage may be unavailable; seen state simply won't persist.
    }
  }, [seenStories]);

  // If the active story is removed or expires while open, close gracefully.
  useEffect(() => {
    if (
      storyOpen &&
      !storyGroups.some(
        (group) =>
          group.author.id === storyOpen.authorId && group.stories.some((s) => s.id === storyOpen.storyId),
      )
    ) {
      setStoryOpen(null);
    }
  }, [storyGroups, storyOpen]);

  async function addStory(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const data = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.readAsDataURL(file);
    });
    if (!data) return;
    try {
      const media = await client.uploadFile({ name: file.name, mime: file.type, data });
      await client.createStory({ mediaId: media.id });
      await loadStories();
    } catch {
      // Ignore a failed story.
    }
  }

  const markStorySeen = useCallback(
    (storyId: string) => {
      setSeenStories((prev) => (prev[storyId] ? prev : { ...prev, [storyId]: true }));
      // Record the view server-side (best-effort; local state updates immediately).
      void client.viewStory(storyId).catch(() => {});
    },
    [client],
  );

  function openStory(authorId: string, storyId: string) {
    setStoryOpen({ authorId, storyId });
  }

  function navigateStory(groupIndex: number, storyIndex: number) {
    const group = storyGroups[groupIndex];
    const story = group?.stories[storyIndex];
    if (group && story) setStoryOpen({ authorId: group.author.id, storyId: story.id });
  }

  /** React to a story: optimistic locally, reconciled by refetch on failure. */
  function reactToStory(storyId: string, emoji: string) {
    const current = stories.find((story) => story.id === storyId);
    const prior = current?.myReaction ?? null;
    const next = prior === emoji ? "" : emoji;
    setStories((prev) =>
      prev.map((story) => {
        if (story.id !== storyId) return story;
        const reactions = { ...(story.reactions ?? {}) };
        if (prior) reactions[prior] = Math.max(0, (reactions[prior] ?? 1) - 1);
        if (next) reactions[next] = (reactions[next] ?? 0) + 1;
        return { ...story, reactions, myReaction: next || null };
      }),
    );
    void client.reactStory(storyId, next).catch(() => void loadStories());
  }

  /** Reply to a story via the existing DM channel (docs/feed-next.md §FR-13). */
  async function replyToStory(author: Story["author"], text: string): Promise<void> {
    const session = await client.openDm(author.id);
    await client.sendDm(session.id, text);
    // FR-13: a reply opens the DM, so hand the conversation back to the host.
    onReplySent?.(session);
  }

  return (
    <>
      <div className="stories-strip">
        {(() => {
          const ownGroup = viewerId ? storyGroups.find((group) => group.author.id === viewerId) : undefined;
          const ownSeen = ownGroup ? ownGroup.stories.every((s) => seenStories[s.id]) : false;
          const others = storyGroups.filter((group) => !viewerId || group.author.id !== viewerId);
          const firstUnseen = (group: StoryGroup): Story =>
            group.stories.find((s) => !seenStories[s.id]) ?? group.stories[0];
          return (
            <>
              <div className="story-tile story-own">
                <button
                  type="button"
                  className="story-own-main"
                  onClick={() =>
                    ownGroup
                      ? openStory(ownGroup.author.id, firstUnseen(ownGroup).id)
                      : storyRef.current?.click()
                  }
                  aria-label={ownGroup ? "View your story" : "Add to your story"}
                >
                  <span
                    className={`story-avatar${ownGroup && ownSeen ? " seen" : ""}${ownGroup ? "" : " add"}`}
                  >
                    {ownGroup?.stories[0]?.imageUrl ? (
                      <img src={`${cloudUrl}${ownGroup.stories[0].imageUrl}`} alt="" />
                    ) : (
                      "＋"
                    )}
                  </span>
                </button>
                {ownGroup && (
                  <button
                    type="button"
                    className="story-own-add"
                    onClick={() => storyRef.current?.click()}
                    aria-label="Add to your story"
                  >
                    ＋
                  </button>
                )}
                <span className="story-name">Your story</span>
              </div>

              {storiesLoading && storyGroups.length === 0 && (
                <>
                  <div className="story-tile story-skeleton" aria-hidden="true">
                    <span className="story-avatar" />
                  </div>
                  <div className="story-tile story-skeleton" aria-hidden="true">
                    <span className="story-avatar" />
                  </div>
                </>
              )}

              {storyError && (
                <button type="button" className="story-tile story-retry" onClick={() => void loadStories()}>
                  <span className="story-avatar add">↻</span>
                  <span className="story-name">Retry</span>
                </button>
              )}

              {!storiesLoading && !storyError && others.length === 0 && !ownGroup && (
                <span className="story-empty" role="status">
                  No stories yet
                </span>
              )}

              {others.map((group) => {
                const unseen = group.stories.some((s) => !seenStories[s.id]);
                const latest = group.stories[group.stories.length - 1];
                return (
                  <button
                    key={group.author.id}
                    type="button"
                    className="story-tile"
                    onClick={() => openStory(group.author.id, firstUnseen(group).id)}
                    aria-label={`${authorName(group.author)}${unseen ? " — new story" : " — viewed"}`}
                  >
                    <span className={`story-avatar${unseen ? "" : " seen"}`}>
                      {latest.imageUrl ? (
                        <img src={`${cloudUrl}${latest.imageUrl}`} alt="" />
                      ) : (
                        authorEmoji(group.author)
                      )}
                    </span>
                    <span className="story-name">{authorName(group.author)}</span>
                  </button>
                );
              })}
            </>
          );
        })()}
        <input ref={storyRef} type="file" accept="image/*" style={{ display: "none" }} onChange={addStory} />
      </div>

      {storyOpen &&
        (() => {
          const groupIndex = storyGroups.findIndex((group) => group.author.id === storyOpen.authorId);
          if (groupIndex < 0) return null;
          const activeGroup = storyGroups[groupIndex];
          const storyIndex = Math.max(
            0,
            activeGroup.stories.findIndex((s) => s.id === storyOpen.storyId),
          );
          return (
            <StoryViewer
              groups={storyGroups}
              groupIndex={groupIndex}
              storyIndex={storyIndex}
              cloudUrl={cloudUrl}
              onClose={() => setStoryOpen(null)}
              onSeen={markStorySeen}
              onNavigate={navigateStory}
              onReplyToStory={viewerId && activeGroup.author.id === viewerId ? undefined : replyToStory}
              onReact={viewerId && activeGroup.author.id === viewerId ? undefined : reactToStory}
            />
          );
        })()}
    </>
  );
}
