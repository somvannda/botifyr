import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { BotifyrClient, FeedComment, FeedPost, Group, Page, Person, Story } from "@botifyr/client";
import { CameraIcon, ChartIcon, ForwardIcon, MessageIcon, SendIcon, SmileyIcon, SparkIcon } from "./Icons";

/**
 * Feed — the social wall / timeline (see docs/feed.md).
 *
 * Backed by the cloud API: `client.listFeed`, `createPost`, `likePost`,
 * `sharePost`, `listComments`, `addComment`, and `deletePost`. Visibility is
 * friends-only, enforced server-side.
 */

function authorName(author: { displayName?: string; handle?: string }): string {
  return author.displayName?.trim() || (author.handle ? `@${author.handle}` : "Someone");
}

function authorEmoji(author: { avatarEmoji?: string }): string {
  return author.avatarEmoji?.trim() || "🙂";
}

/** "3m", "2h", "5d", or a date — from an ISO timestamp. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
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

function Avatar({ emoji, name, size = 40 }: { emoji?: string; name?: string; size?: number }) {
  const glyph = emoji?.trim() || name?.trim().charAt(0).toUpperCase() || "🙂";
  return (
    <span
      className="feed-avatar"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      title={name}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}

function AuthorLine({ author, when }: { author: FeedPost["author"]; when: string }) {
  return (
    <div className="feed-author">
      <Avatar emoji={authorEmoji(author)} name={authorName(author)} />
      <div className="feed-author-meta">
        <span className="feed-author-name">{authorName(author)}</span>
        <span className="feed-author-sub">
          {author.handle ? `@${author.handle} · ` : ""}
          {relativeTime(when)}
        </span>
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  client,
  onChange,
  onReply,
}: {
  comment: FeedComment;
  client: BotifyrClient;
  onChange?: (next: FeedComment) => void;
  onReply?: () => void;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  const total = Object.values(comment.reactions ?? {}).reduce((sum, count) => sum + count, 0);

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
      <Avatar emoji={authorEmoji(comment.author)} name={authorName(comment.author)} size={30} />
      <div className="feed-comment-main">
        <span className="feed-comment-head">
          {authorName(comment.author)}
          <span className="feed-comment-when">{relativeTime(comment.createdAt)}</span>
        </span>
        <span className="feed-comment-body">{comment.body}</span>
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
    </div>
  );
}

interface PostCardProps {
  post: FeedPost;
  client: BotifyrClient;
  cloudUrl: string;
  canDelete: boolean;
  onChange: (next: FeedPost) => void;
  onDelete: (id: string) => void;
  onBlock: (authorId: string) => void;
  onOpenPage?: (handle: string) => void;
  onRepost: (post: FeedPost) => void;
  onOpenTag?: (tag: string) => void;
}

function PostCard({
  post,
  client,
  cloudUrl,
  canDelete,
  onChange,
  onDelete,
  onBlock,
  onOpenPage,
  onRepost,
  onOpenTag,
}: PostCardProps) {
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const updateComment = (next: FeedComment) =>
    setComments((prev) => (prev ?? []).map((comment) => (comment.id === next.id ? next : comment)));

  async function react(reaction: string) {
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
    }
  }

  async function share() {
    try {
      const repost = await client.repost(post.id);
      onRepost(repost);
      onChange({ ...post, shares: post.shares + 1, sharedByMe: true });
    } catch {
      // Ignore a failed repost.
    }
  }

  async function vote(optionId: string) {
    if (!post.poll) return;
    try {
      await client.votePoll(post.id, optionId);
      const previous = post.poll.myVote;
      const options = post.poll.options.map((option) => ({
        ...option,
        votes: option.votes + (option.id === optionId ? 1 : 0) - (option.id === previous ? 1 : 0),
      }));
      const total = options.reduce((sum, option) => sum + option.votes, 0);
      onChange({ ...post, poll: { ...post.poll, options, total, myVote: optionId } });
    } catch {
      // Ignore a failed vote.
    }
  }

  async function toggleComments() {
    const open = !commentsOpen;
    setCommentsOpen(open);
    if (open && comments === null && !commentsLoading) {
      setCommentsLoading(true);
      try {
        setComments(await client.listComments(post.id));
      } catch {
        setComments([]);
      } finally {
        setCommentsLoading(false);
      }
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const comment = await client.addComment(post.id, body, replyTo ?? undefined);
      setComments((prev) => [...(prev ?? []), comment]);
      onChange({ ...post, comments: post.comments + 1 });
      setDraft("");
      setReplyTo(null);
    } catch {
      // Leave the draft so the user can retry.
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await client.deletePost(post.id);
      onDelete(post.id);
    } catch {
      // Ignore: the post stays in place if the server refused.
    }
  }

  async function report() {
    try {
      await client.reportPost(post.id);
    } catch {
      // Ignore: a failed report is silent.
    }
  }

  async function blockAuthor() {
    try {
      await client.blockUser(post.author.id);
      onBlock(post.author.id);
    } catch {
      // Ignore: leave the post if the server refused.
    }
  }

  return (
    <article className="feed-post">
      <AuthorLine author={post.author} when={post.createdAt} />

      {post.audience === "only_me" && <div className="feed-audience-badge">🔒 Only me</div>}
      {post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now() && (
        <div className="feed-audience-badge">🕒 Scheduled</div>
      )}
      {post.repostOf && <div className="feed-repost-label">🔁 Shared a post</div>}
      {post.body && <p className="feed-body">{post.body}</p>}

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
          <AuthorLine author={post.original.author} when={post.original.createdAt} />
          {post.original.body && <p className="feed-body">{post.original.body}</p>}
          {post.original.imageUrl && (
            <img
              className="feed-image-img"
              src={`${cloudUrl}${post.original.imageUrl}`}
              alt="Post attachment"
              loading="lazy"
            />
          )}
        </div>
      ) : post.videos && post.videos.length > 0 ? (
        <div className="feed-videos">
          {post.videos.map((src) => (
            <video key={src} className="feed-video" src={`${cloudUrl}${src}`} controls preload="metadata" />
          ))}
        </div>
      ) : post.images && post.images.length > 1 ? (
        <div className={`feed-image-grid feed-image-grid-${Math.min(post.images.length, 4)}`}>
          {post.images.map((src) => (
            <img key={src} className="feed-image-img" src={`${cloudUrl}${src}`} alt="Post attachment" loading="lazy" />
          ))}
        </div>
      ) : post.imageUrl ? (
        <img className="feed-image-img" src={`${cloudUrl}${post.imageUrl}`} alt="Post attachment" loading="lazy" />
      ) : post.mediaId ? (
        <div className="feed-image feed-image-placeholder">📷 Image</div>
      ) : null}

      {post.poll && (
        <div className="feed-poll">
          {post.poll.options.map((option) => {
            const pct = post.poll && post.poll.total > 0 ? Math.round((option.votes / post.poll.total) * 100) : 0;
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
          <span>
            {reactionEmoji(Object.entries(post.reactions ?? {}).find(([, count]) => count > 0)?.[0])} {post.likes}
          </span>
        )}
        <span className="feed-stats-spacer" />
        {post.comments > 0 && (
          <button type="button" className="feed-stats-btn" onClick={() => void toggleComments()}>
            {post.comments} comment{post.comments === 1 ? "" : "s"}
          </button>
        )}
        {post.shares > 0 && <span>{post.shares} share{post.shares === 1 ? "" : "s"}</span>}
      </div>

      {pickOpen && (
        <div className="reaction-picker">
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
          type="button"
          className={`feed-action${post.myReaction ? " active" : ""}`}
          onClick={() => setPickOpen((value) => !value)}
          aria-pressed={post.myReaction !== null}
        >
          {post.myReaction ? (
            <span className="feed-action-emoji">{reactionEmoji(post.myReaction)}</span>
          ) : (
            <HeartIcon size={17} />
          )}
          {post.myReaction ? (REACTIONS.find((entry) => entry.key === post.myReaction)?.label ?? "Like") : "Like"}
        </button>
        <button type="button" className="feed-action" onClick={() => void toggleComments()} aria-expanded={commentsOpen}>
          <MessageIcon size={17} /> Comment
        </button>
        <button type="button" className="feed-action" onClick={() => void share()} aria-pressed={post.sharedByMe}>
          <ForwardIcon size={17} /> Share
        </button>
        {post.author.page && post.author.handle && onOpenPage && (
          <button type="button" className="feed-action" onClick={() => onOpenPage(post.author.handle as string)}>
            View page
          </button>
        )}
        {canDelete && (
          <button type="button" className="feed-action feed-action-danger" onClick={() => void remove()}>
            Delete
          </button>
        )}
        {!canDelete && (
          <>
            <button type="button" className="feed-action" onClick={() => void report()}>
              Report
            </button>
            <button type="button" className="feed-action feed-action-danger" onClick={() => void blockAuthor()}>
              Block
            </button>
          </>
        )}
      </div>

      {commentsOpen && (
        <div className="feed-comments">
          {commentsLoading && <div className="feed-state">Loading comments…</div>}
          {(comments ?? [])
            .filter((comment) => !comment.parentId)
            .map((comment) => (
              <div key={comment.id} className="feed-comment-thread">
                <CommentRow
                  comment={comment}
                  client={client}
                  onChange={updateComment}
                  onReply={() => setReplyTo(comment.id)}
                />
                {(comments ?? [])
                  .filter((reply) => reply.parentId === comment.id)
                  .map((reply) => (
                    <div key={reply.id} className="feed-comment-reply">
                      <CommentRow comment={reply} client={client} onChange={updateComment} />
                    </div>
                  ))}
              </div>
            ))}
          {replyTo && (
            <div className="feed-comment-replying">
              <span>Replying to a comment</span>
              <button type="button" className="ghost small" onClick={() => setReplyTo(null)}>
                Cancel
              </button>
            </div>
          )}
          <form className="feed-comment-form" onSubmit={addComment}>
            <input
              className="feed-comment-input"
              placeholder={replyTo ? "Write a reply…" : "Write a comment…"}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="feed-comment-send" type="submit" disabled={!draft.trim() || busy} aria-label="Send comment">
              <SendIcon size={15} />
            </button>
          </form>
        </div>
      )}
    </article>
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
  const [form, setForm] = useState({ name: "", handle: "", category: "", about: "", cta: "", avatarEmoji: "" });
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<Array<{ userId: string; role: string; person: Person | null }>>([]);
  const [roleQuery, setRoleQuery] = useState("");
  const [roleResults, setRoleResults] = useState<Person[]>([]);
  const [insights, setInsights] = useState<Awaited<ReturnType<BotifyrClient["pageInsights"]>> | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [inbox, setInbox] = useState<Awaited<ReturnType<BotifyrClient["pageInbox"]>> | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([client.getPage(handle), client.listPagePosts(handle)])
      .then(([record, list]) => {
        if (!active) return;
        setPage(record);
        setPosts(list);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, handle]);

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
      avatarEmoji: page.avatarEmoji ?? "",
    });
    setEditing(true);
  }

  async function pinPost(postId: string | null) {
    if (!page) return;
    try {
      await client.pinPagePost(page.id, postId);
      setPage({ ...page, pinnedPostId: postId ?? undefined });
      setPosts(await client.listPagePosts(handle));
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
      setRoles((prev) => [...prev.filter((entry) => entry.userId !== person.id), { userId: person.id, role, person }]);
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
    if (!page) return;
    setBusy(true);
    try {
      if (page.following) await client.unfollowPage(page.id);
      else await client.followPage(page.id);
      setPage({ ...page, following: !page.following, followers: page.followers + (page.following ? -1 : 1) });
    } catch {
      // Leave the state as-is on failure.
    } finally {
      setBusy(false);
    }
  }

  const canManage = page?.role === "admin" || page?.role === "editor";
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
        {page && (
          <div className="page-head">
            {page.coverUrl ? <img className="page-cover" src={page.coverUrl} alt="" /> : <div className="page-cover" />}
            <div className="page-head-body">
              <Avatar emoji={page.avatarEmoji} name={page.name} size={64} />
              <div className="page-head-meta">
                <div className="page-name">
                  {page.name}
                  {page.verified ? " ✓" : ""}
                </div>
                <div className="page-sub">
                  @{page.handle}
                  {page.category ? ` · ${page.category}` : ""} · {page.followers} follower
                  {page.followers === 1 ? "" : "s"}
                </div>
                {page.about && <p className="page-about">{page.about}</p>}
              </div>
              {canManage ? (
                <div className="page-head-actions">
                  <span className="feed-bot-badge">{page.role}</span>
                  <select
                    className="page-pin-select"
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
                  <button type="button" className="feed-follow-btn" onClick={() => void openInbox()}>
                    Community
                  </button>
                  <button type="button" className="feed-follow-btn" onClick={() => void openInsights()}>
                    Insights
                  </button>
                  <button type="button" className="feed-follow-btn" onClick={openSettings}>
                    Settings
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`feed-follow-btn${page.following ? " following" : ""}`}
                  disabled={busy}
                  onClick={() => void toggleFollow()}
                >
                  {page.following ? "Following" : "Follow"}
                </button>
              )}
            </div>
          </div>
        )}

        {editing && page && (
          <form className="page-settings" onSubmit={saveSettings}>
            <div className="feed-rail-head">Page settings</div>
            <label>
              Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              Handle
              <input value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value })} />
            </label>
            <label>
              Category
              <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
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
                      {entry.person?.displayName || (entry.person?.handle ? `@${entry.person.handle}` : entry.userId)}
                    </span>
                    <span className="feed-bot-badge">{entry.role}</span>
                    <button type="button" className="ghost small" onClick={() => void removeRole(entry.userId)}>
                      Remove
                    </button>
                  </div>
                ))}
                <div className="page-role-add">
                  <input
                    placeholder="Add by @handle"
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
                    {entry.author.displayName || (entry.author.handle ? `@${entry.author.handle}` : "Someone")}:{" "}
                    {entry.body}
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

        {loading ? (
          <div className="feed-state">Loading…</div>
        ) : posts.length === 0 ? (
          <div className="feed-state">No posts yet.</div>
        ) : (
          posts.map((post) => (
            <div key={post.id} className="feed-post-wrap">
              {page?.pinnedPostId === post.id && <div className="feed-repost-label">📌 Pinned</div>}
              <PostCard
                post={post}
                client={client}
                cloudUrl={cloudUrl}
                canDelete={canManage === true || (!post.pageId && post.author.id === viewerId)}
                onChange={updatePost}
                onDelete={removePost}
                onBlock={(authorId) => setPosts((prev) => prev.filter((p) => p.author.id !== authorId))}
                onOpenPage={onOpenPage}
                onRepost={(next) => setPosts((prev) => [next, ...prev])}
              />
            </div>
          ))
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
              onChange={updatePost}
              onDelete={removePost}
              onBlock={(authorId) => setPosts((prev) => prev.filter((p) => p.author.id !== authorId))}
              onRepost={(next) => setPosts((prev) => [next, ...prev])}
              onOpenTag={onOpenTag}
            />
          ))
        )}
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
}: {
  client: BotifyrClient;
  cloudUrl: string;
  viewerId?: string;
  handle: string;
  onBack: () => void;
}) {
  const [group, setGroup] = useState<Group | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([client.getGroup(handle), client.groupPosts(handle)])
      .then(([record, list]) => {
        if (!active) return;
        setGroup(record);
        setPosts(list);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, handle]);

  async function toggleJoin() {
    if (!group) return;
    try {
      if (group.joined) await client.leaveGroup(group.id);
      else await client.joinGroup(group.id);
      setGroup({ ...group, joined: !group.joined, members: group.members + (group.joined ? -1 : 1) });
    } catch {
      // ignore
    }
  }

  async function post(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !group || busy) return;
    setBusy(true);
    try {
      const created = await client.createPost({ body, groupId: group.id });
      setPosts((prev) => [created, ...prev]);
      setDraft("");
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  const updatePost = (next: FeedPost) => setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));

  return (
    <div className="feed">
      <div className="feed-topbar">
        <button type="button" className="ghost small" onClick={onBack}>
          ← Back
        </button>
        <span className="feed-topbar-title">{group?.name ?? "Group"}</span>
      </div>
      <div className="feed-scroll">
        {group && (
          <div className="page-head">
            <div className="page-head-body">
              <Avatar emoji={group.avatarEmoji} name={group.name} size={64} />
              <div className="page-head-meta">
                <div className="page-name">{group.name}</div>
                <div className="page-sub">
                  @{group.handle} · {group.members} member{group.members === 1 ? "" : "s"}
                </div>
                {group.about && <p className="page-about">{group.about}</p>}
              </div>
              <button
                type="button"
                className={`feed-follow-btn${group.joined ? " following" : ""}`}
                onClick={() => void toggleJoin()}
              >
                {group.joined ? "Leave" : "Join"}
              </button>
            </div>
          </div>
        )}

        {group?.joined && (
          <form className="feed-composer" onSubmit={post}>
            <div className="feed-composer-row">
              <Avatar name="You" />
              <textarea
                className="feed-composer-input"
                placeholder={`Post in ${group.name}…`}
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </div>
            <div className="feed-composer-actions">
              <button className="feed-post-btn" type="submit" disabled={!draft.trim() || busy}>
                {busy ? "Posting…" : "Post"}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="feed-state">Loading…</div>
        ) : posts.length === 0 ? (
          <div className="feed-state">No posts yet.</div>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              client={client}
              cloudUrl={cloudUrl}
              canDelete={!post.pageId && post.author.id === viewerId}
              onChange={updatePost}
              onDelete={removePost}
              onBlock={(authorId) => setPosts((prev) => prev.filter((p) => p.author.id !== authorId))}
              onRepost={(next) => setPosts((prev) => [next, ...prev])}
            />
          ))
        )}
      </div>
    </div>
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
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; mime: string; data: string }>>([]);
  const [audience, setAudience] = useState<"public" | "friends" | "only_me">("friends");
  const [scheduledAt, setScheduledAt] = useState("");
  const [pollOpen, setPollOpen] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [tab, setTab] = useState<"all" | "friends" | "pages">("all");
  const [sort, setSort] = useState<"recent" | "top">("recent");
  const [openTag, setOpenTag] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [postAs, setPostAs] = useState("");
  const [creatingPage, setCreatingPage] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [mentionResults, setMentionResults] = useState<Person[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [storyView, setStoryView] = useState<Story | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const storyRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  /** As the user types `@name`, offer people to insert. */
  async function updateMentions(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setDraft(value);
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

  function pickImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      if (!file.type.startsWith("image/") && !isVideo) {
        setError("Only image or video files can be attached");
        continue;
      }
      if (file.size > (isVideo ? 25 : 12) * 1024 * 1024) {
        setError(`File is too large (max ${isVideo ? 25 : 12}MB)`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const data = typeof reader.result === "string" ? reader.result : "";
        if (data) {
          setAttachments((prev) => (prev.length >= 4 ? prev : [...prev, { name: file.name, mime: file.type, data }]));
        }
      };
      reader.readAsDataURL(file);
    }
  }

  const load = useCallback(
    async (mode: "reset" | "more") => {
      if (mode === "reset") setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const page = await client.listFeed(mode === "reset" ? undefined : (cursor ?? undefined), 20, { tab, sort });
        setPosts((prev) => (mode === "reset" ? page.items : [...prev, ...page.items]));
        setCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load the feed");
      } finally {
        if (mode === "reset") setLoading(false);
        else setLoadingMore(false);
      }
    },
    [client, cursor, tab, sort],
  );

  useEffect(() => {
    // Load on mount, on tab/sort change, and whenever the host signals a feed
    // event (realtime). "load more" is user-driven.
    void load("reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, refreshKey, tab, sort]);

  useEffect(() => {
    let active = true;
    client
      .listStories()
      .then((list) => {
        if (active) setStories(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

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
      setStories(await client.listStories());
    } catch {
      // Ignore a failed story.
    }
  }

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
    setPosting(true);
    setError(null);
    try {
      const mediaIds: string[] = [];
      for (const file of attachments) {
        const media = await client.uploadFile({ name: file.name, mime: file.mime, data: file.data });
        mediaIds.push(media.id);
      }
      const poll = pollOptions.map((option) => option.trim()).filter(Boolean);
      const post = await client.createPost({
        body,
        mediaIds,
        pageId: postAs || undefined,
        audience,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        poll: pollOpen && poll.length >= 2 ? poll : undefined,
      });
      setPosts((prev) => [post, ...prev]);
      setDraft("");
      setAttachments([]);
      setScheduledAt("");
      setPollOpen(false);
      setPollOptions(["", ""]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that");
    } finally {
      setPosting(false);
    }
  }

  const updatePost = (next: FeedPost) => setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));
  /** A repost arrives as a new post at the top of the feed. */
  const prependPost = (next: FeedPost) => setPosts((prev) => [next, ...prev]);
  /** After blocking, drop that author's posts from the local feed. */
  const removeAuthorPosts = (authorId: string) =>
    setPosts((prev) => prev.filter((p) => p.author.id !== authorId));

  if (openTag) {
    return (
      <TagView
        client={client}
        cloudUrl={cloudUrl}
        viewerId={viewerId}
        tag={openTag}
        onBack={() => setOpenTag(null)}
        onOpenTag={(next) => setOpenTag(next)}
      />
    );
  }

  if (groupHandle) {
    return (
      <GroupView
        client={client}
        cloudUrl={cloudUrl}
        viewerId={viewerId}
        handle={groupHandle}
        onBack={() => onOpenGroup?.(null)}
      />
    );
  }

  if (pageHandle) {
    return (
      <PageView
        client={client}
        cloudUrl={cloudUrl}
        viewerId={viewerId}
        handle={pageHandle}
        onBack={() => onOpenPage?.(null)}
        onOpenPage={(next) => onOpenPage?.(next)}
      />
    );
  }

  return (
    <div className="feed">
      <div className="feed-topbar">
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
        <button
          type="button"
          className="feed-composer-tool"
          onClick={() => setSort((value) => (value === "top" ? "recent" : "top"))}
        >
          {sort === "top" ? "Top" : "Most recent"}
        </button>
      </div>

      <div className="feed-scroll">
        <div className="stories-strip">
          <button type="button" className="story-tile" onClick={() => storyRef.current?.click()}>
            <span className="story-avatar add">＋</span>
            <span className="story-name">Your story</span>
          </button>
          {stories.map((story) => (
            <button key={story.id} type="button" className="story-tile" onClick={() => setStoryView(story)}>
              <span className="story-avatar">
                {story.imageUrl ? <img src={`${cloudUrl}${story.imageUrl}`} alt="" /> : authorEmoji(story.author)}
              </span>
              <span className="story-name">{authorName(story.author)}</span>
            </button>
          ))}
          <input ref={storyRef} type="file" accept="image/*" style={{ display: "none" }} onChange={addStory} />
        </div>
        <form className="feed-composer" onSubmit={publish}>
          <div className="feed-composer-row">
            <Avatar name="You" />
            <textarea
              ref={composerRef}
              className="feed-composer-input"
              placeholder="Share an update…"
              rows={2}
              value={draft}
              onChange={(event) => void updateMentions(event)}
            />
          </div>
          {mentionResults.length > 0 && (
            <div className="mention-menu">
              {mentionResults.slice(0, 6).map((person) => (
                <button
                  key={person.id}
                  type="button"
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
            <div className="feed-composer-grid">
              {attachments.map((file, index) => (
                <div key={index} className="feed-composer-thumb">
                  {file.mime.startsWith("video/") ? (
                    <video src={file.data} muted preload="metadata" />
                  ) : (
                    <img src={file.data} alt="Attachment preview" />
                  )}
                  <button
                    type="button"
                    className="feed-attachment-remove"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="Remove image"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="feed-composer-as">
            <span>Post as</span>
            <select value={postAs} onChange={(event) => setPostAs(event.target.value)}>
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
          </div>
          <div className="feed-composer-as">
            <span>Audience</span>
            <select
              value={audience}
              onChange={(event) => setAudience(event.target.value as "public" | "friends" | "only_me")}
            >
              <option value="public">Public</option>
              <option value="friends">Friends</option>
              <option value="only_me">Only me</option>
            </select>
            <input
              type="datetime-local"
              className="feed-composer-as-input"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              title="Schedule for later"
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
                    setPollOptions((prev) => prev.map((value, i) => (i === index ? event.target.value : value)))
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
            </div>
          )}
          <div className="feed-composer-actions">
            <button type="button" className="feed-composer-tool" onClick={() => fileRef.current?.click()}>
              <CameraIcon size={16} /> Photo
            </button>
            <button
              type="button"
              className="feed-composer-tool"
              onClick={() => setDraft((value) => `${value}${value ? " " : ""}😀`)}
            >
              <SmileyIcon size={16} /> Mood
            </button>
            <button
              type="button"
              className={`feed-composer-tool${pollOpen ? " active" : ""}`}
              onClick={() => setPollOpen((value) => !value)}
            >
              <ChartIcon size={16} /> Poll
            </button>
            <button className="feed-post-btn" type="submit" disabled={(!draft.trim() && attachments.length === 0) || posting}>
              {posting ? "Saving…" : scheduledAt ? "Schedule" : "Post"}
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

        {error && <div className="feed-error">{error}</div>}

        {loading ? (
          <div className="feed-state">Loading the feed…</div>
        ) : posts.length === 0 ? (
          <div className="feed-state">No posts yet. Be the first to share something.</div>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              client={client}
              cloudUrl={cloudUrl}
              canDelete={!post.pageId && post.author.id === viewerId}
              onChange={updatePost}
              onDelete={removePost}
              onBlock={removeAuthorPosts}
              onOpenPage={onOpenPage}
              onRepost={prependPost}
              onOpenTag={setOpenTag}
            />
          ))
        )}

        {cursor && !loading && (
          <button
            type="button"
            className="feed-more"
            onClick={() => void load("more")}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </div>

      {storyView && (
        <div className="story-viewer" onClick={() => setStoryView(null)}>
          {storyView.imageUrl ? (
            <img src={`${cloudUrl}${storyView.imageUrl}`} alt="" />
          ) : (
            <div className="story-text">{storyView.caption}</div>
          )}
          {storyView.caption && storyView.imageUrl && <div className="story-caption">{storyView.caption}</div>}
          <button type="button" className="story-close" onClick={() => setStoryView(null)} aria-label="Close">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export function FeedRail({
  client,
  onOpenPage,
  onOpenGroup,
}: {
  client: BotifyrClient;
  onOpenPage?: (handle: string) => void;
  onOpenGroup?: (handle: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [blocked, setBlocked] = useState<Person[]>([]);
  const [trending, setTrending] = useState<FeedPost[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

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
  }, [client]);

  return (
    <>
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
                  <span className="feed-rail-person-sub">{person.handle ? `@${person.handle}` : "New here"}</span>
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
                  <span className="feed-rail-person-sub">{person.handle ? `@${person.handle}` : "Blocked"}</span>
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
