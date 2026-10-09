import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, UIEvent } from "react";
import type {
  BotifyrClient,
  FeedComment,
  FeedPost,
  Group,
  GroupJoinRequest,
  GroupMember,
  Page,
  Person,
} from "@botifyr/client";
import type { Session } from "@botifyr/shared";
import {
  BookmarkIcon,
  CameraIcon,
  ChartIcon,
  CheckIcon,
  CloseIcon,
  CubeIcon,
  ForwardIcon,
  FullscreenIcon,
  GearIcon,
  HomeIcon,
  LockIcon,
  MenuIcon,
  MessageIcon,
  MoreIcon,
  PanelIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  ShieldIcon,
  SmileyIcon,
  SparkIcon,
  UserPlusIcon,
  UsersIcon,
  VolumeIcon,
} from "./Icons";
import { authorEmoji, authorName, Avatar, relativeTime, resolveAvatar } from "./feedKit";
import { StoriesStrip } from "./Stories";

/**
 * Feed — the social wall / timeline (see docs/feed.md).
 *
 * Backed by the cloud API: `client.listFeed`, `createPost`, `likePost`,
 * `sharePost`, `listComments`, `addComment`, and `deletePost`. Visibility is
 * friends-only, enforced server-side.
 */

/** Prepend a post unless it is already present, so a realtime refresh racing a
 *  local insert can never render two cards for the same post. */
function prependUnique(list: FeedPost[], post: FeedPost): FeedPost[] {
  return list.some((existing) => existing.id === post.id) ? list : [post, ...list];
}

function HeartIcon({ size = 18, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}

const REACTIONS: Array<{ key: string; emoji: string; label: string }> = [
  { key: "like", emoji: "👍", label: "Like" },
  { key: "love", emoji: "❤️", label: "Love" },
  { key: "care", emoji: "🤗", label: "Care" },
  { key: "haha", emoji: "😂", label: "Haha" },
  { key: "wow", emoji: "😮", label: "Wow" },
  { key: "sad", emoji: "😢", label: "Sad" },
  { key: "angry", emoji: "😡", label: "Angry" },
];

function reactionEmoji(key: string | null | undefined): string {
  return REACTIONS.find((entry) => entry.key === key)?.emoji ?? "👍";
}

/** Human-readable breakdown of a post's reactions, e.g. "Love: 2\nLike: 1". */
function reactionBreakdown(reactions?: Record<string, number>): string {
  const entries = Object.entries(reactions ?? {}).filter(([, count]) => count > 0);
  return entries
    .map(([key, count]) => `${REACTIONS.find((entry) => entry.key === key)?.label ?? key}: ${count}`)
    .join("\n");
}

/** Full local timestamp for the `<time>` tooltip. */
function fullDate(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
}

/**
 * Render post text as live content: `http(s)://` URLs become anchors, inline
 * `#hashtags` open the tag view, and `@mentions` are styled distinctly. A tiny
 * tokenizer (no innerHTML) so text can never inject markup.
 */
const RICH_TOKEN_RE = /(https?:\/\/[^\s<>()]+|#[\p{L}\p{N}_]+|@[A-Za-z0-9_]+)/gu;

function renderRichText(
  text: string,
  onOpenTag?: (tag: string) => void,
  keyPrefix = "rich",
  onOpenMention?: (handle: string) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  RICH_TOKEN_RE.lastIndex = 0;
  while ((match = RICH_TOKEN_RE.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    if (/^https?:\/\//i.test(token)) {
      const label = token.replace(/[.,;:!?)\]]+$/, "");
      nodes.push(
        <a key={key} className="feed-link" href={label} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
      if (label.length < token.length) nodes.push(token.slice(label.length));
    } else if (token.startsWith("#")) {
      const tag = token.slice(1).toLowerCase();
      nodes.push(
        onOpenTag ? (
          <button key={key} type="button" className="feed-inline-tag" onClick={() => onOpenTag(tag)}>
            {token}
          </button>
        ) : (
          <span key={key} className="feed-inline-tag">
            {token}
          </span>
        ),
      );
    } else {
      const handle = token.slice(1);
      nodes.push(
        onOpenMention ? (
          <button
            key={key}
            type="button"
            className="feed-mention feed-mention-btn"
            onClick={() => onOpenMention(handle)}
          >
            {token}
          </button>
        ) : (
          <span key={key} className="feed-mention">
            {token}
          </span>
        ),
      );
    }
    last = match.index + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Post body with a "See more" clamp for long posts, so one wall of text can't
 * dominate the feed. Short posts render exactly as before.
 */
function PostBody({
  text,
  onOpenTag,
  onOpenMention,
}: {
  text: string;
  onOpenTag?: (tag: string) => void;
  onOpenMention?: (handle: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 520 || (text.match(/\n/g)?.length ?? 0) > 6;
  return (
    <>
      <p className={`feed-body${long && !expanded ? " feed-body-clamped" : ""}`}>
        {renderRichText(text, onOpenTag, "body", onOpenMention)}
      </p>
      {long && (
        <button
          type="button"
          className="feed-body-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "See less" : "See more"}
        </button>
      )}
    </>
  );
}

/** Full-screen image viewer for a post's media (click an image to open). */
function MediaLightbox({
  images,
  index,
  cloudUrl,
  onClose,
  onNavigate,
}: {
  images: string[];
  index: number;
  cloudUrl: string;
  onClose: () => void;
  onNavigate: (next: number) => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") onNavigate((index + 1) % images.length);
      else if (event.key === "ArrowLeft") onNavigate((index - 1 + images.length) % images.length);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, images.length, onClose, onNavigate]);

  return (
    <div
      className="feed-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
    >
      <img
        className="feed-lightbox-img"
        src={`${cloudUrl}${images[index]}`}
        alt=""
        onClick={(event) => event.stopPropagation()}
      />
      {images.length > 1 && (
        <>
          <button
            type="button"
            className="feed-lightbox-nav prev"
            aria-label="Previous image"
            onClick={(event) => {
              event.stopPropagation();
              onNavigate((index - 1 + images.length) % images.length);
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="feed-lightbox-nav next"
            aria-label="Next image"
            onClick={(event) => {
              event.stopPropagation();
              onNavigate((index + 1) % images.length);
            }}
          >
            ›
          </button>
          <div className="feed-lightbox-count">
            {index + 1} / {images.length}
          </div>
        </>
      )}
      <button
        type="button"
        className="feed-lightbox-close"
        aria-label="Close image viewer"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        ✕
      </button>
    </div>
  );
}

/** A post image that degrades gracefully when the asset fails to load. */
function FeedImage({
  src,
  alt,
  interactive,
  label,
  onActivate,
}: {
  src: string;
  alt: string;
  interactive?: boolean;
  label?: string;
  onActivate?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="feed-image-img feed-media-broken" role="img" aria-label="Image unavailable">
        <span aria-hidden="true">🖼️</span> Image unavailable
      </div>
    );
  }
  return (
    <img
      className="feed-image-img"
      src={src}
      alt={alt}
      loading="lazy"
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      onClick={interactive ? onActivate : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onActivate?.();
              }
            }
          : undefined
      }
      onError={() => setFailed(true)}
    />
  );
}

/** Render a post's attachments: videos, a multi-image grid, or a single image. */
function PostMedia({
  images,
  videos,
  imageUrl,
  imageAlts,
  cloudUrl,
  onOpenImage,
}: {
  images?: string[];
  videos?: string[];
  imageUrl?: string;
  /** Per-image accessibility descriptions, parallel to the rendered gallery. */
  imageAlts?: string[];
  cloudUrl: string;
  onOpenImage?: (index: number) => void;
}) {
  const gallery = images && images.length > 0 ? images : imageUrl ? [imageUrl] : [];
  if (videos && videos.length > 0) {
    return (
      <div className="feed-videos">
        {videos.map((src, index) => (
          <video
            key={src}
            className="feed-video"
            src={`${cloudUrl}${src}`}
            controls
            preload="metadata"
            aria-label={videos.length > 1 ? `Video ${index + 1} of ${videos.length}` : "Video"}
          />
        ))}
      </div>
    );
  }
  if (gallery.length > 1) {
    return (
      <div className={`feed-image-grid feed-image-grid-${Math.min(gallery.length, 4)}`}>
        {gallery.map((src, index) => {
          const alt = imageAlts?.[index] || `Post attachment ${index + 1}`;
          return (
            <FeedImage
              key={src}
              src={`${cloudUrl}${src}`}
              alt={alt}
              interactive={Boolean(onOpenImage)}
              label={
                imageAlts?.[index]
                  ? `${imageAlts[index]}. Open image ${index + 1} of ${gallery.length}`
                  : `Open image ${index + 1} of ${gallery.length}`
              }
              onActivate={() => onOpenImage?.(index)}
            />
          );
        })}
      </div>
    );
  }
  if (gallery.length === 1) {
    const alt = imageAlts?.[0] || "Post attachment";
    return (
      <FeedImage
        src={`${cloudUrl}${gallery[0] as string}`}
        alt={alt}
        interactive={Boolean(onOpenImage)}
        label={imageAlts?.[0] ? `${alt}. Open image` : "Open image"}
        onActivate={() => onOpenImage?.(0)}
      />
    );
  }
  return null;
}

/** Accessible confirmation for destructive post/comment actions. */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      } else if (event.key === "Tab" && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>("button"));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="feed-confirm-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="feed-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="feed-confirm-title">{title}</p>
        <p className="feed-confirm-message">{message}</p>
        <div className="feed-confirm-actions">
          <button ref={cancelRef} type="button" className="feed-confirm-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="feed-confirm-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthorLine({
  author,
  when,
  cloudUrl,
  trailing,
}: {
  author: FeedPost["author"];
  when: string;
  cloudUrl?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="feed-author">
      <Avatar
        emoji={authorEmoji(author)}
        name={authorName(author)}
        url={resolveAvatar(author.avatarUrl, cloudUrl)}
      />
      <div className="feed-author-meta">
        <span className="feed-author-name">
          {authorName(author)}
          {trailing}
        </span>
        <span className="feed-author-sub">
          {author.handle ? `@${author.handle} · ` : ""}
          <time dateTime={when} title={fullDate(when)}>
            {relativeTime(when)}
          </time>
        </span>
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  client,
  cloudUrl,
  viewerId,
  onChange,
  onReply,
  onDelete,
}: {
  comment: FeedComment;
  client: BotifyrClient;
  cloudUrl?: string;
  viewerId?: string;
  onChange?: (next: FeedComment) => void;
  onReply?: () => void;
  onDelete?: (id: string) => void;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const total = Object.values(comment.reactions ?? {}).reduce((sum, count) => sum + count, 0);
  const mine = Boolean(viewerId && comment.author.id === viewerId);

  async function react(reaction: string) {
    if (!onChange) return;
    const next = comment.myReaction === reaction ? null : reaction;
    const reactions = { ...(comment.reactions ?? {}) };
    const prev = comment.myReaction ?? null;
    if (prev) reactions[prev] = Math.max(0, (reactions[prev] ?? 1) - 1);
    if (next) reactions[next] = (reactions[next] ?? 0) + 1;
    onChange({ ...comment, reactions, myReaction: next });
    setPickOpen(false);
    try {
      if (next) await client.reactComment(comment.id, next);
      else await client.unreactComment(comment.id);
    } catch {
      onChange(comment);
    }
  }

  return (
    <div className="feed-comment">
      <Avatar
        emoji={authorEmoji(comment.author)}
        name={authorName(comment.author)}
        url={resolveAvatar(comment.author.avatarUrl, cloudUrl)}
        size={30}
      />
      <div className="feed-comment-main">
        <span className="feed-comment-head">
          {authorName(comment.author)}
          <time
            className="feed-comment-when"
            dateTime={comment.createdAt}
            title={fullDate(comment.createdAt)}
          >
            {relativeTime(comment.createdAt)}
          </time>
        </span>
        <span className="feed-comment-body">
          {renderRichText(comment.body, undefined, `c-${comment.id}`)}
        </span>
        <div className="feed-comment-foot">
          <button
            type="button"
            className="feed-comment-reply-btn"
            onClick={() => setPickOpen((value) => !value)}
            aria-label="React"
          >
            {comment.myReaction ? `${reactionEmoji(comment.myReaction)} ${total}` : "React"}
          </button>
          {onReply && (
            <button type="button" className="feed-comment-reply-btn" onClick={onReply}>
              Reply
            </button>
          )}
          {mine && onDelete && (
            <button type="button" className="feed-comment-reply-btn" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
        {pickOpen && (
          <div className="reaction-picker">
            {REACTIONS.map((reaction) => (
              <button
                key={reaction.key}
                type="button"
                className={`reaction-btn${comment.myReaction === reaction.key ? " active" : ""}`}
                title={reaction.label}
                aria-label={reaction.label}
                onClick={() => void react(reaction.key)}
              >
                {reaction.emoji}
              </button>
            ))}
          </div>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete comment?"
          message="This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete?.(comment.id);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

interface PostCardProps {
  post: FeedPost;
  client: BotifyrClient;
  cloudUrl: string;
  canDelete: boolean;
  viewerId?: string;
  focus?: boolean;
  onChange: (next: FeedPost) => void;
  onDelete: (id: string) => void;
  onBlock: (authorId: string) => void;
  onOpenPage?: (handle: string) => void;
  onRepost: (post: FeedPost) => void;
  onOpenTag?: (tag: string) => void;
  onOpenMention?: (handle: string) => void;
}

function PostCard({
  post,
  client,
  cloudUrl,
  canDelete,
  viewerId,
  focus,
  onChange,
  onDelete,
  onBlock,
  onOpenPage,
  onRepost,
  onOpenTag,
  onOpenMention,
}: PostCardProps) {
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsCursor, setCommentsCursor] = useState<string | null>(null);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<null | "delete" | "block">(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCaption, setShareCaption] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [allCommentsShown, setAllCommentsShown] = useState(false);
  const [highlight, setHighlight] = useState(Boolean(focus));
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(post.body);
  const inFlight = useRef(new Set<string>());
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const reactionCloseTimer = useRef<number | null>(null);
  const likeBtnRef = useRef<HTMLButtonElement>(null);
  const articleRef = useRef<HTMLElement>(null);

  // Permalink focus: when this card is the URL target, scroll to it and flash.
  useEffect(() => {
    if (!focus) return;
    articleRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setHighlight(true);
    const timer = window.setTimeout(() => setHighlight(false), 2500);
    return () => window.clearTimeout(timer);
  }, [focus]);

  /** Run an optimistic action once; roll back + surface failures in the UI. */
  async function guard(key: string, task: () => Promise<void>): Promise<void> {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setFeedback(null);
    try {
      await task();
    } catch {
      setFeedback({ kind: "error", text: "Something went wrong. Please try again." });
    } finally {
      inFlight.current.delete(key);
    }
  }

  const updateComment = (next: FeedComment) =>
    setComments((prev) => (prev ?? []).map((comment) => (comment.id === next.id ? next : comment)));

  async function removeComment(id: string) {
    const before = comments ?? [];
    setComments((prev) => (prev ?? []).filter((comment) => comment.id !== id && comment.parentId !== id));
    onChange({ ...post, comments: Math.max(0, post.comments - 1) });
    try {
      await client.deleteComment(id);
    } catch {
      setComments(before);
      onChange(post);
      setFeedback({ kind: "error", text: "Couldn't delete that comment. Please try again." });
    }
  }

  function react(reaction: string) {
    void guard("react", async () => {
      const next = post.myReaction === reaction ? null : reaction;
      const reactions = { ...(post.reactions ?? {}) };
      const prev = post.myReaction ?? null;
      let likes = post.likes;
      if (prev) {
        reactions[prev] = Math.max(0, (reactions[prev] ?? 1) - 1);
        likes = Math.max(0, likes - 1);
      }
      if (next) {
        reactions[next] = (reactions[next] ?? 0) + 1;
        likes += 1;
      }
      onChange({ ...post, reactions, likes, myReaction: next, likedByMe: next !== null });
      setPickOpen(false);
      try {
        if (next) await client.reactPost(post.id, next);
        else await client.unreactPost(post.id);
      } catch {
        onChange(post);
        setFeedback({ kind: "error", text: "Couldn't update your reaction. Please try again." });
      }
    });
  }

  function submitShare() {
    void guard("share", async () => {
      try {
        const caption = shareCaption.trim();
        const repost = await client.repost(post.id, caption || undefined);
        onRepost(repost);
        onChange({ ...post, shares: post.shares + 1, sharedByMe: true });
        setShareOpen(false);
        setShareCaption("");
      } catch {
        setFeedback({ kind: "error", text: "Couldn't share this post. Please try again." });
      }
    });
  }

  function openPicker() {
    if (reactionCloseTimer.current) {
      window.clearTimeout(reactionCloseTimer.current);
      reactionCloseTimer.current = null;
    }
    setPickOpen(true);
  }

  function schedulePickerClose() {
    if (reactionCloseTimer.current) window.clearTimeout(reactionCloseTimer.current);
    reactionCloseTimer.current = window.setTimeout(() => {
      reactionCloseTimer.current = null;
      setPickOpen(false);
    }, 160);
  }

  function save() {
    void guard("save", async () => {
      const saved = !post.savedByMe;
      onChange({ ...post, savedByMe: saved });
      try {
        await client.savePost(post.id, saved);
      } catch {
        onChange(post);
        setFeedback({ kind: "error", text: "Couldn't update your saved posts. Please try again." });
      }
    });
  }

  async function hide() {
    try {
      await client.hidePost(post.id, true);
      onDelete(post.id);
    } catch {
      setFeedback({ kind: "error", text: "Couldn't hide this post. Please try again." });
    }
  }

  async function snooze() {
    try {
      await client.muteAuthor(post.author.id, 30);
      onBlock(post.author.id);
    } catch {
      setFeedback({ kind: "error", text: "Couldn't snooze this author. Please try again." });
    }
  }

  async function unfollow() {
    try {
      await client.muteAuthor(post.author.id, null);
      onBlock(post.author.id);
    } catch {
      setFeedback({ kind: "error", text: "Couldn't unfollow this author. Please try again." });
    }
  }

  function vote(optionId: string) {
    if (!post.poll) return;
    void guard("vote", async () => {
      try {
        await client.votePoll(post.id, optionId);
        const previous = post.poll?.myVote;
        const options = (post.poll?.options ?? []).map((option) => ({
          ...option,
          votes: option.votes + (option.id === optionId ? 1 : 0) - (option.id === previous ? 1 : 0),
        }));
        const total = options.reduce((sum, option) => sum + option.votes, 0);
        onChange({ ...post, poll: { ...post.poll!, options, total, myVote: optionId } });
      } catch {
        setFeedback({ kind: "error", text: "Couldn't record your vote. Please try again." });
      }
    });
  }

  async function toggleComments() {
    const open = !commentsOpen;
    setCommentsOpen(open);
    if (open && comments === null && !commentsLoading) {
      setCommentsLoading(true);
      try {
        const page = await client.listCommentsPage(post.id, undefined, 20);
        setComments(page.items);
        setCommentsCursor(page.nextCursor);
        setCommentsHasMore(Boolean(page.nextCursor));
      } catch {
        setComments([]);
        setFeedback({ kind: "error", text: "Couldn't load comments. Please try again." });
      } finally {
        setCommentsLoading(false);
      }
    }
  }

  async function loadMoreComments() {
    if (!commentsCursor || commentsLoadingMore) return;
    setCommentsLoadingMore(true);
    try {
      const page = await client.listCommentsPage(post.id, commentsCursor, 20);
      setComments((prev) => [...(prev ?? []), ...page.items]);
      setCommentsCursor(page.nextCursor);
      setCommentsHasMore(Boolean(page.nextCursor));
      setAllCommentsShown(true);
    } catch {
      setFeedback({ kind: "error", text: "Couldn't load more comments. Please try again." });
    } finally {
      setCommentsLoadingMore(false);
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setCommentError(null);
    try {
      const comment = await client.addComment(post.id, body, replyTo ?? undefined);
      setComments((prev) => [...(prev ?? []), comment]);
      onChange({ ...post, comments: post.comments + 1 });
      setAllCommentsShown(true);
      setDraft("");
      setReplyTo(null);
    } catch {
      // Leave the draft so the user can retry.
      setCommentError("Couldn't post your comment. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setConfirm(null);
    try {
      await client.deletePost(post.id);
      onDelete(post.id);
    } catch {
      setFeedback({ kind: "error", text: "Couldn't delete this post. Please try again." });
    }
  }

  async function report() {
    try {
      await client.reportPost(post.id);
      setFeedback({ kind: "info", text: "Thanks — we'll review this post." });
    } catch {
      setFeedback({ kind: "error", text: "Couldn't submit your report. Please try again." });
    }
  }

  async function blockAuthor() {
    setConfirm(null);
    try {
      await client.blockUser(post.author.id);
      onBlock(post.author.id);
    } catch {
      setFeedback({ kind: "error", text: "Couldn't block this author. Please try again." });
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#post=${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setFeedback({ kind: "info", text: "Link copied to clipboard." });
    } catch {
      setFeedback({ kind: "error", text: "Couldn't copy the link." });
    }
  }

  async function saveEdit() {
    const body = editDraft.trim();
    if (!body) return;
    try {
      const updated = await client.editPost(post.id, body);
      onChange(updated);
      setEditing(false);
      setFeedback({ kind: "info", text: "Post updated." });
    } catch {
      setFeedback({ kind: "error", text: "Couldn't save your changes. Please try again." });
    }
  }

  // Dismiss the overflow menu and reaction picker on Escape or an outside click;
  // move focus into the menu and support arrow-key navigation.
  useEffect(() => {
    if (!moreOpen) return;
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreBtnRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        if (items.length === 0) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        items[(current + delta + items.length) % items.length]?.focus();
      }
    }
    function onDown(event: globalThis.MouseEvent) {
      const target = event.target as Node;
      if (!menu?.contains(target) && !moreBtnRef.current?.contains(target)) setMoreOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!pickOpen) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setPickOpen(false);
    }
    function onDown(event: globalThis.MouseEvent) {
      const target = event.target as Node;
      if (!pickerRef.current?.contains(target) && !likeBtnRef.current?.contains(target)) setPickOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [pickOpen]);

  const gallery = post.images && post.images.length > 0 ? post.images : post.imageUrl ? [post.imageUrl] : [];
  const topLevelComments = (comments ?? []).filter((comment) => !comment.parentId);
  const visibleThreads = allCommentsShown ? topLevelComments : topLevelComments.slice(0, 2);
  const mine = Boolean(viewerId && post.author.id === viewerId && !post.pageId);

  return (
    <article
      ref={articleRef}
      className={`feed-post${highlight ? " feed-post-focus" : ""}`}
      data-post-id={post.id}
    >
      <AuthorLine
        author={post.author}
        when={post.createdAt}
        cloudUrl={cloudUrl}
        trailing={post.repostOf ? <span className="feed-repost-label">🔁 Shared a post</span> : undefined}
      />

      {post.audience === "only_me" && <div className="feed-audience-badge">🔒 Only me</div>}
      {post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now() && (
        <div className="feed-audience-badge">🕒 Scheduled</div>
      )}
      {editing ? (
        <div className="feed-post-edit">
          <textarea
            className="feed-post-edit-input"
            value={editDraft}
            onChange={(event) => setEditDraft(event.target.value)}
            aria-label="Edit post"
            rows={3}
            maxLength={4000}
          />
          <div className="feed-post-edit-actions">
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                setEditing(false);
                setEditDraft(post.body);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="feed-post-btn"
              onClick={() => void saveEdit()}
              disabled={!editDraft.trim()}
            >
              Save changes
            </button>
          </div>
        </div>
      ) : (
        post.body && <PostBody text={post.body} onOpenTag={onOpenTag} onOpenMention={onOpenMention} />
      )}

      {post.hashtags && post.hashtags.length > 0 && (
        <div className="feed-tags">
          {post.hashtags.map((tag) => (
            <button key={tag} type="button" className="feed-tag" onClick={() => onOpenTag?.(tag)}>
              #{tag}
            </button>
          ))}
        </div>
      )}

      {post.original ? (
        <div className="feed-repost">
          <AuthorLine author={post.original.author} when={post.original.createdAt} cloudUrl={cloudUrl} />
          {post.original.body && (
            <p className="feed-body">
              {renderRichText(post.original.body, onOpenTag, "orig", onOpenMention)}
            </p>
          )}
          <PostMedia
            images={post.original.images}
            videos={post.original.videos}
            imageUrl={post.original.imageUrl}
            imageAlts={post.original.imageAlts}
            cloudUrl={cloudUrl}
          />
          {post.original.hashtags && post.original.hashtags.length > 0 && (
            <div className="feed-tags">
              {post.original.hashtags.map((tag) => (
                <button key={tag} type="button" className="feed-tag" onClick={() => onOpenTag?.(tag)}>
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <PostMedia
          images={post.images}
          videos={post.videos}
          imageUrl={post.imageUrl}
          imageAlts={post.imageAlts}
          cloudUrl={cloudUrl}
          onOpenImage={(index) => setViewer(index)}
        />
      )}

      {!post.original && !post.videos?.length && gallery.length === 0 && post.mediaId && (
        <div className="feed-image feed-image-placeholder">📷 Image</div>
      )}

      {post.poll && (
        <div className="feed-poll">
          {post.poll.options.map((option) => {
            const pct =
              post.poll && post.poll.total > 0 ? Math.round((option.votes / post.poll.total) * 100) : 0;
            const chosen = post.poll?.myVote === option.id;
            const showPct = Boolean(post.poll?.myVote) || Boolean(post.poll?.closed);
            return (
              <button
                key={option.id}
                type="button"
                className={`feed-poll-option${chosen ? " chosen" : ""}`}
                onClick={() => void vote(option.id)}
                disabled={post.poll?.closed}
              >
                {showPct && <span className="feed-poll-bar" style={{ width: `${pct}%` }} />}
                <span className="feed-poll-label">{option.label}</span>
                {showPct && <span className="feed-poll-pct">{pct}%</span>}
              </button>
            );
          })}
          <div className="feed-poll-total">
            {post.poll.total} vote{post.poll.total === 1 ? "" : "s"}
            {post.poll.closed ? " · closed" : ""}
          </div>
        </div>
      )}

      <div className="feed-stats">
        {post.likes > 0 && (
          <button
            type="button"
            className="feed-reaction-summary"
            title={reactionBreakdown(post.reactions)}
            aria-label={`${post.likes} reaction${post.likes === 1 ? "" : "s"}: ${reactionBreakdown(post.reactions).replace(/\n/g, ", ")}`}
            onClick={() => setPickOpen((value) => !value)}
            aria-expanded={pickOpen}
          >
            {Object.entries(post.reactions ?? {})
              .filter(([, count]) => count > 0)
              .slice(0, 3)
              .map(([key]) => reactionEmoji(key))
              .join(" ")}{" "}
            {post.likes}
          </button>
        )}
        <span className="feed-stats-spacer" />
        {post.comments > 0 && (
          <button type="button" className="feed-stats-btn" onClick={() => void toggleComments()}>
            {post.comments} comment{post.comments === 1 ? "" : "s"}
          </button>
        )}
        {post.shares > 0 && (
          <span>
            {post.shares} share{post.shares === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {pickOpen && (
        <div
          className="reaction-picker"
          ref={pickerRef}
          onMouseEnter={openPicker}
          onMouseLeave={schedulePickerClose}
        >
          {REACTIONS.map((reaction) => (
            <button
              key={reaction.key}
              type="button"
              className={`reaction-btn${post.myReaction === reaction.key ? " active" : ""}`}
              title={reaction.label}
              aria-label={reaction.label}
              onClick={() => void react(reaction.key)}
            >
              {reaction.emoji}
            </button>
          ))}
        </div>
      )}
      <div className="feed-actions">
        <button
          ref={likeBtnRef}
          type="button"
          className={`feed-action${post.myReaction ? " active" : ""}`}
          onClick={() => setPickOpen(true)}
          onMouseEnter={openPicker}
          onMouseLeave={schedulePickerClose}
          aria-pressed={post.myReaction !== null}
          aria-expanded={pickOpen}
        >
          {post.myReaction ? (
            <span className="feed-action-emoji">{reactionEmoji(post.myReaction)}</span>
          ) : (
            <HeartIcon size={17} />
          )}
          {post.myReaction
            ? (REACTIONS.find((entry) => entry.key === post.myReaction)?.label ?? "Like")
            : "Like"}
        </button>
        <button
          type="button"
          className="feed-action"
          onClick={() => void toggleComments()}
          aria-expanded={commentsOpen}
        >
          <MessageIcon size={17} /> Comment
        </button>
        <button
          type="button"
          className="feed-action"
          onClick={() => setShareOpen(true)}
          aria-pressed={post.sharedByMe}
        >
          <ForwardIcon size={17} /> Share
        </button>
        <button
          type="button"
          className={`feed-action${post.savedByMe ? " active" : ""}`}
          onClick={() => void save()}
          aria-pressed={post.savedByMe}
        >
          Save
        </button>
        <button
          ref={moreBtnRef}
          type="button"
          className={`feed-action feed-action-more${moreOpen ? " active" : ""}`}
          onClick={() => setMoreOpen((value) => !value)}
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
        >
          <MoreIcon size={18} />
        </button>
      </div>

      {moreOpen && (
        <div className="feed-menu" role="menu" ref={menuRef}>
          {post.author.page && post.author.handle && onOpenPage && (
            <button
              type="button"
              role="menuitem"
              className="feed-menu-item"
              onClick={() => {
                setMoreOpen(false);
                onOpenPage(post.author.handle as string);
              }}
            >
              View page
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="feed-menu-item"
            onClick={() => {
              setMoreOpen(false);
              void copyLink();
            }}
          >
            Copy link
          </button>
          {!canDelete && (
            <>
              <button
                type="button"
                role="menuitem"
                className="feed-menu-item"
                onClick={() => {
                  setMoreOpen(false);
                  void hide();
                }}
              >
                Hide this post
              </button>
              <button
                type="button"
                role="menuitem"
                className="feed-menu-item"
                onClick={() => {
                  setMoreOpen(false);
                  void snooze();
                }}
              >
                Snooze {authorName(post.author)} for 30 days
              </button>
              <button
                type="button"
                role="menuitem"
                className="feed-menu-item"
                onClick={() => {
                  setMoreOpen(false);
                  void unfollow();
                }}
              >
                Unfollow {authorName(post.author)}
              </button>
              <div className="feed-menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="feed-menu-item"
                onClick={() => {
                  setMoreOpen(false);
                  void report();
                }}
              >
                Report post
              </button>
              <button
                type="button"
                role="menuitem"
                className="feed-menu-item feed-menu-danger"
                onClick={() => {
                  setMoreOpen(false);
                  setConfirm("block");
                }}
              >
                Block {authorName(post.author)}
              </button>
            </>
          )}
          {canDelete && (
            <>
              <div className="feed-menu-sep" />
              {mine && (
                <button
                  type="button"
                  role="menuitem"
                  className="feed-menu-item"
                  onClick={() => {
                    setMoreOpen(false);
                    setEditDraft(post.body);
                    setEditing(true);
                  }}
                >
                  Edit post
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="feed-menu-item feed-menu-danger"
                onClick={() => {
                  setMoreOpen(false);
                  setConfirm("delete");
                }}
              >
                Delete post
              </button>
            </>
          )}
        </div>
      )}

      {commentsOpen && (
        <div className="feed-comments">
          {commentsLoading && <div className="feed-state">Loading comments…</div>}
          {visibleThreads.map((comment) => (
            <div key={comment.id} className="feed-comment-thread">
              <CommentRow
                comment={comment}
                client={client}
                cloudUrl={cloudUrl}
                viewerId={viewerId}
                onChange={updateComment}
                onReply={() => setReplyTo(comment.id)}
                onDelete={removeComment}
              />
              {(comments ?? [])
                .filter((reply) => reply.parentId === comment.id)
                .map((reply) => (
                  <div key={reply.id} className="feed-comment-reply">
                    <CommentRow
                      comment={reply}
                      client={client}
                      cloudUrl={cloudUrl}
                      viewerId={viewerId}
                      onChange={updateComment}
                      onDelete={removeComment}
                    />
                  </div>
                ))}
            </div>
          ))}
          {topLevelComments.length > 2 && !allCommentsShown && (
            <button type="button" className="feed-comments-more" onClick={() => setAllCommentsShown(true)}>
              View all {topLevelComments.length} comments
            </button>
          )}
          {commentsHasMore && (
            <button
              type="button"
              className="feed-comments-more"
              onClick={() => void loadMoreComments()}
              disabled={commentsLoadingMore}
            >
              {commentsLoadingMore ? "Loading…" : "Load more comments"}
            </button>
          )}
          {replyTo && (
            <div className="feed-comment-replying">
              <span>Replying to a comment</span>
              <button type="button" className="ghost small" onClick={() => setReplyTo(null)}>
                Cancel
              </button>
            </div>
          )}
          {commentError && (
            <div className="feed-comment-error" role="alert">
              {commentError}
            </div>
          )}
          <form className="feed-comment-form" onSubmit={addComment}>
            <input
              className="feed-comment-input"
              placeholder={replyTo ? "Write a reply…" : "Write a comment…"}
              aria-label={replyTo ? "Write a reply" : "Write a comment"}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              className="feed-comment-send"
              type="submit"
              disabled={!draft.trim() || busy}
              aria-busy={busy}
              aria-label="Send comment"
            >
              <SendIcon size={15} />
            </button>
          </form>
        </div>
      )}
      {feedback && (
        <div
          className={`feed-post-feedback${feedback.kind === "error" ? " error" : ""}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </div>
      )}
      {gallery.length > 0 && viewer !== null && (
        <MediaLightbox
          images={gallery}
          index={viewer}
          cloudUrl={cloudUrl}
          onClose={() => setViewer(null)}
          onNavigate={setViewer}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          title="Delete post?"
          message="This can't be undone. The post and its comments will be removed."
          confirmLabel="Delete"
          onConfirm={() => void remove()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "block" && (
        <ConfirmDialog
          title={`Block ${authorName(post.author)}?`}
          message="They won't be able to see or interact with your posts, and you won't see theirs."
          confirmLabel="Block"
          onConfirm={() => void blockAuthor()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {shareOpen && (
        <div className="feed-confirm-backdrop" onClick={() => setShareOpen(false)}>
          <div
            className="feed-share-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Share post"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="feed-confirm-title">Share this post</p>
            <textarea
              className="feed-share-input"
              placeholder="Say something about this…"
              rows={3}
              maxLength={4000}
              value={shareCaption}
              onChange={(event) => setShareCaption(event.target.value)}
              aria-label="Share caption"
            />
            <p className="feed-share-note">Shared to your friends. Per-share privacy isn’t available yet.</p>
            <div className="feed-confirm-actions">
              <button type="button" className="feed-confirm-cancel" onClick={() => setShareOpen(false)}>
                Cancel
              </button>
              <button type="button" className="feed-post-btn" onClick={() => void submitShare()}>
                Share now
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

/** Mention routing: a person's mini-profile resolved from an `@handle`. */
function MentionProfile({
  client,
  cloudUrl,
  viewerId,
  handle,
  onClose,
}: {
  client: BotifyrClient;
  cloudUrl: string;
  viewerId?: string;
  handle: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ person: Person; posts: FeedPost[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);
    client
      .getPersonByHandle(handle)
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [client, handle]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="feed-profile-backdrop" onClick={onClose}>
      <div
        className="feed-profile"
        role="dialog"
        aria-modal="true"
        aria-label={`Profile for ${handle}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="feed-profile-close" aria-label="Close profile" onClick={onClose}>
          ✕
        </button>
        {failed ? (
          <div className="feed-state" role="alert">
            Couldn't load this profile.
          </div>
        ) : !data ? (
          <div className="feed-state">Loading profile…</div>
        ) : (
          <>
            <div className="feed-profile-head">
              <Avatar
                emoji={authorEmoji(data.person)}
                name={authorName(data.person)}
                url={resolveAvatar(data.person.avatarUrl, cloudUrl)}
              />
              <div className="feed-author-meta">
                <span className="feed-author-name">{authorName(data.person)}</span>
                <span className="feed-author-sub">{data.person.handle ? `@${data.person.handle}` : ""}</span>
              </div>
            </div>
            <div className="feed-profile-posts">
              {data.posts.length === 0 ? (
                <div className="feed-state">No posts yet.</div>
              ) : (
                data.posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    client={client}
                    cloudUrl={cloudUrl}
                    canDelete={false}
                    viewerId={viewerId}
                    onChange={() => {}}
                    onDelete={() => {}}
                    onBlock={() => {}}
                    onRepost={() => {}}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PageView({
  client,
  cloudUrl,
  viewerId,
  handle,
  onBack,
  onOpenPage,
}: {
  client: BotifyrClient;
  cloudUrl: string;
  viewerId?: string;
  handle: string;
  onBack: () => void;
  onOpenPage?: (handle: string) => void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    handle: "",
    category: "",
    about: "",
    cta: "",
    ctaUrl: "",
    avatarEmoji: "",
  });
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<Array<{ userId: string; role: string; person: Person | null }>>([]);
  const [roleQuery, setRoleQuery] = useState("");
  const [roleResults, setRoleResults] = useState<Person[]>([]);
  const [insights, setInsights] = useState<Awaited<ReturnType<BotifyrClient["pageInsights"]>> | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [inbox, setInbox] = useState<Awaited<ReturnType<BotifyrClient["pageInbox"]>> | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [section, setSection] = useState<"posts" | "about" | "photos" | "videos">("posts");
  const [error, setError] = useState<string | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [media, setMedia] = useState<Array<{ id: string; url: string }>>([]);
  const [mediaCursor, setMediaCursor] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaLoadingMore, setMediaLoadingMore] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [videos, setVideos] = useState<Array<{ id: string; url: string }>>([]);
  const [videosCursor, setVideosCursor] = useState<string | null>(null);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosLoadingMore, setVideosLoadingMore] = useState(false);
  const [videosLoaded, setVideosLoaded] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([client.getPage(handle), client.listPagePosts(handle)])
      .then(([record, feed]) => {
        if (!active) return;
        setPage(record);
        setPosts(feed.items);
        setCursor(feed.nextCursor);
      })
      .catch(() => {
        if (active)
          setError("We couldn't load this Page. It may have been removed, or the connection dropped.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, handle, nonce]);

  // The Photos section loads lazily, only when first opened.
  useEffect(() => {
    if (section !== "photos" || mediaLoaded || !page) return;
    let active = true;
    setMediaLoading(true);
    client
      .listPageMedia(page.handle)
      .then((feed) => {
        if (!active) return;
        setMedia(feed.items);
        setMediaCursor(feed.nextCursor);
        setMediaLoaded(true);
      })
      .catch(() => {
        if (active) setMediaLoaded(true);
      })
      .finally(() => {
        if (active) setMediaLoading(false);
      });
    return () => {
      active = false;
    };
  }, [section, mediaLoaded, page, client]);

  // The Videos section loads lazily, only when first opened.
  useEffect(() => {
    if (section !== "videos" || videosLoaded || !page) return;
    let active = true;
    setVideosLoading(true);
    client
      .listPageMedia(page.handle, undefined, 30, "video")
      .then((feed) => {
        if (!active) return;
        setVideos(feed.items);
        setVideosCursor(feed.nextCursor);
        setVideosLoaded(true);
      })
      .catch(() => {
        if (active) setVideosLoaded(true);
      })
      .finally(() => {
        if (active) setVideosLoading(false);
      });
    return () => {
      active = false;
    };
  }, [section, videosLoaded, page, client]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const feed = await client.listPagePosts(handle, cursor);
      setPosts((prev) => {
        const seen = new Set(prev.map((post) => post.id));
        return [...prev, ...feed.items.filter((post) => !seen.has(post.id))];
      });
      setCursor(feed.nextCursor);
    } catch {
      // Keep the cursor so the reader can retry.
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadMoreMedia() {
    if (!mediaCursor || mediaLoadingMore) return;
    setMediaLoadingMore(true);
    try {
      const feed = await client.listPageMedia(handle, mediaCursor);
      setMedia((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...feed.items.filter((item) => !seen.has(item.id))];
      });
      setMediaCursor(feed.nextCursor);
    } catch {
      // Keep the cursor so the reader can retry.
    } finally {
      setMediaLoadingMore(false);
    }
  }

  async function loadMoreVideos() {
    if (!videosCursor || videosLoadingMore) return;
    setVideosLoadingMore(true);
    try {
      const feed = await client.listPageMedia(handle, videosCursor, 30, "video");
      setVideos((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...feed.items.filter((item) => !seen.has(item.id))];
      });
      setVideosCursor(feed.nextCursor);
    } catch {
      // Keep the cursor so the reader can retry.
    } finally {
      setVideosLoadingMore(false);
    }
  }

  const isAdmin = page?.role === "admin";

  useEffect(() => {
    if (!page || !isAdmin) return;
    let active = true;
    client
      .listPageRoles(page.id)
      .then((list) => {
        if (active) setRoles(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client, page, isAdmin]);

  function openSettings() {
    if (!page) return;
    setForm({
      name: page.name,
      handle: page.handle,
      category: page.category ?? "",
      about: page.about ?? "",
      cta: page.cta ?? "",
      ctaUrl: page.ctaUrl ?? "",
      avatarEmoji: page.avatarEmoji ?? "",
    });
    setEditing(true);
  }

  async function pinPost(postId: string | null) {
    if (!page) return;
    try {
      await client.pinPagePost(page.id, postId);
      setPage({ ...page, pinnedPostId: postId ?? undefined });
      const feed = await client.listPagePosts(handle);
      setPosts(feed.items);
      setCursor(feed.nextCursor);
    } catch {
      // Leave the pin unchanged on failure.
    }
  }

  async function openInbox() {
    if (!page) return;
    setInboxOpen(true);
    try {
      setInbox(await client.pageInbox(page.id));
    } catch {
      setInbox([]);
    }
  }

  async function toggleHideComment(id: string, hidden: boolean) {
    try {
      if (hidden) await client.hideComment(id);
      else await client.unhideComment(id);
      setInbox((prev) => (prev ?? []).map((entry) => (entry.id === id ? { ...entry, hidden } : entry)));
    } catch {
      // Ignore a failed moderation action.
    }
  }

  function exportInsights() {
    if (!insights) return;
    const rows: string[][] = [
      ["Metric", "Value"],
      ["Followers", String(insights.followers)],
      ["Posts", String(insights.posts)],
      ["Reactions", String(insights.reactions)],
      ["Comments", String(insights.comments)],
      ["Shares", String(insights.shares)],
      [],
      ["Top post", "Engagement"],
      ...insights.topPosts.map((post) => [
        (post.body || "(photo)").replace(/\s+/g, " ").slice(0, 80),
        String(post.engagement),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `page-${page?.handle ?? "insights"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function openInsights() {
    if (!page) return;
    setInsightsOpen(true);
    if (!insights) {
      try {
        setInsights(await client.pageInsights(page.id));
      } catch {
        // Leave the panel empty on failure.
      }
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!page) return;
    setSaving(true);
    try {
      setPage(
        await client.updatePage(page.id, {
          name: form.name,
          handle: form.handle,
          category: form.category,
          about: form.about,
          cta: form.cta,
          ctaUrl: form.ctaUrl,
          avatarEmoji: form.avatarEmoji,
        }),
      );
      setEditing(false);
    } catch {
      // Keep the form open so the user can fix it.
    } finally {
      setSaving(false);
    }
  }

  async function searchForRole() {
    const query = roleQuery.trim();
    if (!query) {
      setRoleResults([]);
      return;
    }
    try {
      setRoleResults(await client.searchPeople(query));
    } catch {
      setRoleResults([]);
    }
  }

  async function addRole(person: Person, role: string) {
    if (!page) return;
    try {
      await client.setPageRole(page.id, person.id, role);
      setRoles((prev) => [
        ...prev.filter((entry) => entry.userId !== person.id),
        { userId: person.id, role, person },
      ]);
      setRoleQuery("");
      setRoleResults([]);
    } catch {
      // ignore
    }
  }

  async function removeRole(userId: string) {
    if (!page) return;
    try {
      await client.setPageRole(page.id, userId);
      setRoles((prev) => prev.filter((entry) => entry.userId !== userId));
    } catch {
      // ignore
    }
  }

  async function toggleFollow() {
    if (!page || busy) return;
    const wasFollowing = page.following;
    setBusy(true);
    setFollowError(null);
    try {
      if (wasFollowing) await client.unfollowPage(page.id);
      else await client.followPage(page.id);
      setPage((prev) =>
        prev
          ? {
              ...prev,
              following: !wasFollowing,
              followers: Math.max(0, prev.followers + (wasFollowing ? -1 : 1)),
            }
          : prev,
      );
    } catch {
      setFollowError(
        wasFollowing ? "Couldn't unfollow. Please try again." : "Couldn't follow. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const canManage = page?.role === "admin" || page?.role === "editor";
  /** Backend gates: pin/settings = admin|editor; community = +moderator; insights = +analyst. */
  const canModerate = canManage || page?.role === "moderator";
  const canViewInsights = canManage || page?.role === "analyst";
  const isStaff = canManage || canModerate || canViewInsights;
  const cta = page?.cta?.trim() ?? "";
  const ctaUrl = page?.ctaUrl?.trim() ?? "";
  // A dedicated CTA destination wins; fall back to a `cta` that is itself a URL.
  const ctaHref = /^(https?:|mailto:|tel:)/i.test(ctaUrl)
    ? ctaUrl
    : /^(https?:|mailto:|tel:)/i.test(cta)
      ? cta
      : "";
  const createdLabel = page ? new Date(page.createdAt).toLocaleDateString() : "";
  const updatePost = (next: FeedPost) => setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));

  return (
    <div className="feed">
      <div className="feed-topbar">
        <button type="button" className="ghost small" onClick={onBack}>
          ← Back
        </button>
        <span className="feed-topbar-title">{page?.name ?? "Page"}</span>
      </div>

      <div className="feed-scroll">
        {loading && !page ? (
          <div className="page-head" aria-hidden="true">
            <div className="page-cover page-skel" />
            <div className="page-head-body">
              <span className="feed-avatar page-skel" style={{ width: 64, height: 64 }} />
              <div className="page-head-meta">
                <div className="page-skel page-skel-line" style={{ width: "38%" }} />
                <div className="page-skel page-skel-line" style={{ width: "62%" }} />
              </div>
            </div>
          </div>
        ) : error && !page ? (
          <div className="page-error" role="alert">
            <p>{error}</p>
            <button type="button" className="feed-more" onClick={() => setNonce((n) => n + 1)}>
              Retry
            </button>
          </div>
        ) : page ? (
          <>
            <div className="page-head">
              {page.coverUrl ? (
                <img className="page-cover" src={page.coverUrl} alt="" decoding="async" />
              ) : (
                <div className="page-cover" />
              )}
              <div className="page-head-body">
                <Avatar
                  emoji={page.avatarEmoji}
                  name={page.name}
                  url={resolveAvatar(page.avatarUrl, cloudUrl)}
                  size={64}
                />
                <div className="page-head-meta">
                  <h1 className="page-name">
                    {page.name}
                    {page.verified ? " ✓" : ""}
                  </h1>
                  <div className="page-sub">
                    @{page.handle}
                    {page.category ? ` · ${page.category}` : ""} · {page.followers} follower
                    {page.followers === 1 ? "" : "s"}
                  </div>
                  {page.about && <p className="page-about">{page.about}</p>}
                </div>
                {isStaff ? (
                  <div className="page-head-actions">
                    <span className="feed-bot-badge">{page.role}</span>
                    {canManage && (
                      <select
                        className="page-pin-select"
                        aria-label="Pin a post to the top"
                        value={page.pinnedPostId ?? ""}
                        onChange={(event) => void pinPost(event.target.value || null)}
                        title="Pin a post to the top"
                      >
                        <option value="">📌 Pin…</option>
                        {posts.map((post) => (
                          <option key={post.id} value={post.id}>
                            {(post.body || "(photo)").slice(0, 40)}
                          </option>
                        ))}
                      </select>
                    )}
                    {canModerate && (
                      <button type="button" className="feed-follow-btn" onClick={() => void openInbox()}>
                        Community
                      </button>
                    )}
                    {canViewInsights && (
                      <button type="button" className="feed-follow-btn" onClick={() => void openInsights()}>
                        Insights
                      </button>
                    )}
                    {canManage && (
                      <button type="button" className="feed-follow-btn" onClick={openSettings}>
                        Settings
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="page-head-actions">
                    {ctaHref ? (
                      <a className="feed-follow-btn" href={ctaHref} target="_blank" rel="noreferrer">
                        {cta || ctaHref}
                      </a>
                    ) : cta ? (
                      <span className="page-cta-badge" title="This Page's call to action">
                        {cta}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={`feed-follow-btn${page.following ? " following" : ""}`}
                      disabled={busy}
                      aria-busy={busy}
                      onClick={() => void toggleFollow()}
                    >
                      {busy
                        ? page.following
                          ? "Unfollowing…"
                          : "Following…"
                        : page.following
                          ? "Following"
                          : "Follow"}
                    </button>
                  </div>
                )}
              </div>
              {followError && (
                <p className="page-follow-error" role="alert">
                  {followError}
                </p>
              )}
            </div>
            <div className="page-tabs" role="tablist" aria-label="Page sections">
              <button
                type="button"
                role="tab"
                aria-selected={section === "posts"}
                className={`page-tab${section === "posts" ? " active" : ""}`}
                onClick={() => setSection("posts")}
              >
                Posts
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "about"}
                className={`page-tab${section === "about" ? " active" : ""}`}
                onClick={() => setSection("about")}
              >
                About
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "photos"}
                className={`page-tab${section === "photos" ? " active" : ""}`}
                onClick={() => setSection("photos")}
              >
                Photos
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "videos"}
                className={`page-tab${section === "videos" ? " active" : ""}`}
                onClick={() => setSection("videos")}
              >
                Videos
              </button>
            </div>
          </>
        ) : null}

        {editing && page && (
          <form className="page-settings" onSubmit={saveSettings}>
            <div className="feed-rail-head">Page settings</div>
            <label>
              Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              Handle
              <input
                value={form.handle}
                onChange={(event) => setForm({ ...form, handle: event.target.value })}
              />
            </label>
            <label>
              Category
              <input
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              />
            </label>
            <label>
              Avatar emoji
              <input
                value={form.avatarEmoji}
                onChange={(event) => setForm({ ...form, avatarEmoji: event.target.value })}
              />
            </label>
            <label>
              Call to action
              <input value={form.cta} onChange={(event) => setForm({ ...form, cta: event.target.value })} />
            </label>
            <label>
              Call to action link
              <input
                type="url"
                placeholder="https://…"
                value={form.ctaUrl}
                onChange={(event) => setForm({ ...form, ctaUrl: event.target.value })}
              />
            </label>
            <label>
              About
              <textarea
                rows={3}
                value={form.about}
                onChange={(event) => setForm({ ...form, about: event.target.value })}
              />
            </label>
            <div className="page-settings-actions">
              <button type="button" className="ghost small" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="feed-post-btn" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>

            {isAdmin && (
              <div className="page-roles">
                <div className="feed-rail-head">Roles</div>
                {roles.map((entry) => (
                  <div key={entry.userId} className="page-role-row">
                    <span>
                      {entry.person?.displayName ||
                        (entry.person?.handle ? `@${entry.person.handle}` : entry.userId)}
                    </span>
                    <span className="feed-bot-badge">{entry.role}</span>
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => void removeRole(entry.userId)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="page-role-add">
                  <input
                    placeholder="Add by @handle"
                    aria-label="Search people to add a role"
                    value={roleQuery}
                    onChange={(event) => setRoleQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void searchForRole();
                      }
                    }}
                  />
                  <button type="button" className="ghost small" onClick={() => void searchForRole()}>
                    Search
                  </button>
                </div>
                {roleResults.map((person) => (
                  <div key={person.id} className="page-role-row">
                    <span>{person.displayName || (person.handle ? `@${person.handle}` : person.id)}</span>
                    <select
                      aria-label="Assign role"
                      defaultValue=""
                      onChange={(event) => {
                        if (event.target.value) void addRole(person, event.target.value);
                      }}
                    >
                      <option value="">Add as…</option>
                      <option value="editor">Editor</option>
                      <option value="moderator">Moderator</option>
                      <option value="analyst">Analyst</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
          </form>
        )}

        {insightsOpen && insights && (
          <div className="page-settings">
            <div className="feed-rail-head">Page insights · last 30 days</div>
            <div className="page-insights-grid">
              <div className="page-insight">
                <span className="page-insight-num">{insights.followers}</span>
                <span className="page-insight-label">Followers</span>
              </div>
              <div className="page-insight">
                <span className="page-insight-num">{insights.posts}</span>
                <span className="page-insight-label">Posts</span>
              </div>
              <div className="page-insight">
                <span className="page-insight-num">{insights.reactions}</span>
                <span className="page-insight-label">Reactions</span>
              </div>
              <div className="page-insight">
                <span className="page-insight-num">{insights.comments}</span>
                <span className="page-insight-label">Comments</span>
              </div>
              <div className="page-insight">
                <span className="page-insight-num">{insights.shares}</span>
                <span className="page-insight-label">Shares</span>
              </div>
            </div>
            {insights.topPosts.length > 0 && (
              <>
                <div className="feed-rail-head">Top posts</div>
                <ul className="feed-rail-trending">
                  {insights.topPosts.map((post) => (
                    <li key={post.id} className="feed-rail-trend">
                      <span className="feed-rail-trend-tag">{post.engagement} engagement</span>
                      <span className="feed-rail-trend-meta">{(post.body || "(photo)").slice(0, 80)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="page-settings-actions">
              <button type="button" className="ghost small" onClick={exportInsights}>
                Export CSV
              </button>
              <button type="button" className="ghost small" onClick={() => setInsightsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        )}

        {inboxOpen && (
          <div className="page-settings">
            <div className="feed-rail-head">Community inbox</div>
            {inbox === null ? (
              <div className="feed-state">Loading…</div>
            ) : inbox.length === 0 ? (
              <div className="feed-state">No comments yet.</div>
            ) : (
              inbox.map((entry) => (
                <div key={entry.id} className="page-role-row">
                  <span>
                    {entry.author.displayName ||
                      (entry.author.handle ? `@${entry.author.handle}` : "Someone")}
                    : {entry.body}
                  </span>
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => void toggleHideComment(entry.id, !entry.hidden)}
                  >
                    {entry.hidden ? "Unhide" : "Hide"}
                  </button>
                </div>
              ))
            )}
            <div className="page-settings-actions">
              <button type="button" className="ghost small" onClick={() => setInboxOpen(false)}>
                Close
              </button>
            </div>
          </div>
        )}

        {page &&
          (section === "about" ? (
            <div className="page-about-panel">
              <div className="feed-rail-head">About</div>
              {page.about ? (
                <p className="page-about-text">{page.about}</p>
              ) : (
                <p className="feed-state">This Page hasn't added a description yet.</p>
              )}
              <dl className="page-fact-list">
                <div className="page-fact">
                  <dt>Handle</dt>
                  <dd>@{page.handle}</dd>
                </div>
                {page.category && (
                  <div className="page-fact">
                    <dt>Category</dt>
                    <dd>{page.category}</dd>
                  </div>
                )}
                <div className="page-fact">
                  <dt>Followers</dt>
                  <dd>{page.followers}</dd>
                </div>
                <div className="page-fact">
                  <dt>Created</dt>
                  <dd>{createdLabel}</dd>
                </div>
                {ctaHref && (
                  <div className="page-fact">
                    <dt>Link</dt>
                    <dd>
                      <a href={ctaHref} target="_blank" rel="noreferrer">
                        {cta || ctaHref}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          ) : section === "photos" ? (
            <div className="page-photos">
              {mediaLoading ? (
                <div className="feed-state">Loading…</div>
              ) : media.length === 0 ? (
                <div className="feed-state">No photos yet.</div>
              ) : (
                <>
                  <div className="page-photo-grid">
                    {media.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        className="page-photo"
                        onClick={() => setLightbox(index)}
                        aria-label={`Open photo ${index + 1}`}
                      >
                        <img src={`${cloudUrl}${item.url}`} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                  {mediaCursor ? (
                    <button
                      type="button"
                      className="feed-more"
                      onClick={() => void loadMoreMedia()}
                      disabled={mediaLoadingMore}
                    >
                      {mediaLoadingMore ? "Loading…" : "Load more photos"}
                    </button>
                  ) : (
                    <div className="feed-end">You're all caught up</div>
                  )}
                </>
              )}
            </div>
          ) : section === "videos" ? (
            <div className="page-videos">
              {videosLoading ? (
                <div className="feed-state">Loading…</div>
              ) : videos.length === 0 ? (
                <div className="feed-state">No videos yet.</div>
              ) : (
                <>
                  <div className="page-video-grid">
                    {videos.map((item) => (
                      <video
                        key={item.id}
                        className="page-video"
                        src={`${cloudUrl}${item.url}`}
                        controls
                        preload="metadata"
                      />
                    ))}
                  </div>
                  {videosCursor ? (
                    <button
                      type="button"
                      className="feed-more"
                      onClick={() => void loadMoreVideos()}
                      disabled={videosLoadingMore}
                    >
                      {videosLoadingMore ? "Loading…" : "Load more videos"}
                    </button>
                  ) : (
                    <div className="feed-end">You're all caught up</div>
                  )}
                </>
              )}
            </div>
          ) : loading ? (
            <div className="feed-state">Loading…</div>
          ) : posts.length === 0 ? (
            <div className="feed-state">
              {canManage
                ? "You haven't posted yet — use the composer to publish as this Page."
                : "This Page hasn't posted yet."}
            </div>
          ) : (
            <>
              {posts.map((post) => (
                <div key={post.id} className="feed-post-wrap">
                  {page.pinnedPostId === post.id && <div className="feed-repost-label">📌 Pinned</div>}
                  <PostCard
                    post={post}
                    client={client}
                    cloudUrl={cloudUrl}
                    canDelete={canManage === true || (!post.pageId && post.author.id === viewerId)}
                    viewerId={viewerId}
                    onChange={updatePost}
                    onDelete={removePost}
                    onBlock={(authorId) => setPosts((prev) => prev.filter((p) => p.author.id !== authorId))}
                    onOpenPage={onOpenPage}
                    onRepost={(next) => setPosts((prev) => prependUnique(prev, next))}
                  />
                </div>
              ))}
              {cursor ? (
                <button
                  type="button"
                  className="feed-more"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : (
                <div className="feed-end">You're all caught up</div>
              )}
            </>
          ))}

        {lightbox !== null && (
          <MediaLightbox
            images={media.map((item) => item.url)}
            index={lightbox}
            cloudUrl={cloudUrl}
            onClose={() => setLightbox(null)}
            onNavigate={setLightbox}
          />
        )}
      </div>
    </div>
  );
}

function TagView({
  client,
  cloudUrl,
  viewerId,
  tag,
  onBack,
  onOpenTag,
}: {
  client: BotifyrClient;
  cloudUrl: string;
  viewerId?: string;
  tag: string;
  onBack: () => void;
  onOpenTag?: (tag: string) => void;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    client
      .listTagPosts(tag)
      .then((list) => {
        if (active) setPosts(list);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, tag]);

  const updatePost = (next: FeedPost) => setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));

  return (
    <div className="feed">
      <div className="feed-topbar">
        <button type="button" className="ghost small" onClick={onBack}>
          ← Back
        </button>
        <span className="feed-topbar-title">#{tag}</span>
      </div>
      <div className="feed-scroll">
        {loading ? (
          <div className="feed-state">Loading…</div>
        ) : posts.length === 0 ? (
          <div className="feed-state">No posts with #{tag}.</div>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              client={client}
              cloudUrl={cloudUrl}
              canDelete={!post.pageId && post.author.id === viewerId}
              viewerId={viewerId}
              onChange={updatePost}
              onDelete={removePost}
              onBlock={(authorId) => setPosts((prev) => prev.filter((p) => p.author.id !== authorId))}
              onRepost={(next) => setPosts((prev) => prependUnique(prev, next))}
              onOpenTag={onOpenTag}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** "m:ss" for the reel transport bar. */
function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Play, but never throw: autoplay can be blocked and jsdom has no video engine. */
function safePlay(element: HTMLVideoElement | null | undefined): void {
  if (!element) return;
  try {
    const attempt = element.play();
    if (attempt && typeof attempt.catch === "function") attempt.catch(() => {});
  } catch {
    // Autoplay blocked or unimplemented — the UI then shows a manual play button.
  }
}

/** Pause, tolerating environments (jsdom) where media methods are unimplemented. */
function safePause(element: HTMLVideoElement | null | undefined): void {
  if (!element) return;
  try {
    element.pause();
  } catch {
    // Unimplemented media element in tests.
  }
}

/**
 * One reel: the video, its overlay (creator, caption, action rail) and a compact
 * custom transport. Playback state comes from media events, so controls never
 * claim the video is playing when it is not.
 */
function ReelCard({
  post,
  index,
  total,
  active,
  preload,
  muted,
  cloudUrl,
  client,
  reducedMotion,
  onEngageChange,
  onOpenComments,
  onOpenPage,
  onHide,
  onBlock,
  onToast,
  onToggleMute,
}: {
  post: FeedPost;
  index: number;
  total: number;
  active: boolean;
  preload: "auto" | "metadata" | "none";
  muted: boolean;
  cloudUrl: string;
  client: BotifyrClient;
  reducedMotion: boolean;
  onEngageChange: (next: FeedPost) => void;
  onOpenComments: (post: FeedPost) => void;
  onOpenPage?: (handle: string) => void;
  onHide: (id: string) => void;
  onBlock: (authorId: string) => void;
  onToast: (message: string) => void;
  onToggleMute: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pageFollow, setPageFollow] = useState<{
    id: string;
    following: boolean;
    followers: number;
  } | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  const src = post.videos?.[0];
  const hasVideo = Boolean(src);
  const name = authorName(post.author);
  const pageHandle = post.pageId && post.author.handle ? post.author.handle : null;

  // Follow state isn't on the reel payload; fetch it for Page-authored reels
  // once they become active (and never invent it if the lookup fails).
  useEffect(() => {
    if (!pageHandle || pageFollow || !active) return;
    let alive = true;
    client
      .getPage(pageHandle)
      .then((page) => {
        if (alive) setPageFollow({ id: page.id, following: page.following, followers: page.followers });
      })
      .catch(() => {
        // No follow control if we can't read the real state.
      });
    return () => {
      alive = false;
    };
  }, [active, pageHandle, pageFollow, client]);

  // Only the active reel plays, and never automatically under reduced motion.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (active && !reducedMotion) safePlay(element);
    else safePause(element);
  }, [active, reducedMotion, reloadKey]);

  useEffect(() => {
    const element = videoRef.current;
    if (element) element.muted = muted;
  }, [muted, reloadKey]);

  // Release playback when this reel leaves the tree.
  useEffect(() => {
    const element = videoRef.current;
    return () => safePause(element);
  }, [reloadKey]);

  function togglePlay() {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused || element.ended) safePlay(element);
    else safePause(element);
  }

  function retry() {
    setFailed(false);
    setWaiting(true);
    setProgress(0);
    setReloadKey((value) => value + 1);
  }

  async function toggleLike() {
    const liked = !post.likedByMe;
    const snapshot = post;
    onEngageChange({ ...post, likedByMe: liked, likes: Math.max(0, post.likes + (liked ? 1 : -1)) });
    try {
      await client.likePost(post.id, liked);
    } catch {
      onEngageChange(snapshot);
      onToast("Couldn't update your like");
    }
  }

  async function toggleSave() {
    const saved = !post.savedByMe;
    const snapshot = post;
    onEngageChange({ ...post, savedByMe: saved });
    try {
      await client.savePost(post.id, saved);
    } catch {
      onEngageChange(snapshot);
      onToast(saved ? "Couldn't save this reel" : "Couldn't remove from saved");
    }
  }

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      await client.repost(post.id);
      onEngageChange({ ...post, shares: post.shares + 1, sharedByMe: true });
      onToast("Shared to your feed");
    } catch {
      onToast("Couldn't share this reel");
    } finally {
      setBusy(false);
    }
  }

  async function hide() {
    setMoreOpen(false);
    try {
      await client.hidePost(post.id, true);
      onHide(post.id);
    } catch {
      onToast("Couldn't hide this reel");
    }
  }

  async function report() {
    setMoreOpen(false);
    try {
      await client.reportPost(post.id);
      onToast("Report submitted");
    } catch {
      onToast("Couldn't submit the report");
    }
  }

  async function blockAuthor() {
    setMoreOpen(false);
    try {
      await client.blockUser(post.author.id);
      onBlock(post.author.id);
    } catch {
      onToast("Couldn't block this creator");
    }
  }

  async function fullscreen() {
    const element = videoRef.current?.closest(".reel-stage") as HTMLElement | null;
    if (!element || typeof element.requestFullscreen !== "function") return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      // Fullscreen can be denied; the rest of the player still works.
    }
  }

  async function toggleFollow() {
    if (!pageFollow || followBusy) return;
    const wasFollowing = pageFollow.following;
    const snapshot = pageFollow;
    setPageFollow({
      ...pageFollow,
      following: !wasFollowing,
      followers: Math.max(0, pageFollow.followers + (wasFollowing ? -1 : 1)),
    });
    setFollowBusy(true);
    try {
      if (wasFollowing) await client.unfollowPage(pageFollow.id);
      else await client.followPage(pageFollow.id);
    } catch {
      setPageFollow(snapshot);
      onToast(wasFollowing ? "Couldn't unfollow" : "Couldn't follow");
    } finally {
      setFollowBusy(false);
    }
  }

  const canOpenPage = Boolean(post.pageId && post.author.handle && onOpenPage);

  return (
    <div
      className={`reel${active ? " reel--active" : ""}`}
      data-reel-index={index}
      onClick={togglePlay}
      role="group"
      aria-label={`Reel ${index + 1} of ${total} by ${name}`}
    >
      <div className="reel-stage">
        {hasVideo ? (
          <video
            key={reloadKey}
            ref={videoRef}
            className="reel-video"
            src={`${cloudUrl}${src}`}
            poster={post.imageUrl ? `${cloudUrl}${post.imageUrl}` : undefined}
            muted={muted}
            loop
            playsInline
            preload={preload}
            aria-label={`${name}'s reel video`}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onPlaying={() => {
              setPlaying(true);
              setWaiting(false);
              setFailed(false);
            }}
            onLoadStart={() => setWaiting(true)}
            onWaiting={() => setWaiting(true)}
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration || 0);
              setWaiting(false);
            }}
            onCanPlay={() => setWaiting(false)}
            onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setWaiting(false);
              setFailed(true);
            }}
          />
        ) : (
          <div className="reel-missing">Video unavailable</div>
        )}

        {hasVideo && (
          <>
            <div className="reel-scrim" aria-hidden="true" />

            {waiting && !failed && (
              <div className="reel-spinner" role="status" aria-live="polite">
                <span className="reel-spinner-ring" />
                <span className="visually-hidden">Loading video</span>
              </div>
            )}

            {failed && (
              <div className="reel-error" role="alert">
                <span>Couldn&apos;t play this reel.</span>
                <button
                  type="button"
                  className="reel-retry"
                  onClick={(event) => {
                    event.stopPropagation();
                    retry();
                  }}
                >
                  Retry
                </button>
              </div>
            )}

            {!playing && !failed && (
              <button
                type="button"
                className="reel-play"
                aria-label="Play video"
                onClick={(event) => {
                  event.stopPropagation();
                  togglePlay();
                }}
              >
                <PlayIcon size={40} />
              </button>
            )}

            <div className="reel-actions" onClick={(event) => event.stopPropagation()}>
              <div className="reel-action">
                <button
                  type="button"
                  className={`reel-action-btn${post.likedByMe ? " active" : ""}`}
                  aria-label={post.likedByMe ? "Unlike" : "Like"}
                  aria-pressed={post.likedByMe}
                  onClick={() => void toggleLike()}
                >
                  <HeartIcon filled={post.likedByMe} size={26} />
                </button>
                <span className="reel-action-count">{post.likes}</span>
              </div>

              <div className="reel-action">
                <button
                  type="button"
                  className="reel-action-btn"
                  aria-label="Comments"
                  onClick={() => onOpenComments(post)}
                >
                  <MessageIcon size={25} />
                </button>
                <span className="reel-action-count">{post.comments}</span>
              </div>

              <div className="reel-action">
                <button
                  type="button"
                  className="reel-action-btn"
                  aria-label="Share"
                  aria-busy={busy}
                  disabled={busy}
                  onClick={() => void share()}
                >
                  <ForwardIcon size={25} />
                </button>
                <span className="reel-action-count">{post.shares}</span>
              </div>

              <div className="reel-action">
                <button
                  type="button"
                  className={`reel-action-btn${post.savedByMe ? " active" : ""}`}
                  aria-label={post.savedByMe ? "Unsave" : "Save"}
                  aria-pressed={post.savedByMe}
                  onClick={() => void toggleSave()}
                >
                  <BookmarkIcon filled={post.savedByMe} size={24} />
                </button>
                <span className="reel-action-count">{post.savedByMe ? "Saved" : "Save"}</span>
              </div>

              <div className="reel-action reel-action-more">
                <button
                  type="button"
                  className="reel-action-btn"
                  aria-label="More options"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((value) => !value)}
                >
                  <MoreIcon size={22} />
                </button>
              </div>
            </div>

            {moreOpen && (
              <div className="reel-menu" onClick={(event) => event.stopPropagation()}>
                <button type="button" className="reel-menu-item" onClick={() => void hide()}>
                  Hide this reel
                </button>
                <button type="button" className="reel-menu-item" onClick={() => void report()}>
                  Report
                </button>
                <button type="button" className="reel-menu-item danger" onClick={() => void blockAuthor()}>
                  Block {name}
                </button>
              </div>
            )}

            <div className="reel-info" onClick={(event) => event.stopPropagation()}>
              <div className="reel-creator-row">
                {canOpenPage ? (
                  <button
                    type="button"
                    className="reel-creator"
                    onClick={() => onOpenPage?.(post.author.handle as string)}
                  >
                    <Avatar
                      emoji={authorEmoji(post.author)}
                      name={name}
                      url={resolveAvatar(post.author.avatarUrl, cloudUrl)}
                      size={34}
                    />
                    <span className="reel-creator-name">{name}</span>
                  </button>
                ) : (
                  <span className="reel-creator">
                    <Avatar
                      emoji={authorEmoji(post.author)}
                      name={name}
                      url={resolveAvatar(post.author.avatarUrl, cloudUrl)}
                      size={34}
                    />
                    <span className="reel-creator-name">{name}</span>
                  </span>
                )}
                {pageFollow && (
                  <button
                    type="button"
                    className={`reel-follow${pageFollow.following ? " following" : ""}`}
                    aria-pressed={pageFollow.following}
                    disabled={followBusy}
                    onClick={() => void toggleFollow()}
                  >
                    {pageFollow.following ? "Following" : "Follow"}
                  </button>
                )}
              </div>
              {post.body && <p className="reel-caption">{post.body}</p>}
              {post.hashtags && post.hashtags.length > 0 && (
                <div className="reel-tags">
                  {post.hashtags.map((tag) => (
                    <span key={tag} className="reel-tag">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              <span className="reel-audio">Original audio · {name}</span>
            </div>
          </>
        )}
      </div>

      {hasVideo && (
        <div className="reel-transport" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="reel-transport-btn"
            aria-label={playing ? "Pause" : "Play"}
            aria-pressed={playing}
            onClick={togglePlay}
          >
            {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>
          <span className="reel-transport-time">{formatClock(progress)}</span>
          <input
            type="range"
            className="reel-seek"
            min={0}
            max={duration > 0 ? duration : 0}
            step="any"
            value={duration > 0 ? Math.min(progress, duration) : 0}
            disabled={duration <= 0 || failed}
            aria-label="Seek"
            aria-valuetext={`${formatClock(progress)} of ${formatClock(duration)}`}
            onChange={(event) => {
              const next = Number(event.target.value);
              setProgress(next);
              const element = videoRef.current;
              try {
                if (element) element.currentTime = next;
              } catch {
                // Seeking can throw before metadata loads; state still updates.
              }
            }}
          />
          <span className="reel-transport-time">{formatClock(duration)}</span>
          <button
            type="button"
            className="reel-transport-btn"
            aria-label={muted ? "Unmute video" : "Mute video"}
            aria-pressed={muted}
            onClick={onToggleMute}
          >
            <VolumeIcon size={17} muted={muted} />
          </button>
          <button
            type="button"
            className="reel-transport-btn"
            aria-label="Full screen"
            onClick={() => void fullscreen()}
          >
            <FullscreenIcon size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Comments for one reel, as a bottom sheet over the still-mounted video. */
function ReelComments({
  post,
  client,
  cloudUrl,
  onClose,
}: {
  post: FeedPost;
  client: BotifyrClient;
  cloudUrl: string;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    client
      .listComments(post.id)
      .then((list) => {
        if (alive) setComments(list);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Couldn't load comments");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [client, post.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function updateComment(next: FeedComment) {
    setComments((prev) => (prev ?? []).map((comment) => (comment.id === next.id ? next : comment)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const created = await client.addComment(post.id, body);
      setComments((prev) => [...(prev ?? []), created]);
      setDraft("");
      setError(null);
    } catch {
      setError("Couldn't post your comment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="reel-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={`Comments on ${authorName(post.author)}'s reel`}
    >
      <button type="button" className="reel-sheet-backdrop" aria-label="Close comments" onClick={onClose} />
      <div className="reel-sheet-panel">
        <div className="reel-sheet-head">
          <span>
            {post.comments} comment{post.comments === 1 ? "" : "s"}
          </span>
          <button type="button" className="reel-sheet-close" onClick={onClose} aria-label="Close comments">
            ✕
          </button>
        </div>
        <div className="reel-sheet-body">
          {loading ? (
            <div className="reel-sheet-note">Loading comments…</div>
          ) : (comments ?? []).length === 0 && !error ? (
            <div className="reel-sheet-note">No comments yet. Be the first.</div>
          ) : (
            (comments ?? []).map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                client={client}
                cloudUrl={cloudUrl}
                onChange={updateComment}
              />
            ))
          )}
          {error && (
            <div className="reel-sheet-note" role="alert">
              {error}
            </div>
          )}
        </div>
        <form className="reel-sheet-form" onSubmit={submit}>
          <input
            className="reel-sheet-input"
            placeholder="Add a comment…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Add a comment"
          />
          <button
            type="submit"
            className="reel-sheet-send"
            disabled={!draft.trim() || busy}
            aria-label="Post comment"
          >
            <SendIcon size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}

function ReelsView({
  client,
  cloudUrl,
  onOpenPage,
  onBack,
}: {
  client: BotifyrClient;
  cloudUrl: string;
  onOpenPage?: (handle: string) => void;
  onBack: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [reels, setReels] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [muted, setMuted] = useState(() => {
    try {
      return window.localStorage.getItem("botifyr.reels.muted") !== "false";
    } catch {
      return true;
    }
  });
  const [reducedMotion, setReducedMotion] = useState(false);
  const [commentsFor, setCommentsFor] = useState<FeedPost | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await client.listReels();
      setReels(page.items);
      setNextCursor(page.nextCursor ?? null);
      setActive(0);
      setMoreError(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load reels");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // Persist the viewer's audio choice across reels and sessions.
  useEffect(() => {
    try {
      window.localStorage.setItem("botifyr.reels.muted", String(muted));
    } catch {
      // Storage can be unavailable; the in-memory preference still applies.
    }
  }, [muted]);

  // Respect prefers-reduced-motion: no autoplay, the user presses play.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await client.listReels(nextCursor);
      setReels((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor ?? null);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [client, nextCursor, loadingMore]);

  // Fetch the next page as the last loaded reel comes into reach.
  useEffect(() => {
    if (reels.length > 0 && nextCursor && active >= reels.length - 1) void loadMore();
  }, [active, reels.length, nextCursor, loadMore]);

  const computeActive = useCallback(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const nodes = element.querySelectorAll<HTMLElement>(".reel");
    if (nodes.length === 0) return;
    const center = element.scrollTop + element.clientHeight / 2;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    nodes.forEach((node, i) => {
      const middle = node.offsetTop + node.offsetHeight / 2;
      const distance = Math.abs(middle - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    setActive((prev) => (prev === best ? prev : best));
  }, []);

  const onScroll = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      computeActive();
    });
  }, [computeActive]);

  useEffect(
    () => () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const goTo = useCallback(
    (target: number) => {
      if (reels.length === 0) return;
      const clamped = Math.max(0, Math.min(reels.length - 1, target));
      setActive(clamped);
      const node = scrollerRef.current?.querySelectorAll<HTMLElement>(".reel")[clamped];
      try {
        node?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        // jsdom does not implement scrollIntoView.
      }
    },
    [reels.length],
  );

  const toggleActiveVideo = useCallback(() => {
    const element = scrollerRef.current?.querySelector<HTMLVideoElement>(".reel--active video");
    if (!element) return;
    if (element.paused || element.ended) safePlay(element);
    else safePause(element);
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    // Let Space/Enter activate a focused control instead of toggling playback.
    if (target?.closest("button, a, input, textarea, select")) {
      if (event.key === " " || event.key === "Enter") return;
    }
    switch (event.key) {
      case "ArrowDown":
      case "j":
      case "PageDown":
        event.preventDefault();
        goTo(active + 1);
        break;
      case "ArrowUp":
      case "k":
      case "PageUp":
        event.preventDefault();
        goTo(active - 1);
        break;
      case " ":
        event.preventDefault();
        toggleActiveVideo();
        break;
      case "m":
      case "M":
        setMuted((value) => !value);
        break;
      case "Escape":
        onBack();
        break;
      default:
        break;
    }
  }

  const updateReel = useCallback((next: FeedPost) => {
    setReels((prev) => prev.map((post) => (post.id === next.id ? next : post)));
  }, []);

  const removeReel = useCallback((id: string) => {
    setReels((prev) => prev.filter((post) => post.id !== id));
  }, []);

  const removeAuthor = useCallback((authorId: string) => {
    setReels((prev) => prev.filter((post) => post.author.id !== authorId));
  }, []);

  return (
    <div className="feed">
      <div className="feed-topbar">
        <button type="button" className="ghost small" onClick={onBack}>
          ← Back
        </button>
        <span className="feed-topbar-title">Reels</span>
        <span className="feed-stats-spacer" />
        <button
          type="button"
          className="feed-composer-tool"
          onClick={() => void load()}
          aria-label="Refresh reels"
        >
          <RefreshIcon size={15} />
        </button>
        <button
          type="button"
          className="feed-composer-tool"
          onClick={() => setMuted((value) => !value)}
          aria-pressed={muted}
          aria-label={muted ? "Unmute reels" : "Mute reels"}
        >
          <VolumeIcon size={15} muted={muted} /> {muted ? "Muted" : "Sound"}
        </button>
      </div>

      <div
        className="reels-scroll"
        ref={scrollerRef}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="region"
        aria-label="Reels"
      >
        {loading ? (
          <div className="reels-loading" aria-hidden="true">
            {[0, 1].map((key) => (
              <div key={key} className="reel-skeleton">
                <div className="reel-skeleton-stage" />
                <div className="reel-skeleton-line" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="reels-state">
            <div className="feed-error" role="alert">
              <span>{error}</span>
              <button type="button" className="feed-error-retry" onClick={() => void load()}>
                Retry
              </button>
            </div>
          </div>
        ) : reels.length === 0 ? (
          <div className="reels-state">
            <div className="feed-empty">
              <div className="feed-empty-emoji">🎬</div>
              <div className="feed-empty-title">No reels yet</div>
              <div className="feed-empty-sub">
                Reels are short videos shared to the Feed. Post one to see it here.
              </div>
            </div>
          </div>
        ) : (
          <>
            {reels.map((post, index) => (
              <ReelCard
                key={post.id}
                post={post}
                index={index}
                total={reels.length}
                active={index === active}
                preload={index === active ? "auto" : Math.abs(index - active) === 1 ? "metadata" : "none"}
                muted={muted}
                cloudUrl={cloudUrl}
                client={client}
                reducedMotion={reducedMotion}
                onEngageChange={updateReel}
                onOpenComments={setCommentsFor}
                onOpenPage={onOpenPage}
                onHide={removeReel}
                onBlock={removeAuthor}
                onToast={setToast}
                onToggleMute={() => setMuted((value) => !value)}
              />
            ))}
            {loadingMore && (
              <div className="reels-more">
                <span className="reel-spinner-ring" />
                <span>Loading more reels…</span>
              </div>
            )}
            {moreError && (
              <div className="reels-more">
                <span>Couldn&apos;t load more.</span>
                <button type="button" className="feed-error-retry" onClick={() => void loadMore()}>
                  Retry
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {toast && (
        <div className="reel-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {commentsFor && (
        <ReelComments
          post={commentsFor}
          client={client}
          cloudUrl={cloudUrl}
          onClose={() => setCommentsFor(null)}
        />
      )}
    </div>
  );
}

function AlbumView({
  client,
  cloudUrl,
  viewerId,
  name,
  onBack,
}: {
  client: BotifyrClient;
  cloudUrl: string;
  viewerId?: string;
  name: string;
  onBack: () => void;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    client
      .listAlbumPosts(name)
      .then((list) => {
        if (active) setPosts(list);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, name]);

  const updatePost = (next: FeedPost) => setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));

  return (
    <div className="feed">
      <div className="feed-topbar">
        <button type="button" className="ghost small" onClick={onBack}>
          ← Back
        </button>
        <span className="feed-topbar-title">📷 {name}</span>
      </div>
      <div className="feed-scroll">
        {loading ? (
          <div className="feed-state">Loading…</div>
        ) : posts.length === 0 ? (
          <div className="feed-state">No photos in this album.</div>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              client={client}
              cloudUrl={cloudUrl}
              canDelete={!post.pageId && post.author.id === viewerId}
              viewerId={viewerId}
              onChange={updatePost}
              onDelete={removePost}
              onBlock={(authorId) => setPosts((prev) => prev.filter((p) => p.author.id !== authorId))}
              onRepost={(next) => setPosts((prev) => prependUnique(prev, next))}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Read a picked image as a data URL, or reject when it is larger than `maxBytes`. */
function readImageDataUrl(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error("That image is too large — pick one under 3 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.readAsDataURL(file);
  });
}

/** One group card in discovery / your-groups lists. */
function GroupCard({
  group,
  cloudUrl,
  busy,
  onOpen,
  onAction,
}: {
  group: Group;
  cloudUrl: string;
  busy: boolean;
  onOpen: () => void;
  onAction: () => void;
}) {
  const actionLabel = group.joined
    ? "View group"
    : group.requestPending
      ? "Request pending"
      : group.privacy === "private"
        ? "Request to join"
        : "Join";
  return (
    <div className="group-card">
      <button type="button" className="group-card-cover" onClick={onOpen} aria-label={`Open ${group.name}`}>
        {group.coverUrl ? (
          <img src={resolveAvatar(group.coverUrl, cloudUrl)} alt="" loading="lazy" />
        ) : (
          <span className="group-card-cover-fallback" aria-hidden="true">
            <span className="group-card-cover-emoji">
              {group.avatarEmoji?.trim() || group.name.charAt(0).toUpperCase()}
            </span>
          </span>
        )}
      </button>
      <div className="group-card-body">
        <button type="button" className="group-card-title" onClick={onOpen}>
          <Avatar
            emoji={group.avatarEmoji}
            name={group.name}
            url={resolveAvatar(group.avatarUrl, cloudUrl)}
            size={44}
          />
          <span className="group-card-meta">
            <span className="group-card-name">{group.name}</span>
            <span className="feed-list-sub">
              {group.members} member{group.members === 1 ? "" : "s"}
              {group.category ? ` · ${group.category}` : ""}
            </span>
          </span>
        </button>
        <div className="group-card-chips">
          <span className={`group-chip${group.privacy === "private" ? " private" : ""}`}>
            {group.privacy === "private" ? <LockIcon size={11} /> : <UsersIcon size={11} />}
            {group.privacy === "private" ? "Private" : "Public"}
          </span>
          {group.joined && group.role && <span className="group-chip role">{group.role}</span>}
          {group.requestPending && <span className="group-chip pending">Requested</span>}
        </div>
        {group.about && <p className="group-card-about">{group.about}</p>}
        <div className="group-card-actions">
          <button
            type="button"
            className={`feed-follow-btn${group.joined ? " following" : ""}`}
            disabled={busy || group.requestPending}
            aria-busy={busy}
            onClick={group.joined ? onOpen : onAction}
          >
            {busy ? "Working…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupView({
  client,
  cloudUrl,
  viewerId,
  handle,
  onBack,
  onChanged,
}: {
  client: BotifyrClient;
  cloudUrl: string;
  viewerId?: string;
  handle: string;
  onBack: () => void;
  /** Called after a mutation so the host can refresh discovery/rails. */
  onChanged?: () => void;
}) {
  const [group, setGroup] = useState<Group | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [section, setSection] = useState<"discussion" | "members" | "about" | "media">("discussion");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [requests, setRequests] = useState<GroupJoinRequest[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    handle: "",
    about: "",
    category: "",
    avatarEmoji: "",
    privacy: "public" as "public" | "private",
  });
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();
  const [coverUrl, setCoverUrl] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    client
      .getGroup(handle)
      .then((record) => {
        if (active) setGroup(record);
      })
      .catch(() => {
        if (active)
          setLoadError("We couldn't load this group. It may have been removed, or it's private.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // The stream can fail independently (a private group the viewer can't read
    // yet), so fetch it separately and keep the group header visible.
    client
      .groupPosts(handle)
      .then((list) => {
        if (active) setPosts(list);
      })
      .catch(() => {
        if (active) setPosts([]);
      });
    return () => {
      active = false;
    };
  }, [client, handle, nonce]);

  const isAdmin = group?.role === "admin";
  const canModerate = isAdmin || group?.role === "moderator";
  const isMember = Boolean(group?.joined);

  useEffect(() => {
    if (!group || section !== "members") return;
    let active = true;
    client
      .groupMembers(group.id)
      .then((list) => {
        if (active) setMembers(list);
      })
      .catch(() => {
        if (active) setMembers([]);
      });
    if (isAdmin) {
      client
        .groupRequests(group.id)
        .then((list) => {
          if (active) setRequests(list);
        })
        .catch(() => {
          if (active) setRequests([]);
        });
    }
    return () => {
      active = false;
    };
  }, [client, group, section, isAdmin, nonce]);

  async function toggleJoin() {
    if (!group || joinBusy) return;
    setJoinBusy(true);
    setJoinError(null);
    setNotice(null);
    try {
      if (group.joined) {
        await client.leaveGroup(group.id);
        setGroup({ ...group, joined: false, role: null, members: Math.max(0, group.members - 1) });
        setNotice("You left the group.");
      } else {
        const result = await client.joinGroup(group.id);
        if (result.status === "pending") {
          setGroup({ ...group, requestPending: true });
          setNotice("Request sent — a group admin will review it.");
        } else {
          setGroup({
            ...group,
            joined: true,
            role: "member",
            requestPending: false,
            members: group.members + 1,
          });
          setNotice("Welcome to the group!");
        }
      }
      onChanged?.();
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setJoinBusy(false);
    }
  }

  async function post(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !group || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      const created = await client.createPost({ body, groupId: group.id });
      setPosts((prev) => prependUnique(prev, created));
      setDraft("");
    } catch (err) {
      // Keep the text so a failed group post can be retried.
      setPostError(err instanceof Error ? err.message : "Couldn't post to this group");
    } finally {
      setPosting(false);
    }
  }

  function openSettings() {
    if (!group) return;
    setForm({
      name: group.name,
      handle: group.handle,
      about: group.about ?? "",
      category: group.category ?? "",
      avatarEmoji: group.avatarEmoji ?? "",
      privacy: group.privacy,
    });
    setAvatarUrl(group.avatarUrl);
    setCoverUrl(group.coverUrl);
    setFormError(null);
    setEditing(true);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!group) return;
    setSaving(true);
    setFormError(null);
    try {
      const updated = await client.updateGroup(group.id, {
        name: form.name,
        handle: form.handle,
        about: form.about,
        category: form.category,
        avatarEmoji: form.avatarEmoji,
        privacy: form.privacy,
        avatarUrl: avatarUrl ?? "",
        coverUrl: coverUrl ?? "",
      });
      setGroup(updated);
      setEditing(false);
      setNotice("Group updated.");
      onChanged?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't save the changes.");
    } finally {
      setSaving(false);
    }
  }

  async function resolveRequest(userId: string, action: "approve" | "reject") {
    if (!group) return;
    setBusyMemberId(userId);
    try {
      await client.resolveGroupRequest(group.id, userId, action);
      setRequests((prev) => (prev ?? []).filter((entry) => entry.userId !== userId));
      if (action === "approve") {
        setGroup({ ...group, members: group.members + 1 });
        setMembers(await client.groupMembers(group.id));
      }
      onChanged?.();
    } catch {
      setNotice("Couldn't process that request.");
    } finally {
      setBusyMemberId(null);
    }
  }

  async function setRole(userId: string, role: "admin" | "moderator" | "member") {
    if (!group) return;
    setBusyMemberId(userId);
    try {
      await client.setGroupMemberRole(group.id, userId, role);
      setMembers((prev) => (prev ?? []).map((entry) => (entry.userId === userId ? { ...entry, role } : entry)));
    } catch {
      setNotice("Couldn't update that role.");
    } finally {
      setBusyMemberId(null);
    }
  }

  async function removeMember(userId: string) {
    if (!group) return;
    setBusyMemberId(userId);
    try {
      await client.removeGroupMember(group.id, userId);
      setMembers((prev) => (prev ?? []).filter((entry) => entry.userId !== userId));
      setGroup({ ...group, members: Math.max(0, group.members - 1) });
    } catch {
      setNotice("Couldn't remove that member.");
    } finally {
      setBusyMemberId(null);
    }
  }

  async function deleteGroup() {
    if (!group) return;
    try {
      await client.deleteGroup(group.id);
      onChanged?.();
      onBack();
    } catch {
      setNotice("Couldn't delete the group.");
    } finally {
      setConfirmDelete(false);
    }
  }

  const updatePost = (next: FeedPost) => setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));
  const mediaPosts = posts.filter(
    (post) => (post.images?.length ?? 0) > 0 || (post.videos?.length ?? 0) > 0,
  );
  const joinLabel = group?.owner
    ? "Owner"
    : group?.joined
      ? "Leave"
      : group?.requestPending
        ? "Request pending"
        : group?.privacy === "private"
          ? "Request to join"
          : "Join";

  return (
    <div className="feed">
      <div className="feed-topbar">
        <button type="button" className="ghost small" onClick={onBack}>
          ← Back
        </button>
        <span className="feed-topbar-title">{group?.name ?? "Group"}</span>
      </div>
      <div className="feed-scroll">
        {loading && !group ? (
          <div className="feed-state">Loading…</div>
        ) : loadError && !group ? (
          <div className="page-error" role="alert">
            <p>{loadError}</p>
            <button type="button" className="feed-more" onClick={() => setNonce((n) => n + 1)}>
              Retry
            </button>
          </div>
        ) : group ? (
          <>
            <div className="page-head">
              {group.coverUrl ? (
                <img
                  className="page-cover group-cover"
                  src={resolveAvatar(group.coverUrl, cloudUrl)}
                  alt=""
                  decoding="async"
                />
              ) : (
                <div className="page-cover group-cover" />
              )}
              <div className="page-head-body">
                <Avatar
                  emoji={group.avatarEmoji}
                  name={group.name}
                  url={resolveAvatar(group.avatarUrl, cloudUrl)}
                  size={64}
                />
                <div className="page-head-meta">
                  <h1 className="page-name">
                    {group.name}
                    {group.privacy === "private" && (
                      <span className="group-privacy-badge" title="Private group">
                        <LockIcon size={13} /> Private
                      </span>
                    )}
                  </h1>
                  <div className="page-sub">
                    @{group.handle}
                    {group.category ? ` · ${group.category}` : ""} · {group.members} member
                    {group.members === 1 ? "" : "s"}
                  </div>
                  {group.about && <p className="page-about">{group.about}</p>}
                </div>
                <div className="page-head-actions">
                  {isAdmin && (
                    <button type="button" className="ghost small" onClick={openSettings}>
                      <GearIcon size={15} /> Settings
                    </button>
                  )}
                  {group.owner ? (
                    <>
                      <span className="feed-bot-badge">Owner</span>
                      <button
                        type="button"
                        className="ghost small danger"
                        onClick={() => setConfirmDelete(true)}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={`feed-follow-btn${group.joined ? " following" : ""}`}
                      disabled={joinBusy || group.requestPending}
                      aria-busy={joinBusy}
                      onClick={() => (group.joined ? setConfirmLeave(true) : void toggleJoin())}
                    >
                      {joinBusy ? "Working…" : joinLabel}
                    </button>
                  )}
                </div>
              </div>
              {joinError && (
                <p className="page-follow-error" role="alert">
                  {joinError}
                </p>
              )}
              {notice && (
                <p className="group-notice" role="status">
                  {notice}
                </p>
              )}
            </div>

            <div className="page-tabs" role="tablist" aria-label="Group sections">
              {(["discussion", "members", "about", "media"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={section === key}
                  className={`page-tab${section === key ? " active" : ""}`}
                  onClick={() => setSection(key)}
                >
                  {key === "discussion"
                    ? "Discussion"
                    : key === "members"
                      ? "Members"
                      : key === "about"
                        ? "About"
                        : "Photos"}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {editing && group && (
          <form className="page-settings group-settings" onSubmit={saveSettings}>
            <div className="feed-rail-head">Group settings</div>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Handle
              <input value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />
            </label>
            <label>
              Category
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </label>
            <label>
              Privacy
              <select
                value={form.privacy}
                onChange={(e) => setForm({ ...form, privacy: e.target.value as "public" | "private" })}
              >
                <option value="public">Public — anyone can join</option>
                <option value="private">Private — approval required</option>
              </select>
            </label>
            <label>
              Avatar emoji
              <input value={form.avatarEmoji} onChange={(e) => setForm({ ...form, avatarEmoji: e.target.value })} />
            </label>
            <div className="group-image-row">
              <div className="group-image-field">
                <span>Profile image</span>
                {avatarUrl ? <img className="group-image-preview round" src={avatarUrl} alt="" /> : null}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="group-image-input"
                  aria-label="Choose a profile image"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setAvatarUrl(await readImageDataUrl(file, 3 * 1024 * 1024));
                      setFormError(null);
                    } catch (err) {
                      setFormError(err instanceof Error ? err.message : "Couldn't read that image.");
                    }
                  }}
                />
                <button type="button" className="ghost small" onClick={() => avatarInputRef.current?.click()}>
                  <CameraIcon size={15} /> Choose
                </button>
              </div>
              <div className="group-image-field">
                <span>Cover image</span>
                {coverUrl ? <img className="group-image-preview" src={coverUrl} alt="" /> : null}
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="group-image-input"
                  aria-label="Choose a cover image"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setCoverUrl(await readImageDataUrl(file, 4 * 1024 * 1024));
                      setFormError(null);
                    } catch (err) {
                      setFormError(err instanceof Error ? err.message : "Couldn't read that image.");
                    }
                  }}
                />
                <button type="button" className="ghost small" onClick={() => coverInputRef.current?.click()}>
                  <CameraIcon size={15} /> Choose
                </button>
              </div>
            </div>
            <label>
              About
              <textarea
                rows={3}
                value={form.about}
                onChange={(e) => setForm({ ...form, about: e.target.value })}
              />
            </label>
            {formError && (
              <p className="feed-composer-error" role="alert">
                {formError}
              </p>
            )}
            <div className="page-settings-actions">
              <button type="button" className="ghost small" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="feed-post-btn" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}

        {section === "about" && group && (
          <div className="page-about-panel">
            <div className="feed-rail-head">About</div>
            <p className="page-about-text">{group.about || "This group hasn't added a description yet."}</p>
            <dl className="page-fact-list">
              <div className="page-fact">
                <dt>Handle</dt>
                <dd>@{group.handle}</dd>
              </div>
              {group.category && (
                <div className="page-fact">
                  <dt>Category</dt>
                  <dd>{group.category}</dd>
                </div>
              )}
              <div className="page-fact">
                <dt>Privacy</dt>
                <dd>{group.privacy === "private" ? "Private" : "Public"}</dd>
              </div>
              <div className="page-fact">
                <dt>Members</dt>
                <dd>{group.members}</dd>
              </div>
              <div className="page-fact">
                <dt>Created</dt>
                <dd>{new Date(group.createdAt).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>
        )}

        {section === "members" && group && (
          <div className="group-members">
            {isAdmin && requests && requests.length > 0 && (
              <div className="group-admin-block">
                <div className="feed-rail-head">Join requests ({requests.length})</div>
                {requests.map((request) => (
                  <div key={request.userId} className="group-row">
                    <span className="group-row-name">
                      {request.person?.displayName ||
                        (request.person?.handle ? `@${request.person.handle}` : request.userId)}
                    </span>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={busyMemberId === request.userId}
                      onClick={() => void resolveRequest(request.userId, "approve")}
                    >
                      <CheckIcon size={14} /> Approve
                    </button>
                    <button
                      type="button"
                      className="ghost small danger"
                      disabled={busyMemberId === request.userId}
                      onClick={() => void resolveRequest(request.userId, "reject")}
                    >
                      <CloseIcon size={14} /> Reject
                    </button>
                  </div>
                ))}
              </div>
            )}
            {members === null ? (
              <div className="feed-state">Loading…</div>
            ) : members.length === 0 ? (
              <div className="feed-state">No members yet.</div>
            ) : (
              members.map((member) => (
                <div key={member.userId} className="group-row">
                  <Avatar
                    emoji={member.person?.avatarEmoji}
                    name={member.person?.displayName ?? member.person?.handle ?? "Member"}
                    url={resolveAvatar(member.person?.avatarUrl, cloudUrl)}
                    size={36}
                  />
                  <span className="group-row-name">
                    {member.person?.displayName ||
                      (member.person?.handle ? `@${member.person.handle}` : member.userId)}
                    <span className="feed-bot-badge">{member.owner ? "Owner" : member.role}</span>
                  </span>
                  {isAdmin && !member.owner && (
                    <>
                      <select
                        className="page-pin-select"
                        aria-label={`Role for ${member.userId}`}
                        value={member.role}
                        disabled={busyMemberId === member.userId}
                        onChange={(e) =>
                          void setRole(member.userId, e.target.value as "admin" | "moderator" | "member")
                        }
                      >
                        <option value="member">Member</option>
                        <option value="moderator">Moderator</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button
                        type="button"
                        className="ghost small danger"
                        disabled={busyMemberId === member.userId}
                        onClick={() => void removeMember(member.userId)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {section === "media" && group && (
          mediaPosts.length === 0 ? (
            <div className="feed-state">No photos or videos yet.</div>
          ) : (
            <div className="group-media-grid">
              {mediaPosts.map((post) => {
                const src = [...(post.images ?? []), ...(post.videos ?? [])][0];
                return src ? (
                  <img
                    key={post.id}
                    className="group-media-item"
                    src={resolveAvatar(src, cloudUrl)}
                    alt=""
                    loading="lazy"
                  />
                ) : null;
              })}
            </div>
          )
        )}

        {section === "discussion" && (
          <>
            {isMember && group && (
              <form className="feed-composer" onSubmit={post}>
                <div className="feed-composer-row">
                  <Avatar name="You" />
                  <textarea
                    className="feed-composer-input"
                    aria-label={`Post in ${group.name}`}
                    placeholder={`Post in ${group.name}…`}
                    rows={2}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                </div>
                {postError && (
                  <div className="feed-composer-error" role="alert">
                    {postError}
                  </div>
                )}
                <div className="feed-composer-actions">
                  {draft.length > 0 && (
                    <span
                      className={`feed-composer-count${draft.length > MAX_POST_CHARS ? " over" : ""}`}
                      aria-live="polite"
                    >
                      {draft.length} / {MAX_POST_CHARS}
                    </span>
                  )}
                  <button
                    className="feed-post-btn"
                    type="submit"
                    aria-busy={posting}
                    disabled={!draft.trim() || posting || draft.length > MAX_POST_CHARS}
                  >
                    {posting ? "Posting…" : "Post"}
                  </button>
                </div>
              </form>
            )}

            {loading ? (
              <div className="feed-state">Loading…</div>
            ) : posts.length === 0 ? (
              <div className="feed-state">
                {isMember ? "No posts yet — start the conversation." : "No posts to show yet."}
              </div>
            ) : (
              posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  client={client}
                  cloudUrl={cloudUrl}
                  canDelete={canModerate || (!post.pageId && post.author.id === viewerId)}
                  viewerId={viewerId}
                  onChange={updatePost}
                  onDelete={removePost}
                  onBlock={(authorId) => setPosts((prev) => prev.filter((p) => p.author.id !== authorId))}
                  onRepost={(next) => setPosts((prev) => prependUnique(prev, next))}
                />
              ))
            )}
          </>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this group?"
          message={`"${group?.name ?? "This group"}" and all of its posts and memberships will be removed. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => void deleteGroup()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {confirmLeave && (
        <ConfirmDialog
          title="Leave this group?"
          message={`You'll stop seeing posts from ${group?.name ?? "this group"}.`}
          confirmLabel="Leave"
          onConfirm={() => {
            setConfirmLeave(false);
            void toggleJoin();
          }}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}

const FEED_TAB_KEY = "botifyr.feedTab";
const FEED_SORT_KEY = "botifyr.feedSort";
/** Mirrors the server's MAX_POST_BODY (apps/cloud/src/server.ts). */
const MAX_POST_CHARS = 4000;
/** Mirrors the server's `/v1/uploads/raw` guard (50 MB). The composer streams
 *  raw bytes, so there is no base64 inflation to account for. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** The server keeps at most 4 media ids per post. */
const MAX_ATTACHMENTS = 4;
/** Composer text is persisted so it survives a reload; media is never persisted
 *  (base64 would blow the storage quota and is a privacy risk). */
const FEED_DRAFT_KEY = "botifyr.feedDraft";
/** A small, curated set for the composer's "Mood" picker. */
const FEED_EMOJIS = [
  "😀",
  "😄",
  "😁",
  "😆",
  "😊",
  "🙂",
  "😉",
  "😍",
  "😘",
  "😎",
  "🤩",
  "🥳",
  "😇",
  "🤔",
  "😴",
  "😭",
  "😅",
  "😂",
  "🤣",
  "😢",
  "😮",
  "😡",
  "🤯",
  "🥺",
  "👍",
  "👏",
  "🙌",
  "🙏",
  "💪",
  "👋",
  "🤝",
  "✌️",
  "❤️",
  "🔥",
  "✨",
  "🎉",
  "💡",
  "🚀",
  "🌟",
  "☕",
];

/** A file the user picked, held in memory until it is uploaded on publish. */
interface ComposerAttachment {
  /** Stable key so a retry uploads only files that have not succeeded yet. */
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Per-image accessibility description (optional). */
  alt: string;
  /** The original bytes, streamed to `/v1/uploads/raw` on publish. */
  file: File;
  /** Object URL used only for the local preview; revoked when the file leaves. */
  previewUrl: string;
}

/** Groups landing: discovery, the viewer's groups, and the groups they manage. */
function GroupsView({
  client,
  cloudUrl,
  onBack,
  onOpenGroup,
  onChanged,
}: {
  client: BotifyrClient;
  cloudUrl: string;
  onBack: () => void;
  onOpenGroup?: (handle: string) => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<"discover" | "mine" | "managed">("discover");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bumped to retry a failed load without changing the tab. */
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    about: "",
    category: "",
    avatarEmoji: "",
    privacy: "public" as "public" | "private",
  });
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();
  const [coverUrl, setCoverUrl] = useState<string | undefined>();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    client
      .groupCategories()
      .then((result) => {
        if (active) setCategories(result.categories);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (tab !== "discover") return;
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, tab]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const request =
      tab === "mine"
        ? client.listGroups()
        : tab === "managed"
          ? client.listManagedGroups()
          : client.discoverGroups({ query, category });
    request
      .then((list) => {
        if (active) setGroups(list);
      })
      .catch(() => {
        // Keep any data already on screen; surface a retry instead of blanking it.
        if (active) setError("We couldn't reach the groups service. Check your connection and try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, tab, query, category, reloadKey]);

  function patchGroup(id: string, patch: Partial<Group>) {
    setGroups((prev) => (prev ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  async function act(group: Group) {
    if (group.joined) {
      onOpenGroup?.(group.handle);
      return;
    }
    if (group.requestPending || busyId) return;
    setBusyId(group.id);
    setNotice(null);
    try {
      const result = await client.joinGroup(group.id);
      if (result.status === "pending") {
        patchGroup(group.id, { requestPending: true });
        setNotice(`Request sent to ${group.name}.`);
      } else {
        patchGroup(group.id, { joined: true, role: "member", members: group.members + 1 });
        setNotice(`You joined ${group.name}.`);
        onChanged?.();
      }
    } catch {
      setError("Couldn't join that group.");
    } finally {
      setBusyId(null);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setCreateError(null);
    try {
      const group = await client.createGroup({
        name: form.name,
        about: form.about,
        category: form.category,
        avatarEmoji: form.avatarEmoji,
        privacy: form.privacy,
        avatarUrl,
        coverUrl,
      });
      setCreating(false);
      setForm({ name: "", about: "", category: "", avatarEmoji: "", privacy: "public" });
      setAvatarUrl(undefined);
      setCoverUrl(undefined);
      setNotice(`Created ${group.name}.`);
      onChanged?.();
      onOpenGroup?.(group.handle);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't create the group.");
    } finally {
      setSaving(false);
    }
  }

  const emptyCopy =
    tab === "mine"
      ? { emoji: "👥", title: "No groups yet", sub: "Groups you join will appear here." }
      : tab === "managed"
        ? { emoji: "🛠️", title: "Nothing managed yet", sub: "Groups you create show up here." }
        : { emoji: "🔍", title: "No groups found", sub: "Try a different search or category." };

  return (
    <div className="feed">
      <div className="feed-topbar">
        <button type="button" className="ghost small" onClick={onBack}>
          ← Back
        </button>
        <span className="feed-topbar-title">Groups</span>
        <button
          type="button"
          className="feed-follow-btn"
          onClick={() => {
            setCreating((value) => !value);
            setCreateError(null);
          }}
        >
          {creating ? <CloseIcon size={14} /> : <PlusIcon size={14} />}
          {creating ? "Cancel" : "Create group"}
        </button>
      </div>
      <div className="feed-scroll">
        {creating && (
          <form className="page-settings group-create" onSubmit={create}>
            <div className="feed-rail-head">Create a group</div>
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Weekend Hikers"
                required
              />
            </label>
            <label>
              About
              <textarea
                rows={3}
                value={form.about}
                onChange={(e) => setForm({ ...form, about: e.target.value })}
                placeholder="What is this group about?"
              />
            </label>
            <label>
              Category
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Sports"
                list="group-category-options"
              />
            </label>
            <datalist id="group-category-options">
              {categories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <label>
              Privacy
              <select
                value={form.privacy}
                onChange={(e) => setForm({ ...form, privacy: e.target.value as "public" | "private" })}
              >
                <option value="public">Public — anyone can join</option>
                <option value="private">Private — approval required</option>
              </select>
            </label>
            <div className="group-image-row">
              <div className="group-image-field">
                <span>Profile image</span>
                {avatarUrl ? <img className="group-image-preview round" src={avatarUrl} alt="" /> : null}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="group-image-input"
                  aria-label="Choose a profile image"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setAvatarUrl(await readImageDataUrl(file, 3 * 1024 * 1024));
                      setCreateError(null);
                    } catch (err) {
                      setCreateError(err instanceof Error ? err.message : "Couldn't read that image.");
                    }
                  }}
                />
                <button type="button" className="ghost small" onClick={() => avatarInputRef.current?.click()}>
                  <CameraIcon size={15} /> Choose
                </button>
              </div>
              <div className="group-image-field">
                <span>Cover image</span>
                {coverUrl ? <img className="group-image-preview" src={coverUrl} alt="" /> : null}
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="group-image-input"
                  aria-label="Choose a cover image"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setCoverUrl(await readImageDataUrl(file, 4 * 1024 * 1024));
                      setCreateError(null);
                    } catch (err) {
                      setCreateError(err instanceof Error ? err.message : "Couldn't read that image.");
                    }
                  }}
                />
                <button type="button" className="ghost small" onClick={() => coverInputRef.current?.click()}>
                  <CameraIcon size={15} /> Choose
                </button>
              </div>
            </div>
            {createError && (
              <p className="feed-composer-error" role="alert">
                {createError}
              </p>
            )}
            <div className="page-settings-actions">
              <button type="button" className="ghost small" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="feed-post-btn" type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        )}

        <div className="group-toolbar">
          <nav className="page-tabs group-scope" role="tablist" aria-label="Group scope">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "discover"}
              className={`page-tab${tab === "discover" ? " active" : ""}`}
              onClick={() => setTab("discover")}
            >
              <SearchIcon size={14} /> Discover
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "mine"}
              className={`page-tab${tab === "mine" ? " active" : ""}`}
              onClick={() => setTab("mine")}
            >
              <UsersIcon size={14} /> Your groups
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "managed"}
              className={`page-tab${tab === "managed" ? " active" : ""}`}
              onClick={() => setTab("managed")}
            >
              <ShieldIcon size={14} /> Managed by you
            </button>
          </nav>
          {tab === "discover" && (
            <div className="group-filters">
              <span className="group-search">
                <SearchIcon size={15} />
                <input
                  aria-label="Search groups"
                  placeholder="Search groups"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </span>
              <select
                aria-label="Filter by category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {notice && (
          <p className="group-notice" role="status">
            {notice}
          </p>
        )}

        {error && groups && (
          <p className="group-inline-error" role="alert">
            {error}
          </p>
        )}

        {error && !groups ? (
          <div className="group-error" role="alert">
            <span className="group-error-ico" aria-hidden="true">
              <UsersIcon size={22} />
            </span>
            <div className="group-error-title">Couldn't load groups</div>
            <p className="group-error-sub">{error}</p>
            <button type="button" className="feed-follow-btn" onClick={() => setReloadKey((n) => n + 1)}>
              <RefreshIcon size={14} /> Try again
            </button>
          </div>
        ) : groups === null ? (
          <div className="group-grid" aria-hidden="true">
            {[0, 1, 2, 3].map((key) => (
              <div key={key} className="group-card group-skel">
                <span className="group-skel-cover" />
                <span className="group-skel-line" style={{ width: "60%" }} />
                <span className="group-skel-line" style={{ width: "85%" }} />
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="feed-empty">
            <div className="feed-empty-emoji">{emptyCopy.emoji}</div>
            <div className="feed-empty-title">{emptyCopy.title}</div>
            <div className="feed-empty-sub">{emptyCopy.sub}</div>
          </div>
        ) : (
          <>
            <div className="group-count" aria-live="polite">
              {groups.length} group{groups.length === 1 ? "" : "s"}
              {loading ? " · updating…" : ""}
            </div>
            <div className="group-grid">
              {groups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  cloudUrl={cloudUrl}
                  busy={busyId === group.id}
                  onOpen={() => onOpenGroup?.(group.handle)}
                  onAction={() => void act(group)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The Feed-only bottom menu, shared by the home feed and its sub-views. */
function FeedBottomNav({
  tab,
  onHome,
  onReels,
  onPages,
  onGroups,
  onMarketplace,
}: {
  tab: "all" | "friends" | "pages";
  onHome: () => void;
  onReels: () => void;
  onPages: () => void;
  onGroups: () => void;
  onMarketplace?: () => void;
}) {
  return (
    <nav className="feed-bottom-nav" aria-label="Feed navigation">
      <button
        type="button"
        className={`bottom-nav-item${tab !== "pages" ? " active" : ""}`}
        aria-current={tab !== "pages" ? "page" : undefined}
        aria-label="Feed home"
        onClick={onHome}
      >
        <HomeIcon size={20} />
        <span>Feed</span>
      </button>
      <button type="button" className="bottom-nav-item" aria-label="Reels" onClick={onReels}>
        <PlayIcon size={20} />
        <span>Reels</span>
      </button>
      <button
        type="button"
        className={`bottom-nav-item${tab === "pages" ? " active" : ""}`}
        aria-current={tab === "pages" ? "page" : undefined}
        aria-label="Open Pages"
        onClick={onPages}
      >
        <PanelIcon size={20} />
        <span>Pages</span>
      </button>
      <button type="button" className="bottom-nav-item" aria-label="Open Groups" onClick={onGroups}>
        <UsersIcon size={20} />
        <span>Groups</span>
      </button>
      <button
        type="button"
        className="bottom-nav-item"
        aria-label="Open Marketplace"
        onClick={onMarketplace}
        disabled={!onMarketplace}
      >
        <CubeIcon size={20} />
        <span>Marketplace</span>
      </button>
    </nav>
  );
}

export function FeedView({
  client,
  viewerId,
  cloudUrl,
  refreshKey = 0,
  pageHandle,
  onOpenPage,
  groupHandle,
  onOpenGroup,
  albumName,
  onOpenAlbum,
  onOpenNav,
  onOpenMarketplace,
  onStoryReplySent,
  focusPostId,
  onChanged,
}: {
  client: BotifyrClient;
  viewerId?: string;
  cloudUrl: string;
  /** Bumped by the host on feed events; reloads the top of the feed. */
  refreshKey?: number;
  /** When set, show this Page's timeline instead of the feed. */
  pageHandle?: string | null;
  onOpenPage?: (handle: string | null) => void;
  /** When set, show this Group's stream instead of the feed. */
  groupHandle?: string | null;
  onOpenGroup?: (handle: string | null) => void;
  /** When set, show this album instead of the feed. */
  albumName?: string | null;
  onOpenAlbum?: (name: string | null) => void;
  /** Open the app's navigation drawer (narrow screens only). */
  onOpenNav?: () => void;
  /** Open the Marketplace surface (owned by the host). */
  onOpenMarketplace?: () => void;
  /** After a story reply is sent, open the DM conversation (FR-13). */
  onStoryReplySent?: (session: Session) => void;
  /** Permalink target: scroll to and highlight this post when it loads. */
  focusPostId?: string | null;
  /** Called after a group mutation so the host can refresh rails/stores. */
  onChanged?: () => void;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pendingNew, setPendingNew] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  /** Polite live-region text announced to screen readers after pagination. */
  const [liveMessage, setLiveMessage] = useState("");
  /** `@handle` whose mini-profile is open (mention routing). */
  const [mentionHandle, setMentionHandle] = useState<string | null>(null);
  const [errorMode, setErrorMode] = useState<"reset" | "more">("reset");
  const [draft, setDraft] = useState(() => localStorage.getItem(FEED_DRAFT_KEY) ?? "");
  const [posting, setPosting] = useState(false);
  /** Set while media uploads run, so the composer can show n / total progress. */
  const [upload, setUpload] = useState<{
    done: number;
    total: number;
    loaded: number;
    totalBytes: number;
  } | null>(null);
  /** Composer-specific errors stay separate from timeline-load errors. */
  const [composerError, setComposerError] = useState<string | null>(null);
  /** Transient confirmation shown after a successful publish/schedule. */
  const [notice, setNotice] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(
    () => (localStorage.getItem(FEED_DRAFT_KEY) ?? "").trim().length > 0,
  );
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [moodOpen, setMoodOpen] = useState(false);
  const [audience, setAudience] = useState<"public" | "friends" | "only_me">("friends");
  const [scheduledAt, setScheduledAt] = useState("");
  const [album, setAlbum] = useState("");
  const [pollOpen, setPollOpen] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [tab, setTab] = useState<"all" | "friends" | "pages">(() => {
    const stored = localStorage.getItem(FEED_TAB_KEY);
    return stored === "friends" || stored === "pages" ? stored : "all";
  });
  const [sort, setSort] = useState<"recent" | "top">(() =>
    localStorage.getItem(FEED_SORT_KEY) === "top" ? "top" : "recent",
  );
  const [openTag, setOpenTag] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [postAs, setPostAs] = useState("");
  const [creatingPage, setCreatingPage] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [mentionResults, setMentionResults] = useState<Person[]>([]);
  const [reelsOpen, setReelsOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const postsRef = useRef<FeedPost[]>([]);
  /** Saved scroll offset per tab:sort view, restored when returning from a sub-view. */
  const scrollPosRef = useRef<Record<string, number>>({});
  /** Monotonic id so a superseded pagination response can be discarded. */
  const loadSeqRef = useRef(0);
  /** Keys of requests currently in flight, so identical ones are not re-sent. */
  const inFlightRef = useRef<Set<string>>(new Set());
  const lastRefreshKeyRef = useRef(refreshKey);
  /** Last time we checked for newer posts on regaining focus (throttle). */
  const lastWakeCheckRef = useRef(0);
  const viewKeyRef = useRef("all:recent");
  /** attachment id -> uploaded media id, so a retry after a partial failure
   *  never re-uploads what already succeeded. */
  const uploadedMediaRef = useRef<Map<string, string>>(new Map());
  /** Latest draft text, so the async server-draft fetch never clobbers typing. */
  const draftRef = useRef(draft);

  /** As the user types `@name`, offer people to insert. */
  async function updateMentions(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setDraft(value);
    setNotice(null);
    if (draftRestored) setDraftRestored(false);
    const caret = event.target.selectionStart ?? value.length;
    const match = /(?:^|\s)@([A-Za-z0-9_]*)$/.exec(value.slice(0, caret));
    if (!match) {
      setMentionResults([]);
      return;
    }
    const query = match[1];
    if (query.length === 0) {
      setMentionResults([]);
      return;
    }
    try {
      setMentionResults(await client.searchPeople(query));
    } catch {
      setMentionResults([]);
    }
  }

  function insertMention(person: Person) {
    if (!person.handle) return;
    const element = composerRef.current;
    const caret = element?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/(^|\s)@([A-Za-z0-9_]*)$/, `$1@${person.handle} `);
    setDraft(before + draft.slice(caret));
    setMentionResults([]);
  }

  /** Insert an emoji at the caret (falls back to the end) from the Mood picker. */
  function insertEmoji(emoji: string) {
    const element = composerRef.current;
    const caret = element?.selectionStart ?? draft.length;
    setDraft(draft.slice(0, caret) + emoji + draft.slice(caret));
    setNotice(null);
    if (draftRestored) setDraftRestored(false);
    const nextCaret = caret + emoji.length;
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function pickImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setComposerError(null);
    setNotice(null);
    // Validate before reading: an over-limit file never enters memory or the
    // network, so the user sees the real limit instead of a failed upload.
    const rejected: string[] = [];
    let accepted = 0;
    const remaining = MAX_ATTACHMENTS - attachments.length;
    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      if (!file.type.startsWith("image/") && !isVideo) {
        rejected.push(`${file.name} isn't an image or video`);
        continue;
      }
      const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (file.size > limit) {
        rejected.push(`${file.name} is too large (max ${Math.round(limit / 1024 / 1024)} MB)`);
        continue;
      }
      if (accepted >= remaining) {
        rejected.push(`You can attach up to ${MAX_ATTACHMENTS} files`);
        break;
      }
      accepted += 1;
      const attachment: ComposerAttachment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        mime: file.type,
        size: file.size,
        alt: "",
        file,
        previewUrl: URL.createObjectURL(file),
      };
      setAttachments((prev) => {
        if (prev.length >= MAX_ATTACHMENTS) {
          URL.revokeObjectURL(attachment.previewUrl);
          return prev;
        }
        return [...prev, attachment];
      });
    }
    if (rejected.length > 0) setComposerError(rejected.join(" · "));
  }

  /** Remove a picked file and forget any media id already uploaded for it. */
  function removeAttachment(target: ComposerAttachment) {
    uploadedMediaRef.current.delete(target.id);
    setAttachments((prev) => prev.filter((file) => file.id !== target.id));
  }

  /** Update one attachment's alt text (accessibility description). */
  function setAttachmentAlt(id: string, alt: string) {
    setAttachments((prev) => prev.map((file) => (file.id === id ? { ...file, alt } : file)));
  }

  viewKeyRef.current = `${tab}:${sort}`;
  draftRef.current = draft;

  // Permalink: if the focused post isn't in the loaded timeline, fetch it once.
  const focusTriedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPostId) return;
    if (posts.some((post) => post.id === focusPostId)) return;
    if (focusTriedRef.current === focusPostId) return;
    focusTriedRef.current = focusPostId;
    let active = true;
    client
      .getPost(focusPostId)
      .then((post) => {
        if (active) setPosts((prev) => prependUnique(prev, post));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client, focusPostId, posts]);

  /** Load a page of the timeline. `reset` replaces the list; `more` appends. */
  const load = useCallback(
    async (mode: "reset" | "more") => {
      // De-duplicate identical concurrent requests (StrictMode remounts, a
      // double observer fire). Checked before bumping the sequence so the
      // original request is not invalidated by its duplicate.
      const requestKey = `${mode}:${mode === "more" ? (cursor ?? "") : ""}:${tab}:${sort}`;
      if (inFlightRef.current.has(requestKey)) return;
      inFlightRef.current.add(requestKey);
      const seq = ++loadSeqRef.current;
      if (mode === "reset") {
        setLoading(true);
        setLoadingMore(false);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const page = await client.listFeed(mode === "reset" ? undefined : (cursor ?? undefined), 20, {
          tab,
          sort,
        });
        // A newer request superseded this one — drop the stale response so it
        // cannot clobber or duplicate the list (e.g. a refresh racing a "more").
        if (seq !== loadSeqRef.current) return;
        if (mode === "reset") {
          setPosts(page.items);
          setExhausted(false);
          setPendingNew(false);
        } else {
          // De-duplicate so paginating can never render the same post twice.
          const seen = new Set(postsRef.current.map((post) => post.id));
          const fresh = page.items.filter((post) => !seen.has(post.id));
          setPosts((prev) => [...prev, ...fresh.filter((post) => !prev.some((p) => p.id === post.id))]);
          // If a page added nothing new, stop auto-loading to avoid a loop.
          if (fresh.length === 0) setExhausted(true);
          // Announce how much arrived, so screen-reader users know more loaded.
          setLiveMessage(
            fresh.length > 0 ? `${fresh.length} more ${fresh.length === 1 ? "post" : "posts"} loaded` : "",
          );
        }
        setCursor(page.nextCursor);
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        setError(err instanceof Error ? err.message : "Couldn't load the feed");
        setErrorMode(mode === "more" ? "more" : "reset");
      } finally {
        inFlightRef.current.delete(requestKey);
        if (mode === "reset") {
          if (seq === loadSeqRef.current) setLoading(false);
        } else {
          setLoadingMore(false);
        }
      }
    },
    [client, cursor, tab, sort],
  );

  // Keep a ref copy of the list so pagination can de-duplicate synchronously.
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  // Load on mount and whenever the view (tab/sort) changes. Refresh events are
  // handled separately so they don't disrupt someone mid-read.
  useEffect(() => {
    scrollPosRef.current = {};
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    void load("reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tab, sort]);

  // Infinite scroll: fetch the next page when the bottom sentinel nears view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    if (!cursor || exhausted || loading || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load("more");
      },
      { root: scrollRef.current, rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, exhausted, loading, loadingMore, load]);

  // Realtime feed events bump `refreshKey`. If the reader has scrolled into the
  // timeline, hold the update behind a "new activity" pill instead of yanking
  // content out from under them.
  useEffect(() => {
    if (lastRefreshKeyRef.current === refreshKey) return;
    lastRefreshKeyRef.current = refreshKey;
    const node = scrollRef.current;
    if (node && node.scrollTop > 120 && postsRef.current.length > 0) {
      setPendingNew(true);
    } else {
      void load("reset");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Freshness fallback (frontend-only): when the app regains focus/visibility,
  // check whether anything newer was posted. This keeps "new content" working
  // even where the realtime stream (DB-1) doesn't deliver, and never disturbs a
  // reader because it only raises the banner. Throttled to avoid request spam.
  useEffect(() => {
    async function checkForNew() {
      if (postsRef.current.length === 0) return;
      const now = Date.now();
      if (now - lastWakeCheckRef.current < 15000) return;
      lastWakeCheckRef.current = now;
      try {
        const page = await client.listFeed(undefined, 1, { tab, sort });
        const top = page.items[0];
        const currentTop = postsRef.current[0];
        if (top && currentTop && top.id !== currentTop.id) setPendingNew(true);
      } catch {
        // Non-fatal: the manual Refresh control still works.
      }
    }
    function onWake() {
      if (document.visibilityState !== "visible") return;
      void checkForNew();
    }
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [client, tab, sort]);

  // Remember the reader's tab/sort so leaving and returning to the Feed keeps
  // their choice (docs/feed-next.md FR-9).
  useEffect(() => {
    localStorage.setItem(FEED_TAB_KEY, tab);
  }, [tab]);

  useEffect(() => {
    localStorage.setItem(FEED_SORT_KEY, sort);
  }, [sort]);

  // Persist the composer text (only) so a reload or tab switch can't destroy it.
  useEffect(() => {
    if (draft.trim()) localStorage.setItem(FEED_DRAFT_KEY, draft);
    else localStorage.removeItem(FEED_DRAFT_KEY);
  }, [draft]);

  // Revoke preview object URLs for attachments that have left the composer
  // (removed, or cleared after publishing) so the blobs can be freed.
  const previewUrlsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const current = new Map(attachments.map((file) => [file.id, file.previewUrl]));
    for (const [id, url] of previewUrlsRef.current) {
      if (!current.has(id)) URL.revokeObjectURL(url);
    }
    previewUrlsRef.current = current;
  }, [attachments]);

  // Adopt a server-synced draft when nothing is on screen (e.g. another device).
  useEffect(() => {
    let active = true;
    client
      .getPostDraft()
      .then((serverDraft) => {
        if (!active || !serverDraft?.body) return;
        if (draftRef.current.trim()) return; // never clobber text already on screen
        setDraft(serverDraft.body);
        setDraftRestored(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  // Debounced server save so a draft follows the user across devices. The first
  // run never deletes, so an empty screen can't wipe a server draft before the
  // read above has had a chance to adopt it.
  const draftSyncedRef = useRef(false);
  useEffect(() => {
    const handle = setTimeout(() => {
      if (!draftSyncedRef.current) {
        draftSyncedRef.current = true;
        if (!draft.trim()) return;
      }
      if (draft.trim()) void client.savePostDraft(draft).catch(() => {});
      else void client.deletePostDraft().catch(() => {});
    }, 900);
    return () => clearTimeout(handle);
  }, [client, draft]);

  useEffect(() => {
    let active = true;
    client
      .listMyPages()
      .then((list) => {
        if (active) setPages(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  async function createPage() {
    const name = newPageName.trim();
    if (!name) return;
    try {
      const page = await client.createPage({ name });
      setPages((prev) => [...prev, page]);
      setPostAs(page.id);
      setNewPageName("");
      setCreatingPage(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the page");
    }
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if ((!body && attachments.length === 0) || posting) return;
    // A past time would be silently dropped server-side and post immediately, so
    // refuse it here rather than letting "Schedule" mean "post now".
    if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) {
      setComposerError("Pick a future time to schedule, or clear the schedule to post now.");
      return;
    }
    setPosting(true);
    setComposerError(null);
    setNotice(null);
    uploadedMediaRef.current.clear();
    try {
      const mediaIds: string[] = [];
      const totalBytes = attachments.reduce((sum, file) => sum + file.size, 0);
      let completedBytes = 0;
      if (attachments.length > 0) {
        setUpload({ done: 0, total: attachments.length, loaded: 0, totalBytes });
      }
      for (const file of attachments) {
        // Raw bytes, so large media isn't inflated by base64 on the wire. The
        // callback adds byte-level progress on top of the per-file count.
        const media = await client.uploadFileRaw(
          { name: file.name, mime: file.mime, blob: file.file },
          (loaded) =>
            setUpload({
              done: mediaIds.length,
              total: attachments.length,
              loaded: completedBytes + loaded,
              totalBytes,
            }),
        );
        uploadedMediaRef.current.set(file.id, media.id);
        mediaIds.push(media.id);
        completedBytes += file.size;
        setUpload({
          done: mediaIds.length,
          total: attachments.length,
          loaded: completedBytes,
          totalBytes,
        });
      }
      const poll = pollOptions.map((option) => option.trim()).filter(Boolean);
      const post = await client.createPost({
        body,
        mediaIds,
        alts: attachments.length > 0 ? attachments.map((file) => file.alt.trim()) : undefined,
        pageId: postAs || undefined,
        audience,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        album: attachments.length > 0 && album.trim() ? album.trim() : undefined,
        poll: pollOpen && poll.length >= 2 ? poll : undefined,
      });
      // Confirm only after the server returned the created post. Dedupe so a
      // realtime refresh that already delivered it can't double the card.
      setPosts((prev) => prependUnique(prev, post));
      if (scheduledAt) {
        setNotice(`Scheduled for ${new Date(scheduledAt).toLocaleString()}`);
      } else if (postAs) {
        setNotice(`Posted as ${pages.find((page) => page.id === postAs)?.name ?? "your Page"}`);
      } else {
        setNotice("Post published");
      }
      // Reset every field so the next post starts clean and can't accidentally
      // repeat a Page destination or a narrow audience.
      setDraft("");
      setAttachments([]);
      setScheduledAt("");
      setAlbum("");
      setPollOpen(false);
      setPollOptions(["", ""]);
      setPostAs("");
      setAudience("friends");
      setDraftRestored(false);
      uploadedMediaRef.current.clear();
      localStorage.removeItem(FEED_DRAFT_KEY);
      void client.deletePostDraft().catch(() => {});
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : "Couldn't publish that post");
    } finally {
      setPosting(false);
      setUpload(null);
    }
  }

  const updatePost = (next: FeedPost) => setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));
  /** A repost arrives as a new post at the top of the feed. */
  const prependPost = (next: FeedPost) => setPosts((prev) => prependUnique(prev, next));
  /** After blocking, drop that author's posts from the local feed. */
  const removeAuthorPosts = (authorId: string) =>
    setPosts((prev) => prev.filter((p) => p.author.id !== authorId));

  /** Restore the scroll offset when returning from a Page/Group/Tag/Reels view. */
  const attachScroll = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    if (node) node.scrollTop = scrollPosRef.current[viewKeyRef.current] ?? 0;
  }, []);

  function onFeedScroll(event: UIEvent<HTMLDivElement>) {
    scrollPosRef.current[viewKeyRef.current] = event.currentTarget.scrollTop;
  }

  /** Manual refresh: reload the top of the feed and return to the start. */
  function refreshNow() {
    scrollPosRef.current[viewKeyRef.current] = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setPendingNew(false);
    void load("reset");
  }

  function goHome() {
    setOpenTag(null);
    setReelsOpen(false);
    setGroupsOpen(false);
    onOpenPage?.(null);
    onOpenGroup?.(null);
    onOpenAlbum?.(null);
    setTab("all");
  }
  function goReels() {
    setOpenTag(null);
    setGroupsOpen(false);
    onOpenPage?.(null);
    onOpenGroup?.(null);
    onOpenAlbum?.(null);
    setReelsOpen(true);
  }
  function goPages() {
    goHome();
    setTab("pages");
  }
  function goGroups() {
    setOpenTag(null);
    setReelsOpen(false);
    onOpenPage?.(null);
    onOpenGroup?.(null);
    onOpenAlbum?.(null);
    setGroupsOpen(true);
  }
  const feedNav = (
    <FeedBottomNav
      tab={tab}
      onHome={goHome}
      onReels={goReels}
      onPages={goPages}
      onGroups={goGroups}
      onMarketplace={onOpenMarketplace}
    />
  );
  function withNav(content: ReactNode) {
    return (
      <div className="feed-shell">
        {content}
        {feedNav}
      </div>
    );
  }

  if (openTag) {
    return withNav(
      <TagView
        client={client}
        cloudUrl={cloudUrl}
        viewerId={viewerId}
        tag={openTag}
        onBack={() => setOpenTag(null)}
        onOpenTag={(next) => setOpenTag(next)}
      />,
    );
  }

  if (albumName) {
    return withNav(
      <AlbumView
        client={client}
        cloudUrl={cloudUrl}
        viewerId={viewerId}
        name={albumName}
        onBack={() => onOpenAlbum?.(null)}
      />,
    );
  }

  if (reelsOpen) {
    return withNav(<ReelsView client={client} cloudUrl={cloudUrl} onBack={() => setReelsOpen(false)} />);
  }

  if (groupsOpen) {
    return withNav(
      <GroupsView
        client={client}
        cloudUrl={cloudUrl}
        onBack={() => setGroupsOpen(false)}
        onOpenGroup={(handle) => {
          setGroupsOpen(false);
          onOpenGroup?.(handle);
        }}
        onChanged={onChanged}
      />,
    );
  }

  if (groupHandle) {
    return withNav(
      <GroupView
        client={client}
        cloudUrl={cloudUrl}
        viewerId={viewerId}
        handle={groupHandle}
        onBack={() => onOpenGroup?.(null)}
        onChanged={onChanged}
      />,
    );
  }

  if (pageHandle) {
    return withNav(
      <PageView
        client={client}
        cloudUrl={cloudUrl}
        viewerId={viewerId}
        handle={pageHandle}
        onBack={() => onOpenPage?.(null)}
        onOpenPage={(next) => onOpenPage?.(next)}
      />,
    );
  }

  // Byte-level progress when sizes are known, else fall back to file count.
  const uploadPercent = upload
    ? upload.totalBytes > 0
      ? Math.round((upload.loaded / upload.totalBytes) * 100)
      : Math.round((upload.done / Math.max(upload.total, 1)) * 100)
    : 0;

  return (
    <div className="feed">
      <div className="feed-topbar">
        {onOpenNav && (
          <button type="button" className="mobile-nav-btn" onClick={onOpenNav} aria-label="Show navigation">
            <MenuIcon size={18} />
          </button>
        )}
        <span className="feed-topbar-title">Feed</span>
        <div className="feed-tabs">
          <button
            type="button"
            className={`feed-tab${tab === "all" ? " active" : ""}`}
            onClick={() => setTab("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`feed-tab${tab === "friends" ? " active" : ""}`}
            onClick={() => setTab("friends")}
          >
            Friends
          </button>
          <button
            type="button"
            className={`feed-tab${tab === "pages" ? " active" : ""}`}
            onClick={() => setTab("pages")}
          >
            Pages
          </button>
        </div>
        <span className="feed-stats-spacer" />
        <select
          className="feed-sort"
          aria-label="Sort feed"
          title="Sort feed"
          value={sort}
          onChange={(event) => setSort(event.target.value as "recent" | "top")}
        >
          <option value="recent">Most recent</option>
          <option value="top">Top</option>
        </select>
        <button
          type="button"
          className="feed-composer-tool"
          onClick={refreshNow}
          aria-label="Refresh feed"
          title="Refresh feed"
        >
          <RefreshIcon size={16} />
        </button>
      </div>

      <div className="feed-scroll" ref={attachScroll} onScroll={onFeedScroll}>
        {pendingNew && (
          <button type="button" className="feed-new-banner" onClick={refreshNow}>
            <RefreshIcon size={14} /> New activity — tap to refresh
          </button>
        )}
        <form className="feed-composer" onSubmit={publish}>
          <div className="feed-composer-row">
            <Avatar name="You" />
            <textarea
              id="feed-composer-input"
              ref={composerRef}
              className="feed-composer-input"
              aria-label="Post text"
              aria-describedby={draft ? "feed-composer-count" : undefined}
              placeholder="Share an update…"
              rows={2}
              value={draft}
              onChange={(event) => void updateMentions(event)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && mentionResults.length > 0) {
                  event.preventDefault();
                  setMentionResults([]);
                }
              }}
            />
          </div>
          {draftRestored && (
            <div className="feed-draft-hint" role="status">
              <span>Draft restored</span>
              <button
                type="button"
                className="feed-composer-tool"
                onClick={() => {
                  setDraft("");
                  setDraftRestored(false);
                  localStorage.removeItem(FEED_DRAFT_KEY);
                  void client.deletePostDraft().catch(() => {});
                }}
              >
                Discard
              </button>
            </div>
          )}
          {mentionResults.length > 0 && (
            <div className="mention-menu" role="listbox" aria-label="People to mention">
              {mentionResults.slice(0, 6).map((person) => (
                <button
                  key={person.id}
                  type="button"
                  role="option"
                  className="mention-item"
                  onClick={() => insertMention(person)}
                >
                  <Avatar emoji={person.avatarEmoji} name={person.displayName} size={24} />
                  <span className="mention-name">
                    {person.displayName || (person.handle ? `@${person.handle}` : "Someone")}
                  </span>
                  {person.handle && <span className="mention-handle">@{person.handle}</span>}
                </button>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="feed-composer-grid" role="list" aria-label="Attachments">
              {attachments.map((file) => (
                <div key={file.id} className="feed-composer-thumb" role="listitem">
                  {file.mime.startsWith("video/") ? (
                    <>
                      <video src={file.previewUrl} muted preload="metadata" />
                      <span className="feed-composer-thumb-kind">Video</span>
                    </>
                  ) : (
                    <img src={file.previewUrl} alt={`Preview of ${file.name}`} />
                  )}
                  <button
                    type="button"
                    className="feed-attachment-remove"
                    onClick={() => removeAttachment(file)}
                    aria-label={`Remove ${file.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="feed-composer-alts" role="group" aria-label="Image descriptions">
              {attachments.map((file) => (
                <input
                  key={file.id}
                  className="feed-composer-as-input"
                  value={file.alt}
                  maxLength={200}
                  placeholder={`Alt text for ${file.name} (optional)`}
                  aria-label={`Alt text for ${file.name}`}
                  onChange={(event) => setAttachmentAlt(file.id, event.target.value)}
                />
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <input
              className="feed-composer-as-input"
              placeholder="Album name (optional)"
              value={album}
              onChange={(event) => setAlbum(event.target.value)}
            />
          )}
          {/* Compaction: destination, audience and schedule share one horizontal
              row instead of stacking, so the composer stays short. */}
          <div className="feed-composer-as">
            <select aria-label="Post as" value={postAs} onChange={(event) => setPostAs(event.target.value)}>
              <option value="">You</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
            {creatingPage ? (
              <>
                <input
                  className="feed-composer-as-input"
                  placeholder="New Page name"
                  value={newPageName}
                  autoFocus
                  onChange={(event) => setNewPageName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void createPage();
                    }
                  }}
                />
                <button type="button" className="feed-composer-tool" onClick={() => void createPage()}>
                  Create
                </button>
              </>
            ) : (
              <button type="button" className="feed-composer-tool" onClick={() => setCreatingPage(true)}>
                + New Page
              </button>
            )}
            <span className="feed-composer-divider" aria-hidden="true" />
            <select
              aria-label="Audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value as "public" | "friends" | "only_me")}
            >
              <option value="public">Public</option>
              <option value="friends">Friends</option>
              <option value="only_me">Only me</option>
            </select>
            <input
              type="datetime-local"
              className="feed-composer-as-input feed-composer-schedule"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              title="Schedule for later"
              aria-label="Schedule for later"
            />
          </div>
          {pollOpen && (
            <div className="feed-poll-editor">
              {pollOptions.map((option, index) => (
                <input
                  key={index}
                  className="feed-composer-as-input"
                  placeholder={`Option ${index + 1}`}
                  value={option}
                  onChange={(event) =>
                    setPollOptions((prev) =>
                      prev.map((value, i) => (i === index ? event.target.value : value)),
                    )
                  }
                />
              ))}
              {pollOptions.length < 4 && (
                <button
                  type="button"
                  className="feed-composer-tool"
                  onClick={() => setPollOptions((prev) => [...prev, ""])}
                >
                  + Add option
                </button>
              )}
              {pollOpen && pollOptions.filter((option) => option.trim()).length < 2 && (
                <span className="feed-composer-hint">Add at least 2 options to include a poll.</span>
              )}
            </div>
          )}
          {upload && (
            <div
              className="feed-upload"
              role="progressbar"
              aria-label="Uploading media"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadPercent}
            >
              <div className="feed-upload-track">
                <div className="feed-upload-fill" style={{ width: `${uploadPercent}%` }} />
              </div>
              <span className="feed-upload-label">
                Uploading {uploadPercent}% ({upload.done}/{upload.total})
              </span>
            </div>
          )}
          {composerError && (
            <div className="feed-composer-error" role="alert">
              {composerError}
            </div>
          )}
          {notice && (
            <div className="feed-composer-notice" role="status">
              {notice}
            </div>
          )}
          <div className="feed-composer-actions">
            <span className="feed-composer-destination">
              {postAs
                ? `Posting as ${pages.find((page) => page.id === postAs)?.name ?? "Page"}`
                : "Posting to your profile"}
              {" · "}
              {audience === "public" ? "Public" : audience === "only_me" ? "Only me" : "Friends"}
            </span>
            <button type="button" className="feed-composer-tool" onClick={() => fileRef.current?.click()}>
              <CameraIcon size={16} /> Photo
            </button>
            <span className="feed-mood">
              <button
                type="button"
                className={`feed-composer-tool${moodOpen ? " active" : ""}`}
                aria-haspopup="listbox"
                aria-expanded={moodOpen}
                onClick={() => setMoodOpen((value) => !value)}
              >
                <SmileyIcon size={16} /> Mood
              </button>
              {moodOpen && (
                <>
                  <div className="emoji-backdrop" onClick={() => setMoodOpen(false)} />
                  <div className="emoji-pop feed-mood-pop" role="listbox" aria-label="Add a mood emoji">
                    {FEED_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="emoji-choice"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          insertEmoji(emoji);
                          setMoodOpen(false);
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </span>
            <button
              type="button"
              className={`feed-composer-tool${pollOpen ? " active" : ""}`}
              onClick={() => setPollOpen((value) => !value)}
            >
              <ChartIcon size={16} /> Poll
            </button>
            {draft.length > 0 && (
              <span
                id="feed-composer-count"
                className={`feed-composer-count${draft.length > MAX_POST_CHARS ? " over" : ""}`}
                aria-live="polite"
              >
                {draft.length} / {MAX_POST_CHARS}
              </span>
            )}
            <button
              className="feed-post-btn"
              type="submit"
              aria-busy={posting}
              disabled={
                (!draft.trim() && attachments.length === 0) || posting || draft.length > MAX_POST_CHARS
              }
            >
              {posting
                ? upload
                  ? `Uploading ${upload.done}/${upload.total}…`
                  : "Publishing…"
                : scheduledAt
                  ? "Schedule"
                  : "Post"}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            style={{ display: "none" }}
            onChange={pickImages}
          />
        </form>

        <StoriesStrip
          client={client}
          cloudUrl={cloudUrl}
          viewerId={viewerId}
          onReplySent={onStoryReplySent}
        />

        {error && (
          <div className="feed-error" role="alert">
            <span>{error}</span>
            <button type="button" className="feed-error-retry" onClick={() => void load(errorMode)}>
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <>
            {[0, 1, 2].map((index) => (
              <div key={index} className="feed-skeleton" aria-hidden="true">
                <div className="feed-skeleton-head">
                  <div className="feed-skeleton-avatar" />
                  <div className="feed-skeleton-line short" />
                </div>
                <div className="feed-skeleton-line" />
                <div className="feed-skeleton-line" />
                <div className="feed-skeleton-media" />
              </div>
            ))}
          </>
        ) : posts.length === 0 ? (
          <div className="feed-empty">
            <div className="feed-empty-emoji">✨</div>
            <div className="feed-empty-title">Your feed is quiet</div>
            <div className="feed-empty-sub">
              {tab === "friends"
                ? "Add friends or switch to All to see posts from Pages you follow."
                : "Follow people and Pages to fill your feed — or share the first post above."}
            </div>
          </div>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              client={client}
              cloudUrl={cloudUrl}
              canDelete={!post.pageId && post.author.id === viewerId}
              viewerId={viewerId}
              focus={post.id === focusPostId}
              onChange={updatePost}
              onDelete={removePost}
              onBlock={removeAuthorPosts}
              onOpenPage={onOpenPage}
              onRepost={prependPost}
              onOpenTag={setOpenTag}
              onOpenMention={setMentionHandle}
            />
          ))
        )}

        {!loading &&
          posts.length > 0 &&
          (cursor && !exhausted ? (
            <button
              type="button"
              className="feed-more"
              onClick={() => void load("more")}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : (
            <div className="feed-end" role="status">
              You're all caught up
            </div>
          ))}

        <p className="visually-hidden" aria-live="polite">
          {liveMessage}
        </p>

        {!loading && posts.length > 0 && cursor && !exhausted && (
          <div ref={sentinelRef} className="feed-sentinel" aria-hidden="true" />
        )}
      </div>

      {mentionHandle && (
        <MentionProfile
          client={client}
          cloudUrl={cloudUrl}
          viewerId={viewerId}
          handle={mentionHandle}
          onClose={() => setMentionHandle(null)}
        />
      )}

      {feedNav}
    </div>
  );
}

export function FeedRail({
  client,
  refreshKey = 0,
  onOpenPage,
  onOpenGroup,
  onOpenAlbum,
}: {
  client: BotifyrClient;
  /** Bumped by the host after a mutation so the rail reloads its lists. */
  refreshKey?: number;
  onOpenPage?: (handle: string) => void;
  onOpenGroup?: (handle: string) => void;
  onOpenAlbum?: (name: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [blocked, setBlocked] = useState<Person[]>([]);
  const [trending, setTrending] = useState<FeedPost[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [pageSuggestions, setPageSuggestions] = useState<Page[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [albums, setAlbums] = useState<Array<{ name: string; count: number }>>([]);
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [requests, setRequests] = useState<Array<{ id: string; person: Person }>>([]);
  const [onlineFriends, setOnlineFriends] = useState<Person[]>([]);

  useEffect(() => {
    let active = true;
    client
      .suggestPeople(8)
      .then((list) => {
        if (active) setPeople(list);
      })
      .catch(() => {
        if (active) setPeople([]);
      });
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    client
      .listBlocks()
      .then((list) => {
        if (active) setBlocked(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    client
      .listTrending(3)
      .then((list) => {
        if (active) setTrending(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    client
      .listMyPages()
      .then((list) => {
        if (active) setPages(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  async function unblock(person: Person) {
    try {
      await client.unblockUser(person.id);
      setBlocked((prev) => prev.filter((entry) => entry.id !== person.id));
    } catch {
      // Leave the row so the user can retry.
    }
  }

  async function follow(person: Person) {
    setBusy(person.id);
    try {
      await client.addFriend(person.id);
      setRequested((prev) => ({ ...prev, [person.id]: true }));
    } catch {
      // Leave the button as-is so the user can retry.
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let active = true;
    client
      .listGroups()
      .then((list) => {
        if (active) setGroups(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client, refreshKey]);

  useEffect(() => {
    let active = true;
    client
      .suggestPages(6)
      .then((list) => {
        if (active) setPageSuggestions(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    client
      .listAlbums()
      .then((list) => {
        if (active) setAlbums(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    client
      .listFriendRequests()
      .then((list) => {
        if (!active) return;
        setRequests(
          list
            .filter((entry) => entry.direction === "incoming")
            .map((entry) => ({ id: entry.id, person: entry.person })),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    client
      .listFriends()
      .then((list) => {
        if (active) setOnlineFriends(list.filter((person) => person.online).slice(0, 6));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  async function followSuggestedPage(page: Page) {
    try {
      await client.followPage(page.id);
      setPageSuggestions((prev) => prev.filter((entry) => entry.id !== page.id));
    } catch {
      // ignore
    }
  }

  async function respondRequest(id: string, action: "accept" | "decline") {
    try {
      await client.respondFriendRequest(id, action);
      setRequests((prev) => prev.filter((entry) => entry.id !== id));
    } catch {
      // Leave the row so the user can retry.
    }
  }

  return (
    <>
      {requests.length > 0 && (
        <div className="feed-rail-section">
          <div className="feed-rail-head">
            <UserPlusIcon size={15} /> Friend requests
          </div>
          <ul className="feed-rail-people">
            {requests.map((entry) => (
              <li key={entry.id} className="feed-rail-person">
                <Avatar emoji={entry.person.avatarEmoji} name={entry.person.displayName} size={36} />
                <div className="feed-rail-person-meta">
                  <span className="feed-rail-person-name">
                    {entry.person.displayName ||
                      (entry.person.handle ? `@${entry.person.handle}` : "Someone")}
                  </span>
                  <span className="feed-rail-person-sub">
                    {entry.person.handle ? `@${entry.person.handle}` : "New here"}
                  </span>
                </div>
                <div className="feed-rail-request-actions">
                  <button
                    type="button"
                    className="feed-follow-btn"
                    onClick={() => void respondRequest(entry.id, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="feed-follow-btn"
                    onClick={() => void respondRequest(entry.id, "decline")}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {onlineFriends.length > 0 && (
        <div className="feed-rail-section">
          <div className="feed-rail-head">
            <UsersIcon size={15} /> Online now
          </div>
          <ul className="feed-rail-people">
            {onlineFriends.map((person) => (
              <li key={person.id} className="feed-rail-person">
                <span className="feed-rail-online-wrap">
                  <Avatar emoji={person.avatarEmoji} name={person.displayName} size={36} />
                  <span className="feed-rail-online-dot" aria-hidden="true" />
                </span>
                <div className="feed-rail-person-meta">
                  <span className="feed-rail-person-name">
                    {person.displayName || (person.handle ? `@${person.handle}` : "Someone")}
                  </span>
                  <span className="feed-rail-person-sub">
                    {person.handle ? `@${person.handle}` : "Online"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {groups.length > 0 && (
        <div className="feed-rail-section">
          <div className="feed-rail-head">
            <SparkIcon size={15} /> Your Groups
          </div>
          <ul className="feed-rail-people">
            {groups.map((group) => (
              <li key={group.id} className="feed-rail-person">
                <Avatar emoji={group.avatarEmoji} name={group.name} size={36} />
                <div className="feed-rail-person-meta">
                  <span className="feed-rail-person-name">{group.name}</span>
                  <span className="feed-rail-person-sub">
                    {group.members} member{group.members === 1 ? "" : "s"}
                  </span>
                </div>
                {onOpenGroup && (
                  <button type="button" className="feed-follow-btn" onClick={() => onOpenGroup(group.handle)}>
                    View
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {albums.length > 0 && (
        <div className="feed-rail-section">
          <div className="feed-rail-head">📷 Your Albums</div>
          <ul className="feed-rail-people">
            {albums.map((entry) => (
              <li key={entry.name} className="feed-rail-person">
                <div className="feed-rail-person-meta">
                  <span className="feed-rail-person-name">{entry.name}</span>
                  <span className="feed-rail-person-sub">
                    {entry.count} photo{entry.count === 1 ? "" : "s"}
                  </span>
                </div>
                {onOpenAlbum && (
                  <button type="button" className="feed-follow-btn" onClick={() => onOpenAlbum(entry.name)}>
                    View
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pageSuggestions.length > 0 && (
        <div className="feed-rail-section">
          <div className="feed-rail-head">
            <SparkIcon size={15} /> Pages to follow
          </div>
          <ul className="feed-rail-people">
            {pageSuggestions.map((page) => (
              <li key={page.id} className="feed-rail-person">
                <Avatar emoji={page.avatarEmoji} name={page.name} size={36} />
                <div className="feed-rail-person-meta">
                  <span className="feed-rail-person-name">{page.name}</span>
                  <span className="feed-rail-person-sub">@{page.handle}</span>
                </div>
                <button
                  type="button"
                  className="feed-follow-btn"
                  onClick={() => void followSuggestedPage(page)}
                >
                  Follow
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pages.length > 0 && (
        <div className="feed-rail-section">
          <div className="feed-rail-head">
            <SparkIcon size={15} /> Your Pages
          </div>
          <ul className="feed-rail-people">
            {pages.map((page) => (
              <li key={page.id} className="feed-rail-person">
                <Avatar emoji={page.avatarEmoji} name={page.name} size={36} />
                <div className="feed-rail-person-meta">
                  <span className="feed-rail-person-name">{page.name}</span>
                  <span className="feed-rail-person-sub">
                    @{page.handle} · {page.followers} follower{page.followers === 1 ? "" : "s"}
                  </span>
                </div>
                {onOpenPage && (
                  <button type="button" className="feed-follow-btn" onClick={() => onOpenPage(page.handle)}>
                    View
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="feed-rail-section">
        <div className="feed-rail-head">
          <SparkIcon size={15} /> Who to follow
        </div>
        {people === null ? (
          <div className="feed-state">Loading…</div>
        ) : people.length === 0 ? (
          <div className="feed-state">No suggestions right now.</div>
        ) : (
          <ul className="feed-rail-people">
            {people.map((person) => {
              const sent = requested[person.id] === true;
              return (
                <li key={person.id} className="feed-rail-person">
                  <Avatar emoji={person.avatarEmoji} name={person.displayName} size={36} />
                  <div className="feed-rail-person-meta">
                    <span className="feed-rail-person-name">
                      {person.displayName || (person.handle ? `@${person.handle}` : "Someone")}
                    </span>
                    <span className="feed-rail-person-sub">
                      {person.handle ? `@${person.handle}` : "New here"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`feed-follow-btn${sent ? " following" : ""}`}
                    disabled={sent || busy === person.id}
                    onClick={() => void follow(person)}
                  >
                    {sent ? "Requested" : busy === person.id ? "…" : "Follow"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {trending.length > 0 && (
        <div className="feed-rail-section">
          <div className="feed-rail-head">Top posts</div>
          <ul className="feed-rail-trending">
            {trending.map((post) => (
              <li key={post.id} className="feed-rail-trend">
                <span className="feed-rail-trend-tag">{authorName(post.author)}</span>
                <span className="feed-rail-trend-meta">{(post.body || "(photo)").slice(0, 80)}</span>
                <span className="feed-rail-trend-meta">
                  👍 {post.likes} · 💬 {post.comments} · ↗ {post.shares}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocked.length > 0 && (
        <div className="feed-rail-section">
          <div className="feed-rail-head">Blocked</div>
          <ul className="feed-rail-people">
            {blocked.map((person) => (
              <li key={person.id} className="feed-rail-person">
                <Avatar emoji={person.avatarEmoji} name={person.displayName} size={36} />
                <div className="feed-rail-person-meta">
                  <span className="feed-rail-person-name">
                    {person.displayName || (person.handle ? `@${person.handle}` : "Blocked user")}
                  </span>
                  <span className="feed-rail-person-sub">
                    {person.handle ? `@${person.handle}` : "Blocked"}
                  </span>
                </div>
                <button type="button" className="feed-follow-btn" onClick={() => void unblock(person)}>
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
