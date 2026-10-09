/**
 * Small shared presentational helpers used across the Feed surfaces (timeline,
 * posts, Reels, Pages, Stories). Kept in one module so Stories can reuse them
 * without importing `FeedView` (which would create an import cycle).
 */

export function authorName(author: { displayName?: string; handle?: string }): string {
  return author.displayName?.trim() || (author.handle ? `@${author.handle}` : "Someone");
}

export function authorEmoji(author: { avatarEmoji?: string }): string {
  return author.avatarEmoji?.trim() || "🙂";
}

/** "3m", "2h", "5d", or a date — from an ISO timestamp. */
export function relativeTime(iso: string): string {
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

/** Resolve an author avatar path to a loadable URL (absolute URLs pass through). */
export function resolveAvatar(url: string | undefined, cloudUrl?: string): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  if (!cloudUrl) return undefined;
  return `${cloudUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function Avatar({
  emoji,
  name,
  url,
  size = 40,
}: {
  emoji?: string;
  name?: string;
  url?: string;
  size?: number;
}) {
  const glyph = emoji?.trim() || name?.trim().charAt(0).toUpperCase() || "🙂";
  if (url) {
    return (
      <img
        className="feed-avatar feed-avatar-photo"
        style={{ width: size, height: size }}
        src={url}
        alt={name ?? ""}
        loading="lazy"
      />
    );
  }
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
