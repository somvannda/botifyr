import { MemoryStore } from "./memory.js";
import { PostgresStore } from "./postgres.js";
import type { Store } from "./types.js";

export type { Store } from "./types.js";

/**
 * Choose a store from configuration. "memory" is the zero-setup default;
 * "postgres" (via DATABASE_URL) gives durable, multi-user persistence.
 */
export function createStore(): Store {
  const mode = (process.env.BOTIFYR_STORE ?? "memory").toLowerCase();
  if (mode === "postgres") {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("BOTIFYR_STORE=postgres requires DATABASE_URL to be set");
    return new PostgresStore(url);
  }
  return new MemoryStore();
}
