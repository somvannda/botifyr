# Chat roadmap (features & improvements)

Backlog for the shared chat UI (`packages/ui/src/BotifyrApp.tsx`) and the
cloud endpoints it uses. Complements
[`docs/chat-attachments.md`](chat-attachments.md) (which covers what is already
shipped).

Status legend: ✅ done · 🚧 in progress · ⬜ not started

| # | Item | Type | Status |
| --- | --- | --- | --- |
| 1 | Model-status banner (credit/provider failures) | Improvement | ✅ |
| 2 | Chat search (across chats + within a chat) | Feature | 🚧 |
| 3 | Group management (rename, add/remove, leave) | Feature | ✅ |
| 4 | Read receipts + message reactions | Feature | 🚧 |
| 5 | Light-theme audit of the new chat surfaces | Improvement | ✅ |
| 6 | Cached transcripts (persist transcription on the message) | Improvement | ✅ |

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

- ✅ **Across chats:** typing in the sidebar search scans every conversation's
  messages and shows a **"Messages"** section of hits (title + snippet); clicking
  a hit opens that conversation. (Verified: "hi" → 3 hits.)
- ⬜ **Within a chat:** the composer's "Search this chat" find bar
  (`findOpen`/`findQuery`) filters messages; still to add match highlighting and
  next/previous navigation.

## 3. Group management (done)

- `PATCH /v1/conversations/:id` — rename; `POST/DELETE
  /v1/conversations/:id/members[/:userId]` — add/remove (remove self = leave).
- Contact panel group-admin section: rename input, member list with Remove, an
  "Add a friend…" picker, and Leave group (`.group-admin`, `.contact-input`).
- Verified live: create group → rename to "Renamed Group" → remove member (200).

## 4. Read receipts + reactions

- **Reactions:** the message UI already has a react picker for some paths; make
  it consistent for DM/group messages and persist server-side.
- **Read receipts:** track and display "seen" state for DMs (needs a per-message
  read marker; reuse the existing `readAt` bookkeeping).

## 5. Light-theme audit (done)

Audited the new surfaces (`.contact-panel`, `.contact-*`, `.group-*`,
`.contact-media-grid`, `.voice-note*`, `.dm-*`, `.search-hit*`, `.attach-menu`,
`.model-banner`, `.lightbox`). All colors come from theme variables
(`--panel`, `--border`, `--text`, `--muted`, `--hover`, `--accent`) except two
intentional cases: white text on the accent play button / recording state, and
the lightbox's dark scrim (kept dark in both themes). No changes required.

## 6. Cached transcripts (done)

Transcripts are cached per media token in `localStorage["botifyr.transcript.<token>"]`
by the `onTranscribe` wrapper, so a reload shows the cached text instead of
calling `/v1/transcribe` again. (Server-side persistence keyed by media id is a
larger change — the `media` table has explicit columns and no JSON blob — so this
is the client-side cache.)

---

## Known cross-cutting issues (not chat-specific)

- **Model credit:** the configured DeepSeek key is out of balance (402). Many
  features depend on it.
- **Legacy `E2E1:` messages** still render "🔒 Encrypted message" (unrecoverable
  — their keys rotated).
- **`:4322` web portal** is a baked build; rebuild to pick up UI changes.
