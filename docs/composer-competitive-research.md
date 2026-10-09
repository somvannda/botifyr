# Content Composer — Competitive Research

> Owner: **Composer Manager** (Feed Experience Team). Companion docs:
> `docs/composer-ux-audit.md`, `docs/composer-implementation-plan.md`.
> Scope: the **post composer** (text + media + destination/audience + scheduling +
> publish lifecycle). Story and Reel *viewing* belong to the Stories/Reels
> Managers; their creation requirements are noted only where they cross over.

## Method & honesty note

Patterns below come from two sources, kept separate on purpose:

- **[Docs]** — public help-center / support documentation located with web
  search during this task (links given). These describe what the products say
  they do.
- **[Knowledge]** — well-known product behaviour from general knowledge. These
  were **not** re-inspected live in this task and may have changed.

I did **not** run the live apps or capture their network traffic for this
document. Where a pattern is asserted from memory it is marked **[Knowledge]**.

The existing `docs/reels-competitive-research.md` covers short-video creation
(TikTok/Reels/Shorts) in more depth; this doc stays on the shared composer.

---

## 1. Patterns worth adopting

### P1 — One composer, many destinations
**[Knowledge]** Facebook's composer lets you choose "post as" (profile vs a Page
you manage) and an **audience** ("Public / Friends / Only me…") from the same
surface. The audience selector is a first-class control, not a hidden setting.
**[Docs]** Facebook's audience selector help: options "may include: Public…
Friends…" — https://www.facebook.com/help/211513702214269.

- *Why it helps:* users publish to the right place without a separate screen;
  the destination is visible before sending.
- *Fits Botifyr?* Yes — the backend already supports `pageId`, `audience`
  (`public | friends | only_me`), and `groupId`. The composer already exposes
  these; they need to be clearer and reset safely after publish.
- *How:* keep the inline composer; make the destination a labelled, sticky
  summary line; reset `postAs`/`audience` to safe defaults after a successful
  send so the next post can't accidentally repeat a Page post.

### P2 — Explicit publish lifecycle (idle → uploading → publishing → done/failed)
**[Knowledge]** Instagram/Facebook show a progress ring while media uploads,
then a "Posting…" state, then a success confirmation; the button is disabled
throughout so a double-tap cannot post twice.
**[Docs]** Meta Business Suite distinguishes Save-as-draft / Schedule / Post,
and lets you move a scheduled post back to drafts —
https://www.facebook.com/business/help/2223502627919449.

- *Why it helps:* large media takes time; without feedback users retry and
  create duplicates.
- *Fits Botifyr?* Yes. Today the button only flips to "Saving…" with no upload
  phase or progress.
- *How:* a small state machine on the composer — `idle | uploading(n/total) |
  publishing | failed` — with a `role="progressbar"` and a disabled submit.

### P3 — Drafts that survive navigation, with an explicit discard
**[Docs]** LinkedIn auto-populates the last draft when you reopen "Create a
post", and offers **Discard** — https://www.linkedin.com/help/linkedin/answer/a767101.
**[Knowledge]** Drafts are per-device and unsynced (a known user pain point).

- *Why it helps:* the biggest content-loss risk is losing typed text.
- *Fits Botifyr?* Partly. There is no draft API. The exposed UI state already
  survives in-app sub-navigation (Reels/Page/Group) because it lives in
  `FeedView`. It is lost on tab switch/reload.
- *How:* persist **text only** to `localStorage` (media data-URLs are far too
  large and would exceed quota / leak), clear on successful publish, and show a
  subtle "Draft restored — Discard" affordance. Documented as opt-out-able.

### P4 — Media preview with removal before send
**[Knowledge]** All major composers show thumbnails of attached media with an
`×` to remove, before publishing. Instagram adds alt text in an "Advanced
Settings" step **[Docs]** —
https://help.instagram.com/503708446705527/.

- *Why it helps:* users catch the wrong file before it is public.
- *Fits Botifyr?* Yes — thumbnails already exist; they need a clear type badge
  and a correct accessible name (currently "Remove image" even for video).
- *How:* keep the 2/3/4-up grid; add a "Video" badge; label removes by file.

### P5 — Client limits that match the server
**[Knowledge]** Mature composers reject oversized files client-side and state
the exact limit so the upload never starts.

- *Why it helps:* avoids a long upload that is guaranteed to fail.
- *Fits Botifyr?* **No today** — the client allows 25 MB videos but the server
  (`/v1/uploads`) rejects anything over 15 MB. This is a real bug (see audit).
- *How:* one shared constant that mirrors the server guard, shown in the error.

### P6 — Scheduling validates the future
**[Docs]** Facebook schedules to a future date/time up to 75 days out —
https://www.facebook.com/business/help/1670877163254487. **[Knowledge]** Picking
a past time is rejected or snaps the post to "now".

- *Why it helps:* "Schedule" must not silently become "post now".
- *Fits Botifyr?* The backend drops past `scheduledAt` and publishes immediately.
  The composer must warn instead of silently changing intent.
- *How:* validate `scheduledAt > now` before submitting; show an inline error.

### P7 — Accessible media-alt / captions
**[Docs]** Alt text guidance: descriptive, ~100–125 chars, no formatting —
https://www.facebook.com/government-nonprofits/blog/using-alt-text-for-accessible-content.

- *Why it helps:* blind/low-vision users get the image content.
- *Fits Botifyr?* Not yet — there is no alt-text field or `alt` storage. This is
  a **server dependency** (new column/DTO), so it is documented, not built.

---

## 2. Patterns deliberately not adopted

| Pattern | Why not here |
| --- | --- |
| Rich text / WYSIWYG composer | The `body` field is plain text; posts render via `PostBody` (plain + linkify). Adding rich text would change the Post contract owned by the Post Manager. |
| Inline poll/event/gif pickers beyond current support | Only `poll` is backed by the server; extra pickers would be dead controls. |
| Base64-independent presigned multipart uploads | `/v1/uploads` is a base64 JSON endpoint (see audit). Changing it is an API/contract change needing Lead sign-off. |
| Auto-save to a server draft | No draft table/endpoint exists. |
| Audience options beyond `public/friends/only_me` | The server only understands those three. |

---

## 3. Source links captured

- Facebook audience selector — https://www.facebook.com/help/211513702214269
- Facebook post composer for creators — https://www.facebook.com/business/help/1670877163254487
- Meta Business Suite save/schedule/reschedule — https://www.facebook.com/business/help/2223502627919449
- Instagram alt text — https://help.instagram.com/503708446705527/
- Alt-text writing guidance — https://www.facebook.com/government-nonprofits/blog/using-alt-text-for-accessible-content
- LinkedIn save a post as a draft — https://www.linkedin.com/help/linkedin/answer/a767101
- LinkedIn page draft / Cancel/confirm — https://www.linkedin.com/help/linkedin/answer/a1344671

## 4. Recommendations applied (summary)

1. Match the client media limit to the server (P5) — **done**.
2. Explicit upload/publish progress + duplicate-submit guard (P2) — **done**.
3. Reset destination/audience after publish (P1) — **done**.
4. Validate scheduled time (P6) — **done**.
5. Text-only draft persistence with Discard (P3) — **done**.
6. Clear per-file removal labels + type badge (P4) — **done**.
7. Alt text (P7) — **backlogged** (needs a server field).
