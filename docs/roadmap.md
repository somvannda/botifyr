# Botifyr — roadmap & known gaps

Living checklist. We work top to bottom, one item per change, and tick boxes as
they land. Keep entries short; link code paths instead of explaining them.

## Pending (requested, not finished)
- [ ] **Company workspaces** — group bots into a company (employees + roles) and
      generate one from a website or idea. Design:
      [`docs/company-workspace.md`](company-workspace.md). **Done**: `Workspace`
      + `BotRole` entities (shared → store → API), the onboarding planner
      (`POST /v1/workspaces/plan`) and the create flow, sidebar grouping +
      switcher, employee role pills, and the "Start a company" modal.
      **Remaining**: editable org preview, shared company state (wiki/board),
      per-workspace budgets, and a dedicated company view.
- [ ] **Per-platform extractors** — DramaBox, Hongguo, GoodShort, ShortMax,
      NetShort, QQTV, DramaWave, FreeReels, RaptDrama, ReelLife, ShortFlix,
      DramaTV, DotDrama, iDrama (WeTV/iQIYI already work via yt-dlp). Generic
      HLS/MP4 sniffer hardened (JSON-escaped URLs); a **self-learning recipe**
      design is in [`docs/extractors.md`](extractors.md). One sample URL per site
      still speeds this up.
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
- [x] **Mobile PWA offline** — service worker app-shell caching (`apps/portal/public/sw.js`); API/auth never cached.
- [ ] **Prepaid billing via ChmabaPay** (KHQR / ABA PayWay) — monthly prepaid
      plans **+ on-demand credits**, admin-set pricing/grace/reminders, 7/3/1-day
      reminders, 7-day grace, hard-stop then downgrade to free. Design:
      [`docs/billing.md`](billing.md). **Implemented**: data model, ChmabaPay
      client + pricing, routes + webhook + scheduler, hard-stop, admin billing UI,
      user Usage & Billing. Remaining: live **0.01** validation + email/Telegram go-live.
- [x] **Deploy** — `Caddyfile.example` (automatic TLS + `app.`/`admin.`/`api.` subdomains) + docs.
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
- [x] **Testing** — API integration + jsdom UI smoke test + Playwright portal E2E.
- [ ] **Multi-device** — presence via socket only; offline DMs are not queued.
- [ ] **Design system** — `.icon-btn`/`.round`/`.btn`/`.ghost` rule added; older
      controls may still be inconsistent.

## Improvements (highest value first)
- [x] **Botifyr's computer + teach-by-demonstration** — session desktop sandbox,
      remote-desktop modal (real mouse/keyboard), screen recording + download,
      input trace → learned task → replay, idle auto-stop. See
      [`docs/computer.md`](computer.md).
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
- [x] **Deploy pipeline** — `Caddyfile.example` + subdomains (see `docs/deploy.md`).
- [x] **Test coverage** — API integration + jsdom UI smoke + Playwright portal E2E.

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
