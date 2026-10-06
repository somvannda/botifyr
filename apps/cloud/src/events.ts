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
