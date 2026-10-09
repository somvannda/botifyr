import type { ServerEvent } from "@botifyr/shared";

/**
 * In-process publish/subscribe for realtime events. Not persisted; the cloud
 * keeps this in memory and fans out to connected websockets.
 */

type Listener = (event: ServerEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emit(event: ServerEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A dead websocket should never break the runner.
    }
  }
}

/**
 * The single user who should receive a feed realtime event, or `null` for
 * non-feed events. Feed interactions carry an explicit recipient; a new post
 * reaches its author (their other devices). See docs/feed-discovery-plan.md DB-1.
 */
export function feedEventRecipient(event: ServerEvent): string | null {
  switch (event.type) {
    case "feed.mention":
    case "feed.like":
    case "feed.comment":
    case "feed.share":
      return event.toUserId;
    case "feed.post":
      return event.authorId;
    default:
      return null;
  }
}
