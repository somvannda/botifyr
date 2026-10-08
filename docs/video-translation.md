# Video translation (dubbing + subtitles + lip-sync)

> **Status:** requirements / design draft — nothing built yet.
> Captured from the owner's request so we can scope it and decide the build order.
> Related: [`extractors.md`](extractors.md) (downloading source video),
> [`botifyr-blueprint.md`](botifyr-blueprint.md) (agent + model router),
> [`cost-controls.md`](cost-controls.md) (budgets), [`computer.md`](computer.md) (sandbox).

> **Decisions locked (owner, 2026-10-07)** — see §12:
> 1. **Executor = desktop-local GPU first**; cloud GPU comes later.
> 2. **Providers = both**, pluggable per role (managed APIs *and* local open-source).
> 3. **v1 = full dub + lip-sync** (not subtitle-only first).
> 4. **Default voice = stock voices per detected speaker**; cloning is opt-in.

---

## 1. One-liner

Give Botifyr a **video, a movie, or a whole series** (upload it, or paste a link
and let the bot download it) and it produces a **translated, dubbed, subtitled
version** — in the background, with correct timing and (optional) lip-sync —
without the user touching a video editor.

**It is a pipeline, not an editor.** The user picks the target language and a few
options; the bot runs the rest. Nobody scrubs a timeline.

---

## 2. What the owner asked for (as stated)

1. A new **capability skill**: translate a **video / movie / series**, with **subtitles**.
2. **Understand the lips** of the video → **lip-sync** the translated audio.
3. **Built-in AI** for **voice generation**, connected through **Botifyr admin** (API keys / providers).
4. Bots have **swappable models** (OpenAI, Claude/Anthropic, DeepSeek, Google Gemini, …); the user can **choose which AI** they like, and the model can "do everything as ordered".
5. Use the **user's PC spec** to do voice + video rendering **in the background**, with correct **timing** and **lip-sync**.
6. **No video editor** — handle everything in the background.
7. **Download videos from those websites** (the short-drama / streaming sites) and/or **upload** a file, then **run a translation job** and **render** the output.

---

## 3. Scope

### In scope
- Ingest: **upload** a file, or **download** one from a URL (reuse the existing
  `youtube.download` / `media.sniff` / self-learning recipe pipeline).
- **Series support**: a list of episodes → one job per episode → one bundled export.
- **Speech understanding**: detect speech vs music/sfx, transcribe, detect language,
  identify **who is speaking** (speaker diarization).
- **Translation** with scene context, a glossary, and subtitle-safe line lengths.
- **Subtitles**: `.srt` / `.vtt`, target language (+ optionally bilingual), soft-sub
  mux or burn-in.
- **Dubbing**: TTS per speaker, optional **voice clone** of the original actor,
  aligned to segment timing.
- **Lip-sync** (configurable / off by default): re-sync the mouth region of on-screen
  faces to the dubbed audio.
- **Render + mux** with ffmpeg; downloadable result; in-app preview.
- **Background jobs**: progress, pause/cancel, resume after restart, per-job cost.

### Out of scope (for now)
- A timeline/NLE editor, manual frame-by-frame editing, color grading, VFX.
- Perfect frame-accurate lip-sync for **every** shot (see §7 — this is the hardest part).
- **DRM-protected** streams (Widevine) — not solvable, same rule as `extractors.md`.
- Live/real-time dubbing.

### Confirmed by design
- **No editor.** The "review" surface is minimal and optional: preview the dub,
  fix a single subtitle line, re-pick a voice, then re-render. Not a timeline.

---

## 4. The pipeline (stages)

Each stage is a **tool/step** the bot can run deterministically, and each can be
swapped for a different provider (see §6). Stages are resumable and cache
intermediate artifacts so a re-render doesn't redo expensive work.

```
1. INGEST        file upload | URL download (existing extractor pipeline)
2. PROBE         ffprobe: duration, tracks, fps, resolution, audio layout
3. SEPARATE      vocals / music+sfx split (Demucs or UVR)  ── keeps music & sfx
4. TRANSCRIBE    ASR + language ID + word timestamps (Whisper / WhisperX)
5. DIARIZE       who spoke when (pyannote) + face on screen? (shot/face detect)
6. TRANSLATE     LLM per scene, glossary + length constraints
7. TTS / VOICE   synthesize target speech per speaker; optional voice clone
8. ALIGN         time-stretch / pad / trim TTS to hit original segment timing
9. LIP-SYNC      (optional) re-sync on-screen faces to the dubbed audio
10. MIX/RENDER   recombine dubbed vocals + music/sfx; mux subs; encode
11. DELIVER      download link, in-app preview, per-job manifest + cost
```

**Key rule:** stages 1–6 (subtitle-only) are cheap and reliable. Stages 7–9
(dubbing + lip-sync) are the expensive, compute-heavy, quality-sensitive part.
**Build them bottom-up** (subs → dub → lip-sync, per §13), but **v1 ships the full
slice** — dub + lip-sync included, with graceful downgrade when the machine can't
run the heavy stages.

### 4.1 Timing (the part that must be "correct")
TTS output rarely matches the original segment length. In order of preference:
1. **Length-aware TTS**: give the model a target duration / char budget.
2. **Time-stretch** the synthesized line (`ffmpeg atempo`, or `rubberband` for
   better quality) to fit, within a small tolerance.
3. **Re-flow** the line across neighboring segments if it still doesn't fit.
4. **Never desync**: the tool must fail the segment, not silently drift.

Segments are derived from word timestamps (WhisperX), not fixed windows, so
subtitle timing and audio timing share one source of truth.

### 4.2 Lip-sync (the part that is hard)
- Only matters where a **face is visible and large enough**; detect shots/faces and
  apply lip-sync **selectively**, not to the whole frame.
- Options (pluggable "lip-sync provider"):
  - open-source: **LatentSync**, **MuseTalk**, **VideoReTalking**, (Wav2Lip as a
    last resort — low resolution);
  - managed API: **Sync.so**, **HeyGen**, **D-ID**, **Captions.ai**.
- **Fallback = no lip-sync.** Dub audio still overlays the original video; many
  viewers accept this. Lip-sync is an *upgrade*, gated behind a setting and a warning
  about compute cost.

---

## 5. Tool & capability surface

New deterministic tools (in `packages/agent-core/src/tools`), bundled as one
high-level skill/tool so the agent doesn't have to orchestrate 11 raw steps:

| Tool | Purpose |
| --- | --- |
| `video.translate` | One job: source (file/URL) → target language + options → rendered output. |
| `video.transcribe` | ASR + word timestamps + language (reusable alone). |
| `video.subtitle` | Translate an existing transcript → `.srt`/`.vtt`, soft or burn-in. |
| `video.dub` | TTS per speaker, aligned; optional voice clone. |
| `video.lipsync` | Re-sync faces to an audio track (provider-pluggable). |
| `video.job_status` | Progress / stage / cost of a running job. |
| `video.job_cancel` | Stop a job; keep partial artifacts. |

- Register a **built-in skill** (`apps/cloud/src/skills.ts`, like `youtube` /
  `video`) whose content is the operator guide for the pipeline.
- Extend `apps/cloud/src/tool-capabilities.ts`: gate the media tools under a
  capability (reuse `media.*` → `research.web`, or add a `video.translate` capability).
- Ingest reuses the **existing** download path — no new extractor work: the job
  starts from a URL and `youtube.download`/`media.sniff` fetches it first.

### 5.1 Options the user sets (all optional; sane defaults)
- Target language (and optional second language for bilingual subs).
- Output mode: **subtitles only** · **dub only** · **dub + subs**.
- Subtitle style: soft (toggleable) vs burn-in.
- Voice: per-speaker map, or "clone original", or "pick a stock voice".
- Lip-sync: **off** (default) · auto (faces only) · force.
- Quality/speed: draft (fast model, 720p, no lip-sync) vs final (best models, source res).

---

## 6. Model & provider layer (the "built-in AI" + swappable models)

Today the app has one text provider (`packages/agent-core/src/providers`, chosen by
`BOTIFYR_PROVIDER`, default DeepSeek). This feature needs **role-based routing**:
different models for different jobs.

| Role | What it needs | Candidate providers |
| --- | --- | --- |
| **Planner / agent brain** | reasoning + tool calls | OpenAI, Anthropic, Gemini, DeepSeek, Ollama/local |
| **Translator** | long-context, glossary, tone | same LLMs; user-selectable |
| **ASR** | word timestamps | Whisper local, OpenAI, Deepgram, AssemblyAI, ElevenLabs Scribe |
| **TTS / voice** | natural or cloned voice | ElevenLabs, OpenAI, Azure, Google, PlayHT, Cartesia, local XTTS/F5/Piper |
| **Lip-sync** | video model | Sync.so, HeyGen, D-ID, or local LatentSync/MuseTalk |
| **Separator** | vocals/sfx split | local Demucs/UVR |

**Decisions needed (open questions in §12):** whether to lead with **managed APIs**
(quality, needs keys, per-minute cost) or **local open-source models** (free, needs
GPU), or expose both.

### 6.1 User-switchable models
- The user should be able to pick the **brain** (OpenAI / Claude / Gemini / DeepSeek /
  local) — this generalizes the existing single-provider setup into a **model router**
  (`docs/botifyr-blueprint.md §3.1` already promises "BYO model, never hard-code one").
- Media roles (ASR/TTS/lip-sync) get **their own** pickers, because no single vendor
  is best at all of them.

### 6.2 Admin (`apps/cloud` + `apps/admin`)
Admins register and control the providers:
- **Provider registry per role**: base URL, model id, API key (encrypted vault),
  enable/disable, default.
- **Pricing registry**: per-unit cost (per token / per minute / per minute of video)
  so billing can charge with markup — the existing per-model billing table extends to
  media units.
- **Defaults & allowlist**: which roles users may switch, which are admin-locked.
- **Moderation**: learned **voice clones** and **extractor recipes** (a cloned voice
  is a sensitive artifact; treat like a learned skill → `pending` → admin approves).
- **Quotas**: daily/monthly minutes of transcription/dubbing/lip-sync per plan.

---

## 7. Execution: whose computer? (important correction)

> "use their PC spec to do voice and video rendering in the background" — this is
> only possible in the **desktop app**.

| Host | Can use the user's GPU/CPU? | Notes |
| --- | --- | --- |
| **Desktop (Tauri)** | **Yes** | Run a local worker (sidecar) with GPU; fastest, cheapest, private. Needs a packaged Python/ffmpeg runtime and a GPU check. |
| **Web / portal** | **No** | The browser/portal can't reach the user's hardware. Jobs run on **cloud GPU workers** (or a user's self-hosted node). |
| **Self-hosted / cloud node** | — | Same worker, deployed server-side. |

So the requirement becomes: **one job model, two executors** —
- **Local executor** in the desktop app (uses the PC's GPU; "background" = a job
  runner that keeps working while the app is open, with resume across restarts).
- **Cloud executor** on a GPU node for web/portal users and for phones.

`apps/node` already exists (local node) — the local media worker can live beside it,
reusing the same job queue and progress events. The existing sandbox exec cap
(15 min, see `roadmap.md` "Long jobs") must be lifted for these jobs via a
**persisted job queue**.

**GPU reality check:** Whisper (small/medium) and TTS can run on CPU but slowly; local
lip-sync (LatentSync/MuseTalk) realistically needs an NVIDIA GPU with several GB VRAM.
The job must **probe the machine** and either downgrade (subtitle-only, no lip-sync)
or offer cloud execution.

---

## 8. Background jobs, cost & reliability

- **Persisted per-file job queue** (the open gap in `roadmap.md`) is a prerequisite:
  a movie/series outlives one request and one sandbox exec window.
- Per job: stage, progress %, ETA, artifacts on disk, **cost so far**.
- **Resume**: skip completed stages using cached artifacts (transcript, dub track, …).
- **Cancel**: stop and keep partials.
- **Budget**: run inside the existing cost controls; media units (minutes) priced
  like token usage; a hard per-job cap so a 40-episode series can't run away.
- **Storage**: large intermediate files → the existing media volume + quota sweep
  (`BOTIFYR_MEDIA_*`).

---

## 9. UI / UX (one UI, two hosts — `packages/ui`)

Everything lives in `BotifyrApp` (`packages/ui/src/BotifyrApp.tsx`); both hosts stay
thin (see `AGENTS.md §7`), host differences behind `BotBridge`.

- **Start a job**: a "Translate video" entry — paste a link, or drag/drop a file, or
  pick from the Library. Choose language, mode, voice, lip-sync.
- **Job card / panel**: live stage + progress, per-episode list for a series, a
  **Preview** (subs / dub), **Download**, **Cancel**.
- **Minimal review** (optional): list of subtitle lines with an inline "fix" box, and
  a voice-per-speaker table. Re-render after edits. **No timeline.**
- **Downloads/Library**: outputs appear alongside existing media with a badge
  (e.g. "EN→KM dub").
- **Settings → AI**: which model for the brain / translator / TTS / ASR / lip-sync.

Uses `BotBridge.startLocalNode`/host capability to run the local worker on desktop.

---

## 10. Data model (sketch)

```
VideoJobRecord {
  id, userId, sessionId,
  source: { kind: "upload" | "url"; url?; mediaId? },
  episodes: [{ index, title?, status, artifacts }],
  options: { targetLang, mode, subtitleStyle, voices, lipSync, quality },
  stage, progress, status: "queued"|"running"|"paused"|"done"|"failed"|"cancelled",
  executor: "local" | "cloud",
  costCents, tokens?, mediaMinutes?,
  createdAt, startedAt, finishedAt,
}
VoiceCloneRecord  { id, userId, name, sampleMediaId, status: pending|approved|rejected }
ProviderRoleConfig{ role, provider, baseUrl?, model?, keyRef, enabled, isDefault, pricing }
```

---

## 11. Safety, legal & quality

- **Legal / ToS**: downloading from third-party apps may breach their terms
  (`extractors.md` already says this); translation/dubbing of copyrighted movies has
  its own issues. Keep it a **tool capability**, not a built-in catalog; clear AUP.
- **Voice cloning consent**: require a self-voice sample or an explicit consent
  checkbox; admin moderation of clones; watermark/log dubs.
- **Deepfake risk**: label dubbed output; never let a clone voice be used to impersonate
  a third party without consent.
- **Prompt-injection**: transcripts are untrusted content — the translator prompt must
  treat transcript text as data, never as instructions.
- **Quality bar**: publish expectations — subtitle-only is near-perfect; dubbing is
  good; lip-sync is "best effort, faces only".

---

## 12. Decisions (locked)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Where jobs run | **Desktop-local GPU first**; cloud GPU worker later for web/portal/mobile. |
| 2 | Managed APIs vs open-source | **Both, pluggable per role.** Admin (or the user, per allowlist) picks the provider; same tool interface. |
| 3 | v1 slice | **Full dub + lip-sync**, with **automatic graceful downgrade** when the machine can't run it (see §13). |
| 4 | Voice default | **Stock voices per detected speaker.** Cloning is **opt-in** (consent + moderation). |

### Still open
- **Model switching (Q4):** per-user pickers for *every* role, or admin-set defaults
  users choose within an allowlist? *Proposal:* admin defaults + user override for the
  **brain/translator**; **ASR/TTS/lip-sync locked to admin** in v1.
- **Series handling (Q5):** one job with N episodes, or N jobs grouped into a series?
  *Proposal:* **N jobs grouped by a `seriesId`** — simpler resume/retry per episode.
- **Cloud GPU provider:** rent (RunPod/Vast/Lambda) vs own boxes — decides cloud cost model.

---

## 13. Build plan — one vertical slice

Because "full dub + lip-sync in v1" is the highest-cost, highest-risk slice, build it
as **one vertical slice** with **hard fallbacks**, not a dozen parallel features.

**The slice:** `URL/file → transcribe → translate → dub → (lip-sync) → render → download`,
proven end-to-end on a single short clip on a real GPU, then hardened.

### 13.1 GPU probe + graceful downgrade (launch blocker)
The very first step of any job is a **capability probe** of the desktop machine
(NVIDIA CUDA present? enough VRAM? ffmpeg? disk?). It selects a tier and *tells the user*:

| Tier | Condition | What runs |
| --- | --- | --- |
| **Full** | NVIDIA + sufficient VRAM | dub **+** lip-sync (LatentSync/MuseTalk or managed Sync.so/HeyGen) |
| **Dub** | CPU-only or little VRAM | dub with stock voices; **no lip-sync** |
| **Subs** | no ASR/TTS available | translated `.srt` only (never a dead end) |

A job may **auto-downgrade** mid-run (e.g. lip-sync OOM) and record why. User is warned
upfront: *"your machine has no GPU — lip-sync will be skipped."*

### 13.2 Phases

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| **P0** | Role-based **provider registry** (brain / translator / ASR / TTS / lip-sync) + admin keys + per-media-minute pricing. No media yet. | billing, vault |
| **P1** | **GPU probe + job queue + local desktop worker** (`apps/node`-adjacent). The spine every later stage rides on. | node host, media volume |
| **P2** | `video.transcribe` + `video.subtitle` — first real output (`.srt`), reuses the existing download path. | extractors, ASR |
| **P3** | `video.dub` — aligned TTS with stock voices, music/sfx separation + mix. | P2, TTS |
| **P4** | `video.lipsync` — faces-only, provider-pluggable, auto-downgrade on failure. **Completes the v1 slice.** | P3, GPU |
| **P5** | Series jobs (`seriesId` grouping), budget hardening, per-episode retry. | P1–P4 |
| **P6** | Cloud GPU worker for web/portal/mobile; voice cloning + moderation. | P5, cloud |

**Milestone test (v1):** a user on a GPU desktop pastes a short-drama episode URL, picks
EN→KM, and gets back a dubbed, lip-synced video with subtitles — timed correctly,
downloadable, with a job manifest and cost — **without opening an editor.** On a
non-GPU machine the same flow must still produce a dubbed (non-lip-synced) file.

### 13.3 Cost & limits
- Media is priced **per minute** of transcription / dubbing / lip-sync (extend the
  per-model billing table), inside the existing caps in
  [`cost-controls.md`](cost-controls.md); add a **per-job minutes cap** so a 40-episode
  series can't run away.
- Render/mux and file storage follow the **local** rule first (user's disk) — no cloud
  spend for a desktop job unless the user opts into cloud GPU.
