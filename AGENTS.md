# AGENTS.md — working on Botifyr efficiently

Guidance for **AI coding agents** (and humans) editing this repo. The goal is to
keep development fast and cheap: **fewer tokens, fewer commands, fewer rebuilds**.

> This file is about the **development process**. It does **not** change the
> shipped product. Product runtime limits are separate — see
> [`docs/cost-controls.md`](docs/cost-controls.md).

## 1. Context discipline (the biggest saving)
- **Never re-read a file that is already in context.** Ask before re-reading.
- **Search before reading.** Use `grep`/`glob` to find the exact lines, then read
  only that range (`offset`/`limit`). Do not dump whole large files.
- Don't echo large outputs back into the conversation; rely on truncation and
  summarise in a line or two.
- Prefer **one targeted command** over several broad ones.

## 2. Commands
- Typecheck only what changed: `npm run typecheck -w @botifyr/<pkg>`.
- Run the full gate **once, at the end**: `npm run typecheck && npm run lint && npm test`.
- Docker: the cloud image **bakes the sources**, so a source change needs
  `docker compose up -d --build cloud`. Do **not** rebuild for frontend-only edits.
- Keep the dev server running and rely on HMR. Do **not** restart `tauri dev`
  for frontend-only changes.
- Avoid long foreground waits; use background commands and keep working.

## 3. Editing
- Make **surgical** edits (`edit`) instead of rewriting whole files.
- One concern at a time; batch related edits in a single step.
- After editing, verify with a targeted `grep`/HTTP fetch — don't re-print the file.

## 4. Verification that costs money
- `apps/cloud/scripts/verify-*.mjs` and any "send a message" test hit the **real
  model** and spend credit. Use them sparingly; prefer the **mock** provider or an
  HTTP check that doesn't call the model for logic-only changes.
- When you must call the model, ask a **short** prompt (e.g. "reply with ok").

## 5. Two separate cost concerns — do not conflate
| Concern | What it limits | Where |
| --- | --- | --- |
| **Product runtime** | End-user model spend when the app runs tasks | `apps/cloud`, `packages/agent-core` → [`docs/cost-controls.md`](docs/cost-controls.md) |
| **Development** (this file) | The coding agent's tokens/commands while editing | how you work, above |

Changing `BOTIFYR_*` limits changes the **product**, not the coding agent. Don't
add runtime-limit code to solve a development-cost problem, and vice-versa.

## 6. Development keys & model
- Use a **separate API key for development** than for the product, so each side's
  spend is visible independently (the product uses `BOTIFYR_API_KEY`; the coding
  agent has its own provider key).
- Prefer the **cheapest model** that can do the job — for both the product default
  and the coding agent.
- Keep prompts short; avoid sending large diffs or files when a summary will do.
