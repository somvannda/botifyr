# Cost controls (product runtime)

These limit how many model tokens **Botifyr itself** spends when it runs agent
tasks. They are part of the **shipped product**, not the development process
(see [`../AGENTS.md`](../AGENTS.md) for the development-cost guidance).

## Where it is enforced
| File | Responsibility |
| --- | --- |
| `packages/agent-core/src/providers/openai.ts` | Sends `max_tokens`; reports token usage (non-stream and streamed via `include_usage`). |
| `packages/agent-core/src/agent.ts` | Aggregates usage across all model calls in a run. |
| `apps/cloud/src/runner.ts` | Caps output tokens; records usage per task. |
| `apps/cloud/src/server.ts` | Per-user rate limit; daily-budget **warning**; history trimming; exposes `limits` + `usage` on `/v1/config`. |
| `apps/cloud/src/store/{types,memory,postgres}.ts` + `schema.ts` | `usage_events` table and `usageSince()` totals. |

## Environment variables
| Variable | Default | Effect |
| --- | --- | --- |
| `BOTIFYR_MAX_OUTPUT_TOKENS` | `1024` | Hard cap on output tokens **per model call**. |
| `BOTIFYR_MAX_HISTORY_TURNS` | `12` | Max past turns sent as context. |
| `BOTIFYR_MAX_MESSAGE_CHARS` | `4000` | Max characters per user message and per history turn. |
| `BOTIFYR_RATE_LIMIT_PER_HOUR` | `60` | Per-user sliding window. `0` disables. Exceeded → **HTTP 429**. |
| `BOTIFYR_DAILY_TOKEN_BUDGET` | `200000` | Per-user daily budget. Exceeded → **warning only** by default; see `BOTIFYR_ENFORCE_BUDGET`. `0` disables. |
| `BOTIFYR_ENFORCE_BUDGET` | `0` | `1` makes the daily budget a **hard cap**: over-budget users get **HTTP 429** on send / retry / create-task. |
| `BOTIFYR_CACHE_TTL_SECONDS` | `300` | Exact-match **response cache**. A hit costs **zero tokens**. `0` disables. |
| `BOTIFYR_SUMMARY` | `1` | Compress older turns into a **rolling summary** instead of dropping them. `0` disables. |
| `BOTIFYR_SUMMARY_MAX_TOKENS` | `300` | Output cap for the summarization call (cheap, runs rarely). |

## Behaviour
- **Rate limit** → `429 Too Many Requests`.
- **Daily budget** → non-blocking by default: the API returns a `warning` field
  and the app shows an amber notice. With `BOTIFYR_ENFORCE_BUDGET=1` it becomes a
  hard cap and over-budget requests return **HTTP 429** instead.
- **Usage** is visible in the app: **Settings → Usage today** (tokens / requests / budget).
- **Provider timeouts**: streaming reads are chunked; a slow provider yields a clean error.

## Notes / possible future work
- The rate limiter is **in-process** (`Map`) — correct for a single cloud instance.
  Running multiple instances would need a **shared** store (Redis/Postgres) so the
  limit is global. This is a scaling concern, not needed now.
- The **response cache** is exact-match (hash of provider + messages + tools +
  maxTokens) and in-process; cache hits are returned with zero usage so they are
  never counted as spend. A shared cache (Redis/Postgres) would improve the hit
  rate across instances.
- **History summarization**: the last N turns are sent verbatim and everything
  older is folded into a rolling summary (stored on the session, updated only
  when the window advances), so long conversations keep their memory without
  resending the whole transcript.
