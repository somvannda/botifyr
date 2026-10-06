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
- [ ] **Send a file to a friend** — from Media/Library, share a downloaded file
      into a DM. Needs a **secure shared-file** design (a plain download URL
      would leak the sender's token), so: signed, recipient-scoped links.
- [x] **Profile editing UI** — set @handle / display name / avatar
      (`PATCH /v1/profile`; UI in the People panel).
- [x] **Unread badges** — per conversation; opening a chat clears it.
- [ ] **Notifications** (toasts / OS) for DMs and finished tasks.
- [ ] **P2P hardening** — TURN relay for strict NAT; verify across 2 devices.
- [ ] **Mobile PWA offline** (manifest exists; no service worker).
- [ ] **Real Stripe** — keys, invoices, billing portal.
- [ ] **Deploy** — TLS, reverse proxy, subdomains (`app.` / `admin.` / `api.`).
- [ ] **Retire static `/admin.html`** (superseded by `apps/admin`).

## Gaps (quality / risk)
- [ ] **Refusals** — mitigated (policy + prefill + retry + forced tool), not
      guaranteed for the search step; single model (DeepSeek).
- [ ] **Heuristics** — deterministic routing is regex-based; add a confirm step
      when confidence is low.
- [ ] **Long jobs** — 15-min sandbox exec cap; whole-channel downloads can
      exceed it. No resumable background job queue.
- [ ] **Media storage** — server volume only; no quota / auto-cleanup; “Move”
      is copy + mark, purge is manual.
- [ ] **Security** — CORS allowlist and access/refresh tokens are done;
      DMs are still server-readable (no E2E); P2P without TURN.
- [ ] **Cost** — daily token budget is warning-only; add enforcement + per-task
      cap and a usage view.
- [ ] **Testing** — unit tests for media only; no API/UI integration or E2E.
- [ ] **Multi-device** — presence via socket only; offline DMs are not queued.
- [ ] **Design system** — `.icon-btn`/`.round`/`.btn`/`.ghost` rule added; older
      controls may still be inconsistent.

## Improvements (highest value first)
- [ ] **Background download jobs** — resumable, persisted per-file status.
- [ ] **Media retention & quota** — auto-clean old task folders.
- [ ] **Profile & notifications** — profile UI + DM unread.
- [ ] **Local model option** — Ollama / OpenAI-compatible config switch.
- [x] **Security pass** — CORS allowlist + rotating refresh tokens done;
      optional E2E for DMs still open.
- [ ] **Cost enforcement** — hard daily cap + per-task budget.
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
