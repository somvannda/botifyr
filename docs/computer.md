# Botifyr's computer (desktop sandbox) & teach-by-demonstration

How the remote desktop works, in one place.

## 1. What it is

Each chat (session) can open a **throwaway Linux desktop** — "Botifyr's computer"
— that the bot and the user share. It runs in its own container and streams live
to the app.

- **Image:** `infra/desktop-sandbox` → `botifyr/desktop-sandbox:1`
  (base `node:22-bookworm-slim` = **Debian 12**; Xvfb + openbox + xterm +
  **Chromium** + xdotool + ffmpeg).
- **Backend:** `createDockerComputerBackend()` talks to the container's HTTP API
  (`/action`, `/stream`, `/recording`).
- **Runtime:** backed by `setComputerSandbox("session:<id>", …)` in
  `apps/cloud/src/runtime.ts`.

## 2. Starting & stopping

| Action | Route |
| --- | --- |
| Start | `POST /v1/sessions/:id/computer` |
| Stop (removes the container) | `POST /v1/sessions/:id/computer/stop` |
| Live stream (MJPEG) | `GET /v1/sessions/:id/stream?token=…` |

In the UI: **Bot panel → Computer → "Start <bot>'s computer"** opens a centered
**modal** with the live screen. **Stop computer** (or the ✕ / backdrop) stops the
container. Closing the modal always stops it, so containers don't leak.

**Idle safety net:** the cloud sweeps every 60 s and stops desktops idle longer
than `BOTIFYR_COMPUTER_IDLE_MINUTES` (default **10**). Activity (start / input /
record / stream) refreshes the timer.

## 3. Real mouse & keyboard

The modal forwards input to the sandbox via
`POST /v1/sessions/:id/computer/input { action, args }`:

- mouse **move** (throttled), **click** (left/right/middle → xdotool 1/2/3),
  **wheel scroll**;
- **keyboard:** printable keys → `type`, and Enter/Backspace/Tab/Esc/arrows/Delete
  → `key` (xdotool names).

So it behaves like a normal remote desktop — click and type directly.

## 4. Screen recording

| Action | Route |
| --- | --- |
| Start/stop | `POST /v1/sessions/:id/computer/record { on }` |
| Download MP4 | `GET /v1/sessions/:id/computer/recording?token=…` |

The sandbox runs `ffmpeg -f x11grab` under the hood; the cloud streams the file
through the **same backend handle** (avoids a re-created-container 404). In the UI
the modal footer has **Record / Stop recording** and **Download recording**.

## 5. Teach by demonstration

The cloud records every input the user sends to a session's desktop:

- `GET  /v1/sessions/:id/computer/trace` — the recorded steps `{ t, action, args }`.
- `POST /v1/sessions/:id/computer/learn { name? }` — turns the trace into a
  **learned task** (a `LearnedSkillRecord`, `status: "pending"`,
  `source: "computer-trace"`) shown in **Admin → Learned skills**, then clears the
  trace.
- `POST /v1/sessions/:id/computer/replay { name|id }` — re-runs a learned task's
  steps on the session desktop.

The modal's **Save as task** button calls `learn`. (This is separate from screen
recording — a video is evidence; a *trace* is what's replayable.)

## 6. Environment

| Variable | Default | Effect |
| --- | --- | --- |
| `BOTIFYR_DESKTOP_IMAGE` | `botifyr/desktop-sandbox:1` | Sandbox image. |
| `BOTIFYR_COMPUTER_IDLE_MINUTES` | `10` | Auto-stop an idle session desktop. |
| `SCREEN_WIDTH` / `SCREEN_HEIGHT` (sandbox) | `1280` / `800` | Desktop size; the UI maps clicks against this. |
| `BOTIFYR_SANDBOX_NETWORK` | `botifyr-net` | Network the sandbox joins so the cloud can reach it. |

## 7. Notes

- The sandbox is **not** a VM: it's a minimal X desktop in a container, one per
  session, removed on stop.
- The desktop is **shared** with the bot's `computer.*` tools — the user and the
  agent operate the same screen.
