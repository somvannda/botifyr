# Cost controls (development)

These limit how many model tokens the **coding agent** spends while editing this
repo. They are part of the **development process**, not the shipped product
(see [`cost-controls.md`](cost-controls.md) for the product runtime guidance and
[`../AGENTS.md`](../AGENTS.md) §5 for the rule against conflating the two).

## Where it is enforced

| File | Responsibility |
| --- | --- |
| `opencode.jsonc` | Project config: `model`, `small_model`, `compaction`, `agents.build.steps`, provider `settings`. Overrides the global file. |
| `~/.config/opencode/opencode.jsonc` | Global fallback for every project. Same knobs; project values win. |
| `AGENTS.md` (§1–§4, §6) | The behavioural half of this ledger: context discipline, command discipline, surgical edits, cheap verification. |
| Provider (e.g. DeepSeek / OpenCode Go) | Billing, prompt-cache pricing, off-peak discounts, monthly allowance. |

## How the cost is computed

```text
cost ≈ (fresh input × in) + (cached input × ~0.02×in) + (output × ~4×in)
```

Two facts drive every lever below:

- **Output tokens cost ~4× input**, so reasoning/verbose generations are the
  expensive kind. Keep reasoning effort as low as the task allows.
- **Cached input is ~50× cheaper** than fresh input (DeepSeek V4.1 Flash:
  `$0.003` cached vs `$0.15` fresh). A **stable prompt prefix** is what earns the
  cache; rewriting context (compaction, editing instruction files mid-run)
  invalidates it.

Order of impact: **shrink context → stabilize the prefix for cache → cheap model
with low reasoning → cap output**.

## Settings

| Setting | Default in this repo | Effect |
| --- | --- | --- |
| `model` | `deepseek/deepseek-flash` | Default model. Keep it as the cheapest capable option. |
| `small_model` | `deepseek/deepseek-flash` | Model for lightweight helper tasks (titles, summaries). |
| `agents.build.steps` | `40` | Max model steps per Build request. On the last step tools are removed and a summary is forced, so too low a value stops features mid-way. New user input resets the allowance. |
| `compaction.auto` | `true` | Summarize older context near the model's limit so long sessions keep going. |
| `compaction.keep.tokens` | `12000` | Recent conversation kept beside the summary. Larger = more detail, less room, more cost. |
| `compaction.buffer` | `16000` | Tokens kept free below the limit; larger starts compaction earlier. |
| `providers.<id>.settings` | — | Provider controls: timeouts, and `compaction.type: "native"` for provider-side compaction. |
| reasoning variant | none | `provider/model#low` (or `#none`) for routine edits; reserve `#high`/`#max` for hard reasoning. Set on an agent or command model reference — the root `model` does not retain a `#variant`. |

> There is **no per-session token cap** in `opencode.jsonc`. `agents.build.steps`
> is the "allowance" that bounds a single run.

## Behaviour

- **Fresh session per feature.** Long sessions resend a growing transcript on
  every step; starting a new session per task resets context and cost.
- **Manual compaction** before the automatic one when context is large:

  ```sh
  opencode api post /api/session/ses_example/compact --data '{}'
  ```

- **Off-peak pricing.** DeepSeek is roughly half price off-peak. Peak is
  **01:00–04:00 and 06:00–10:00 UTC, Mon–Fri**; convert to your local zone
  (for UTC+7 that is 08:00–11:00 and 13:00–17:00). Schedule large agent runs
  outside those windows.
- **Verification spend** is governed by `AGENTS.md` §4: prefer the mock provider
  or a model-free HTTP check; when the real model is required, ask a short prompt.

## When the allowance runs out

The OpenCode Go **monthly usage limits are a subscription allowance, not a
config value** — they cannot be raised from `opencode.jsonc`. Options:

- Upgrade **Go → Go Plus** for higher per-model limits.
- Enable **Use balance** in the console to fall back to pay-as-you-go.
- Switch to a **free model** (Go lists a couple of free previews) for
  non-critical work.

## Notes / possible future work

- The `watcher.ignore` list in `opencode.jsonc` exists to avoid spurious
  rebuilds; it is a **speed** control, not a token control, but both matter for
  the "fewer tokens, fewer commands, fewer rebuilds" goal.
- Development and product spend should use **separate API keys** so each ledger
  is visible independently (`AGENTS.md` §6).
