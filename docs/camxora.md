# Camxora Music integration

> Status: **shipped** — connection + marketplace app + agent tools.
> API: **Camxora Music API** (`https://musicapi.camxora.com`) — AI music
> generation (Suno-compatible, ~47 endpoints).

## What it is

Camxora generates watermark-free AI music — vocals, instrumentals, extensions,
covers, stems, WAV, lyrics, MIDI and MP4 music videos — over a REST API. Once a
user connects their Camxora API key, the Botifyr agent can generate music and
call any Camxora endpoint as part of a task.

## Connecting (user flow)

1. In the app: **Connect apps (Marketplace)** → **Camxora Music**.
2. Paste the API key from the Camxora dashboard.
3. Botifyr stores it **encrypted in the vault** (`connections` table, provider
   `camxora`) — the same token-app path as GitHub/Notion/Telegram. The key never
   enters the model context.

Marketplace entry: `packages/ui/src/BotifyrApp.tsx` (`MARKETPLACE`), brand icon in
`packages/ui/src/BrandIcons.tsx`. Token provider allowlist:
`TOKEN_APPS` in `apps/cloud/src/server.ts`.

### Key validation

Connecting opens a modal that **checks the key with Camxora** (`GET /v1/credits`)
**before** storing it — an invalid key is rejected inline and never saved, and a
valid one reports the balance (e.g. *"Valid — 512 credits"*). A connected app
shows **Added** plus a **Check** button that re-validates the stored key on demand.

`POST /v1/connections/:provider/validate` (auth) backs this: with `{ token }` it
checks a candidate; without, it checks the stored one. Validators live in
`apps/cloud/src/connection-validators.ts` (camxora, github, telegram, notion,
slack); apps without a probe pass through as "can't be auto-checked" rather than
blocking the connection.

## Tools (agent)

`apps/cloud/src/camxora-tools.ts` — registered for a run when the user has the
`camxora` connection (`runner.ts`).

| Tool | Camxora endpoint | Approval |
| --- | --- | --- |
| `music.credits` | `GET /v1/credits` | — |
| `music.generate` | `POST /v1/music` | ✅ |
| `music.extend` | `POST /v1/music/extend` | ✅ |
| `music.cover` | `POST /v1/music/cover` | ✅ |
| `music.lyrics` | `POST /v1/lyrics` | — (free) |
| `music.stems` | `POST /v1/music/stems` | ✅ |
| `music.wav` | `POST /v1/music/wav` | — |
| `music.wav_status` | `GET /v1/music/wav/:id` | — |
| `music.video` | `POST /v1/mp4/generate` | ✅ |
| `music.task` | `GET /v1/task/:id` | — |
| `music.get` | any `GET` path | — |
| `music.request` | any `POST` path | ✅ |

**Coverage of "every endpoint":** the curated tools cover the common operations;
`music.get` and `music.request` are a passthrough that reaches *any* of the ~47
endpoints (mashup, remaster, replace-section, add-vocals/instrumental,
cover-image, upload, voice/persona, sounds, midi, boost, recovery, …) without 47
near-identical tools. This is deliberate — a small, legible toolset an agent can
use well, with a generic escape hatch.

**Credits = money → approval.** Every tool that spends credits
(`requiresApproval`) pauses for the user before it runs, per
[`product-plan.md`](product-plan.md) and the trust ladder.

**Async by design.** Generation returns a task id; the bot polls with
`music.task` until the result carries playback URLs. Callbacks
(`callback_url`) are supported by the API but not required.

**Durability — nothing stored on our side.** Playback and download go **directly
from Camxora's CDN**; Botifyr stores nothing. A streaming URL can be
signed/expiring, so to keep a track the bot runs `music.wav` and polls
`music.wav_status` for a durable URL served from Camxora's own storage, then
shares it. Either URL renders as an inline player + a direct **Download** link in
the chat.

## Config

- `BOTIFYR_CAMXORA_URL` — override the base URL (default
  `https://musicapi.camxora.com`), e.g. for a local Camxora dev backend.

## Not included

- A dedicated music-player/job UI (results arrive as URLs in the chat and can be
  saved to the Library).
- Camxora credit **billing passthrough** (the user pays Camxora directly with
  their own key; Botifyr does not resell credits).
