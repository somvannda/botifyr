# Chat roadmap (features & improvements)

Backlog for the shared chat UI (`packages/ui/src/BotifyrApp.tsx`) and the
cloud endpoints it uses. Complements
[`docs/chat-attachments.md`](chat-attachments.md) (which covers what is already
shipped).

Status legend: ✅ done · 🚧 in progress · ⬜ not started

| # | Item | Type | Status |
| --- | --- | --- | --- |
| 1 | Model-status banner (credit/provider failures) | Improvement | ✅ |
| 2 | Chat search (across chats + within a chat) | Feature | ⬜ |
| 3 | Group management (rename, add/remove, leave) | Feature | ⬜ |
| 4 | Read receipts + message reactions | Feature | ⬜ |
| 5 | Light-theme audit of the new chat surfaces | Improvement | ⬜ |
| 6 | Cached transcripts (persist transcription on the message) | Improvement | ⬜ |

---

## 1. Model-status banner (done)

**Problem.** When the model provider is unavailable — notably the DeepSeek key
returning **402 "Insufficient Balance"** — every model-backed action fails:
translation (`/v1/translate` → 502), agent runs, company tasks.

**Shipped.** `noteModelError(err)` detects 402/429/5xx / "insufficient balance" /
"translation failed" and shows a persistent, dismissible top banner
(`.model-banner`): *"The AI model is unavailable or out of credit. Chat and files
still work, but translation and tasks are paused."* Wired into the auto-translate
and send-message paths and the voice-transcription call. Verified against the
live 402.

**Follow-up:** also drive it from `/v1/config` model health so it appears before
the first failure.

## 2. Chat search

- **Within a chat:** the composer already has a "Search this chat" find bar
  (`findOpen`/`findQuery`). Extend it to highlight matches and jump between them.
- **Across chats:** a global search over conversation titles + message text,
  grouped results, jump-to-message.

## 3. Group management

- Rename a group (PATCH conversation title).
- Add/remove members (friends only), leave group.
- Surface in the DM/group contact panel (`.contact-panel`).

## 4. Read receipts + reactions

- **Reactions:** the message UI already has a react picker for some paths; make
  it consistent for DM/group messages and persist server-side.
- **Read receipts:** track and display "seen" state for DMs (needs a per-message
  read marker; reuse the existing `readAt` bookkeeping).

## 5. Light-theme audit

The new surfaces (`.contact-panel`, `.contact-media-grid`, `.voice-note*`,
`.dm-*`, `.lightbox`, `.attach-menu`) were authored mostly with theme variables,
but a pass is due: switch `data-theme="light"` and check for hardcoded dark
colors (e.g. the `.voice-note-play` accent, the lightbox scrim, red action
colors) and contrast.

## 6. Cached transcripts

`/v1/transcribe` computes a transcript each time. Persist it on the message (or
a side table keyed by media token) so it survives reloads and isn't recomputed.

---

## Known cross-cutting issues (not chat-specific)

- **Model credit:** the configured DeepSeek key is out of balance (402). Many
  features depend on it.
- **Legacy `E2E1:` messages** still render "🔒 Encrypted message" (unrecoverable
  — their keys rotated).
- **`:4322` web portal** is a baked build; rebuild to pick up UI changes.
