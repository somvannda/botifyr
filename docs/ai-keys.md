# Bring your own AI key

Users can run Botifyr on **their own model provider key** instead of the
platform account — any time, and automatically as a fallback once their plan's
included tokens are used up.

## What a user sees

- **Settings → AI provider**: pick a provider, paste a key, choose a model, and
  *Test connection*. The key is stored encrypted and never shown again.
- If the platform account is out of credit, the top banner offers a
  **"Add your own AI key"** shortcut to the same screen.
- On a free BYO policy, their runs use their provider bill, so they aren't metered
  against their plan tokens or company budget.

## How it works

- **Registry** — `packages/shared/src/aiProviders.ts`. A curated list of
  OpenAI-compatible providers (OpenAI, Anthropic, Google Gemini, OpenRouter,
  DeepSeek, Groq, Mistral, xAI, Together, Fireworks, Perplexity, Moonshot) plus
  keyless local servers (Ollama, LM Studio) and a `custom` entry for any other
  OpenAI-compatible endpoint. Adding a provider is data, not code.
- **Storage** — one encrypted vault secret per user (`BOTIFYR_AI_CONFIG`,
  AES-256-GCM via `apps/cloud/src/vault.ts`). No schema change; the key never
  leaves the server and is never returned by the API (only `hasKey` is).
- **Endpoints** — `GET/PUT/DELETE /v1/ai/provider`, `POST /v1/ai/provider/test`
  (`apps/cloud/src/server.ts`). The `test` call sends a one-word prompt and
  reports a friendly result.
- **Routing** — `apps/cloud/src/runner.ts` resolves the user's provider
  (`userProvider`) and uses it for their task, their rolling conversation
  summaries and per-chat translation; otherwise the platform provider.
- **Billing policy** — `PlatformSettings.byoKey.billing` (admin console):
  - `free` (default): BYO runs are **not** charged and their tokens are recorded
    with `source = "byo"`, excluded from plan quota and company/quest budgets.
  - `charge`: BYO runs are billed like any other (credits + quota).
- **Quota fallback** — `billingBlockReason` / `budgetBlocked` allow a run when
  the user has an enabled, usable own key and the policy is `free`, so hitting the
  plan limit no longer dead-ends them.

## Errors

Provider failures are turned into plain, user-safe sentences by
`packages/agent-core/src/errors.ts` (`describeModelError`) — e.g. a 402
"Insufficient Balance" becomes *"The AI account is out of credit. Add your own
API key in Settings → AI…"*. Raw provider payloads are logged server-side only.
