import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { BotifyrClient, FeedComment, FeedPost, Page, Person } from "@botifyr/client";
import { CameraIcon, ForwardIcon, MessageIcon, SendIcon, SmileyIcon, SparkIcon } from "./Icons";

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

function CommentRow({ comment, onReply }: { comment: FeedComment; onReply?: () => void }) {
  return (
    <div className="feed-comment">
      <Avatar emoji={authorEmoji(comment.author)} name={authorName(comment.author)} size={30} />
      <div className="feed-comment-main">
        <span className="feed-comment-head">
          {authorName(comment.author)}
          <span className="feed-comment-when">{relativeTime(comment.createdAt)}</span>
        </span>
        <span className="feed-comment-body">{comment.body}</span>
        {onReply && (
          <button type="button" className="feed-comment-reply-btn" onClick={onReply}>
            Reply
          </button>
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
}: PostCardProps) {
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);

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

      {post.repostOf && <div className="feed-repost-label">🔁 Shared a post</div>}
      {post.body && <p className="feed-body">{post.body}</p>}

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
      ) : post.imageUrl ? (
        <img className="feed-image-img" src={`${cloudUrl}${post.imageUrl}`} alt="Post attachment" loading="lazy" />
      ) : post.mediaId ? (
        <div className="feed-image feed-image-placeholder">📷 Image</div>
      ) : null}

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
                <CommentRow comment={comment} onReply={() => setReplyTo(comment.id)} />
                {(comments ?? [])
                  .filter((reply) => reply.parentId === comment.id)
                  .map((reply) => (
                    <div key={reply.id} className="feed-comment-reply">
                      <CommentRow comment={reply} />
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
              canDelete={canManage === true || (!post.pageId && post.author.id === viewerId)}
              onChange={updatePost}
              onDelete={removePost}
              onBlock={(authorId) => setPosts((prev) => prev.filter((p) => p.author.id !== authorId))}
              onOpenPage={onOpenPage}
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
}: {
  client: BotifyrClient;
  viewerId?: string;
  cloudUrl: string;
  /** Bumped by the host on feed events; reloads the top of the feed. */
  refreshKey?: number;
  /** When set, show this Page's timeline instead of the feed. */
  pageHandle?: string | null;
  onOpenPage?: (handle: string | null) => void;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [attachment, setAttachment] = useState<{ name: string; mime: string; data: string } | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [postAs, setPostAs] = useState("");
  const [creatingPage, setCreatingPage] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  function pickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Only image files can be attached");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Image is too large (max 12MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === "string" ? reader.result : "";
      if (data) setAttachment({ name: file.name, mime: file.type, data });
    };
    reader.readAsDataURL(file);
  }

  const load = useCallback(
    async (mode: "reset" | "more") => {
      if (mode === "reset") setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const page = await client.listFeed(mode === "reset" ? undefined : (cursor ?? undefined), 20);
        setPosts((prev) => (mode === "reset" ? page.items : [...prev, ...page.items]));
        setCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load the feed");
      } finally {
        if (mode === "reset") setLoading(false);
        else setLoadingMore(false);
      }
    },
    [client, cursor],
  );

  useEffect(() => {
    // Load on mount and whenever the host signals a feed event (realtime).
    // "load more" is user-driven.
    void load("reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, refreshKey]);

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
    if ((!body && !attachment) || posting) return;
    setPosting(true);
    setError(null);
    try {
      let mediaId: string | undefined;
      if (attachment) {
        const media = await client.uploadFile({ name: attachment.name, mime: attachment.mime, data: attachment.data });
        mediaId = media.id;
      }
      const post = await client.createPost({ body, mediaId, pageId: postAs || undefined });
      setPosts((prev) => [post, ...prev]);
      setDraft("");
      setAttachment(null);
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
        <span className="feed-topbar-sub">From you and your friends</span>
      </div>

      <div className="feed-scroll">
        <form className="feed-composer" onSubmit={publish}>
          <div className="feed-composer-row">
            <Avatar name="You" />
            <textarea
              className="feed-composer-input"
              placeholder="Share an update…"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          {attachment && (
            <div className="feed-composer-preview">
              <img src={attachment.data} alt="Attachment preview" />
              <button
                type="button"
                className="feed-attachment-remove"
                onClick={() => setAttachment(null)}
                aria-label="Remove image"
              >
                ✕
              </button>
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
            <button className="feed-post-btn" type="submit" disabled={(!draft.trim() && !attachment) || posting}>
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={pickImage} />
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
    </div>
  );
}

export function FeedRail({
  client,
  onOpenPage,
}: {
  client: BotifyrClient;
  onOpenPage?: (handle: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [blocked, setBlocked] = useState<Person[]>([]);
  const [trending, setTrending] = useState<FeedPost[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
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

  return (
    <>
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
