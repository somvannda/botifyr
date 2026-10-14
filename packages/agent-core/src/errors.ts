/**
 * Turn raw model/provider failures into short, user-safe messages.
 *
 * Provider errors arrive as JSON bodies like
 * `model request failed (402): {"error":{"message":"Insufficient Balance",...}}`.
 * Showing that verbatim to end users is confusing and leaks provider internals,
 * so we classify the failure and return a plain sentence. The raw detail stays
 * available to operators via the server log (see `runAgent`).
 */

export type ModelErrorKind =
  | "credit"
  | "auth"
  | "rate_limit"
  | "unavailable"
  | "network"
  | "bad_request"
  | "unknown";

export interface ModelErrorInfo {
  kind: ModelErrorKind;
  /** A complete, user-safe sentence explaining what happened and what to do. */
  message: string;
}

const MESSAGES: Record<ModelErrorKind, string> = {
  credit:
    "The AI account is out of credit. Add your own API key in Settings → AI, or top up the balance, then try again.",
  auth: "The AI provider rejected the API key. Check or replace the key in Settings → AI, then try again.",
  rate_limit: "The AI provider is rate-limiting requests right now. Please try again in a moment.",
  unavailable: "The AI provider is temporarily unavailable. Please try again in a few minutes.",
  network: "Couldn't reach the AI provider. Check your connection and try again.",
  bad_request: "The AI provider rejected the request. Check the provider and model in Settings → AI, then try again.",
  unknown: "The AI task couldn't be completed right now. Please try again.",
};

function statusOf(text: string): number | undefined {
  const match = /(?:^|\D)(\d{3})(?:\D|$)/.exec(text);
  if (!match) return undefined;
  const code = Number(match[1]);
  return code >= 400 && code <= 599 ? code : undefined;
}

/** Classify a raw provider/network error into a user-safe category. */
export function classifyModelError(error: unknown): ModelErrorKind {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const status = statusOf(text);
  const lower = text.toLowerCase();

  if (
    status === 402 ||
    /insufficient[\s_-]*(balance|quota|credit)|out of credit|payment required|billing|exceeded your current quota/.test(
      lower,
    )
  ) {
    return "credit";
  }
  if (
    status === 401 ||
    status === 403 ||
    /invalid api key|incorrect api key|unauthorized|authentication|permission denied/.test(lower)
  ) {
    return "auth";
  }
  if (status === 429 || /rate limit|too many requests|overloaded|temporarily limited/.test(lower)) {
    return "rate_limit";
  }
  if (
    (status !== undefined && status >= 500) ||
    /bad gateway|service unavailable|server error|upstream error|internal error/.test(lower)
  ) {
    return "unavailable";
  }
  if (
    /fetch failed|network|econnrefused|econnreset|enotfound|getaddrinfo|socket hang up|timed? ?out|aborted/.test(lower)
  ) {
    return "network";
  }
  if (status === 400 || status === 404 || status === 422 || /invalid_request_error|bad request/.test(lower)) {
    return "bad_request";
  }
  return "unknown";
}

/** A user-safe message for a raw provider/network error. */
export function friendlyModelError(error: unknown): string {
  return MESSAGES[classifyModelError(error)];
}

/** Classification + user-safe message together. */
export function describeModelError(error: unknown): ModelErrorInfo {
  const kind = classifyModelError(error);
  return { kind, message: MESSAGES[kind] };
}
