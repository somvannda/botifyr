# Botifyr — roadmap & known gaps

Living checklist. We work top to bottom, one item per change, and tick boxes as
they land. Keep entries short; link code paths instead of explaining them.

## Pending (requested, not finished)
- [ ] **Per-platform extractors** — DramaBox, Hongguo, GoodShort, ShortMax,
      NetShort, QQTV, DramaWave, FreeReels, RaptDrama, ReelLife, ShortFlix,
      DramaTV, DotDrama, iDrama (WeTV/iQIYI already work via yt-dlp).
      Needs one **sample URL** per site. Generic HLS fallback exists in
      `packages/agent-core/src/tools/media.ts`.
- [x] **Friend group chats** — create a thread with several friends
      (`kind: "group"` model already exists).
- [x] **Send a file to a friend** — signed, recipient-scoped, 7-day links from
      Downloads → “Send to friend”; the recipient taps “Save file” in the DM.
- [x] **Profile editing UI** — set @handle / display name / avatar
      (`PATCH /v1/profile`; UI in the People panel).
- [x] **Unread badges** — per conversation; opening a chat clears it.
- [x] **Notifications** — in-app toasts + OS notifications on web (hidden tab)
      and desktop (via `tauri-plugin-notification`).
- [x] **P2P hardening** — TURN/ICE servers configurable via `/v1/config`
      (`BOTIFYR_TURN_*` / `BOTIFYR_ICE_SERVERS`); still to verify across 2 devices.
- [ ] **Mobile PWA offline** (manifest exists; no service worker).
- [ ] **Real Stripe** — checkout + webhook signature verification done; invoices
      and the billing portal are still open.
- [ ] **Deploy** — TLS, reverse proxy, subdomains (`app.` / `admin.` / `api.`).
- [x] **Retire static `/admin.html`** — `/admin` now 302-redirects to the console.

## Gaps (quality / risk)
- [ ] **Refusals** — mitigated (policy + prefill + retry + forced tool), not
      guaranteed for the search step; single model (DeepSeek).
- [ ] **Heuristics** — deterministic routing is regex-based; add a confirm step
      when confidence is low.
- [ ] **Long jobs** — 15-min sandbox exec cap; whole-channel downloads can
      exceed it. Resume + restart reconciliation done; a persisted per-file job
      queue is still open.
- [x] **Media storage** — age + quota sweep (`BOTIFYR_MEDIA_*`); “Move” is
      copy + mark. A complete **Downloads** history view backfills from the volume.
- [ ] **Security** — CORS allowlist and access/refresh tokens are done;
      DMs are still server-readable (no E2E); P2P without TURN.
- [x] **Cost** — opt-in hard daily cap + per-task token cap; usage visible in
      Settings → Usage.
- [ ] **Testing** — unit tests for media only; no API/UI integration or E2E.
- [ ] **Multi-device** — presence via socket only; offline DMs are not queued.
- [ ] **Design system** — `.icon-btn`/`.round`/`.btn`/`.ghost` rule added; older
      controls may still be inconsistent.

## Improvements (highest value first)
- [x] **Background downloads** — `--continue` resume + interrupted-task
      reconciliation on restart; a persisted per-file job queue is still open.
- [x] **Media retention & quota** — age-based + quota sweep (`BOTIFYR_MEDIA_*`).
- [x] **Profile & notifications** — profile UI + unread badges + in-app toasts.
- [x] **Local model option** — `BOTIFYR_PROVIDER=ollama` (+ `BOTIFYR_BASE_URL`,
      `BOTIFYR_MODEL`) for OpenAI-compatible local models.
- [x] **Security pass** — CORS allowlist + rotating refresh tokens done;
      optional E2E for DMs still open.
- [x] **Cost enforcement** — opt-in hard daily cap (`BOTIFYR_ENFORCE_BUDGET`) and
      a per-task token cap (`BOTIFYR_MAX_TASK_TOKENS`).
- [ ] **Deploy pipeline** — proxy + subdomains + Stripe.
- [ ] **Test coverage** — API integration + UI smoke test.

## Done (for reference)
Platforms (cloud / desktop / web+portal / admin / API keys+docs), agent loop,
sandbox (browser/computer/code), deterministic YouTube (search/download/batch/
channels), Stop/cancel, in-app player + HTTP Range, media manifest + Move +
P2P signaling, groups (parallel, autonomous, handoff), self-learning skills,
connections (Google/GitHub/Slack/Notion/Telegram), billing (trial/pro), admin
moderation + audit, friends + presence + 1:1 DMs (desktop + portal), Google
sign-in + open signup, Noto Sans Khmer, button design system, cost controls.
Library media categories (All/Videos/Audio/Images/Files) + in-player prev/next
browsing; chat-list unread badge (right-aligned) + hover delete (two-step
confirm); date-grouped Downloads with Save / Send to friend / Delete.
