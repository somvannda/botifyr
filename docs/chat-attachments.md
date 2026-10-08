# Chat messages & attachments — Telegram-style UX

Reference notes on how **Telegram** presents messages and attachments, and how
Botifyr's shared chat UI (`packages/ui/src/BotifyrApp.tsx`) maps to them. The
goal is a familiar, low-friction chat: media renders as media, documents render
as tidy rows, and nothing shows a raw URL.

## 1. Telegram's model (reference)

### Message bubbles
- **Incoming** messages align left; **outgoing** align right.
- Consecutive messages from the same sender are **grouped** (only the first shows
  the sender name/avatar in groups); the tail corner is flattened.
- A message carries: sender, timestamp, delivery/read state, optional **reply
  quote**, and optional **reactions**.
- Media in group chats is shown **inside the bubble**, next to the sender's name
  and avatar.

### Attachment kinds
Telegram distinguishes: **photo, video, document, voice/audio, GIF, sticker,
location**. The presentation differs per kind:

| Kind | Presentation |
| --- | --- |
| **Photo** | Inline thumbnail; tap opens a full **media viewer** (swipe through the chat's media, zoom/pan, save/forward/delete). Auto-downloaded. |
| **Video** | Inline preview with a play overlay; explicit tap to download/play. |
| **Voice / audio** | Inline player with a **waveform**; a "transcribe" action shows text under it. |
| **Document** | A **file row**: type icon + filename + size + download. Never inline. |
| **Album** | Up to 10 photos/videos grouped into a single grid message; **one** notification for the set. |

### Captions
- Any photo/video/document may carry a **caption** (0–1024 chars) shown under the
  media, inside the bubble.
- The caption is separate from the file itself.

### Other conventions
- **One notification** per media message (or per album), not per file.
- A **Shared media / Media** screen collects every attachment in a chat.
- Files never expose a raw storage URL to the user — the UI shows the file, and
  download/save is an explicit action.

## 2. How Botifyr models attachments

Botifyr's chat is intentionally simpler and reuses one primitive:

- An attachment is a normal message whose text is `📎 <name>\n/shared/<token>`.
  - `<name>` is the human file name.
  - `<token>` is a signed, recipient-scoped link (and, since the owner-preview
    change, also openable by the file's owner).
- Files live in the downloads volume; the server serves them via `/v1/shared`
  with a correct content type and `inline` disposition for media.

### Presentation (implemented)

| Kind | Botifyr presentation |
| --- | --- |
| **Image** (`png/jpg/jpeg/webp/gif/svg`) | Inline `<img>` (`dm-preview-img`), max ~320×240, rounded. Click opens the file. **No file chip.** |
| **Video** (`mp4/webm`) | Inline `<video controls>` (`dm-preview-video`). |
| **Audio** (`mp3/wav/ogg`) | Inline `<audio controls>` (`dm-preview-audio`). |
| **Other** | A **document row** (`dm-file`): type icon + name + **Save**. |
| **Sidebar / notification preview** | One line: `📎 <name>` (never the raw token). |

Helpers: `sharedTokenOf`, `sharedFileOf`, `previewText`, and the `dmFileCard`
renderer in `BotifyrApp.tsx`.

### Deliberate differences from Telegram
- No media viewer / albums yet — images open in the OS/browser.
- No caption field on attachments (the `📎 name` line is the only text).
- No waveform for audio (native `<audio>` controls).

## 3. Roadmap / next steps

Done:
- ✅ **Media viewer** — clicking an image opens a full-screen lightbox with
  prev/next across all images in the chat and a filename caption
  (`.lightbox`, `.lightbox-nav`, `.lightbox-caption`).
- ✅ **Document rows** — extension-based type icons (`fileIconFor`).
- ✅ **Captions** — text typed in the composer rides along with the attachment
  (`📎 name\n/shared/<token>\n<caption>`) and renders under the media
  (`.dm-caption`); the sidebar/notification preview shows the caption.
- ✅ **Albums** — attaching multiple files (multi-select in the composer) sends one
  message with all `📎 name` + `/shared/<token>` pairs and renders as a grid
  (`.dm-album`, `.dm-album-grid`, `.dm-album-cell`); one message = one notification.

- ✅ **Video in the lightbox** — the media viewer spans images *and* videos;
  videos render with playback controls (`<video controls autoPlay>`).
- ✅ **File sizes** — the size rides in the share-token payload (`s`), is decoded
  client-side (`decodeShare`) and shown on document rows (`formatSize`,
  `.dm-file-size`).
- ✅ **Voice notes** — the attach menu has "🎤 Record a voice note"; `MediaRecorder`
  captures the clip, uploads it via `/v1/uploads`, and it renders as an inline
  audio player (`<audio controls>`).

Next:
1. **Waveform** — visualise voice notes (currently the native `<audio>` player).
2. **Transcription** — a "transcribe" action that shows text under the clip.

## 4. Server contract

- `POST /v1/uploads` — base64 upload (≤15 MB), stored under the downloads volume,
  recorded as a `MediaRecord` (`location: "server"`).
- `POST /v1/media/:id/share` — signed, recipient-scoped token.
- `GET /v1/shared?share=<token>&token=<jwt>` — serves the file. Recipient **or**
  owner may fetch. Content type via `mimeForName`; `inline` for image/video/audio,
  `attachment` otherwise.
