# Self-learning media extractors

Can the bot teach itself to extract from sites `yt-dlp` doesn't support
(DramaBox, Hongguo, GoodShort, ShortMax, NetShort, QQTV, DramaWave, FreeReels,
RaptDrama, ReelLife, ShortFlix, DramaTV, DotDrama, iDrama, …)? **Partly — yes.**
This is the design.

## What already works

- **yt-dlp** handles YouTube and many sites natively.
- A **generic fallback** in `packages/agent-core/src/tools/media.ts`: when yt-dlp
  fails on a page, the tool fetches the HTML and pulls an `m3u8`/`mp4` URL out of
  it — including **JSON-escaped** URLs (`https:\/\/…`) and the common player keys.
- A **self-learning skills library** (`apps/cloud/src/skills.ts`,
  `learned-skills-tools.ts`) with **admin moderation**, so the bot can record a
  reusable procedure a human approves.

## What self-learning adds

A **recipe** per domain, learned once and reused deterministically:

```
recipe = {
  domain:   "goodshort.com",
  pattern:  "https?://[^\"']+\\.(m3u8|mp4)",   // where the stream URL lives
  headers?: { Referer: "...", "User-Agent": "..." },
  status:   "pending" | "approved" | "rejected"
}
```

### Two ways a recipe is learned

1. **Network sniffing (primary).** `yt-dlp`/HTML fails → the bot opens the page
   in its **browser sandbox**, plays the video, and reads the network log for the
   first media response (`m3u8`/`mp4`/`ts`). It distills the URL shape into a
   `pattern`, records the headers seen, and proposes a recipe.
2. **Model reasoning (fallback).** The bot reads the page source / inline JSON and
   proposes a regex for the embedded `playUrl`.

The proposed recipe becomes a **learned skill** (`status: pending`) → visible in
**admin → Learned skills / Billing** for approval. Approved recipes are indexed by
domain and **auto-applied**: the next download from that domain matches the pattern
and downloads the stream with `ffmpeg`/`yt-dlp`, with the recorded headers.

## Pipeline

```
download(domain) ──► yt-dlp ──ok──► done
                        │fail
                        ▼
              recipe for domain? ──yes──► fetch + match pattern + headers ──► ffmpeg/yt-dlp
                        │no
                        ▼
        generic sniffer (HTML + JSON-escaped URLs) ──ok──► done
                        │fail
                        ▼
        bot: browser sandbox → sniff network → propose recipe (pending)
                        ▼
                admin approves → cached for the domain
```

## Guardrails

- Recipes are **data, not code** (a regex + headers) — no arbitrary shell from the
  model. The tool only runs `yt-dlp`/`ffmpeg` on a URL that **matches the recipe**.
- **Tested before approval**: a recipe must download one sample successfully; the
  admin sees the result. (Same moderation path as learned skills.)
- **DRM-protected** streams (Widevine) cannot be handled — recipes won't help.
- Some apps use **short-lived signed tokens**; a recipe still needs a fresh page
  fetch to mint the URL, which the pipeline does each run.

## Phased plan

1. ✅ **Generic sniffer hardening** (JSON-escaped URLs, more patterns) — done.
2. **Recipe registry** — `media_recipes` store (`domain`, `pattern`, `headers`,
   `status`, `createdBy`) + a `media.extract` tool that, on a yt-dlp miss, fetches
   the page and matches an approved recipe (or the generic patterns), then downloads
   via `ffmpeg`/`yt-dlp` with the headers.
3. **Learning loop** — a `media.learn_recipe` tool the bot calls after sniffing;
   saved `pending`, surfaced in admin moderation, auto-applied once approved.
4. **Browser network sniffing** — expose the sandbox page's network log to the bot
   so it can find the real media request without hand-held patterns.

## Validated sites

### GoodShort (`goodshort.com`) — **works**
- Show page: `https://www.goodshort.com/drama/<slug>-<id>`
- Episode page: `https://www.goodshort.com/episode/<slug>/<NNN>-<id>` — **auto-loads the player**.
- The stream is an **HLS playlist** on `v3.goodshort.com/…/origin1/<hash>.m3u8` (signed, `?expiredTime=…`).
- ⚠️ The `m3u8` is **not in the page HTML** (it's fetched by JS), so an HTML-`grep` recipe won't find it.
  **Use `browser.sniff`:** open the episode page, then sniff → download the captured `.m3u8`.

Verified: `node apps/cloud/scripts/sniff.mjs "https://www.goodshort.com/episode/…/001-…" --wait 12000`
→ captured the m3u8 + all `.ts` segments.

**Implication:** for these SPA players, the flow is `browser.goto(episode) → browser.sniff → youtube.download(m3u8)`,
not a static extractor. A future "sniff recipe" (domain → auto-sniff) would make it one-shot.

## Researched domains (starting points for recipes)

| Platform | Web home | Notes |
| --- | --- | --- |
| DramaBox | `https://www.dramabox.com` (also `dramabox.co.uk`, `dramaboxapp.com`) | SSR SPA; media via CDN/API |
| GoodShort | `https://www.goodshort.com` | Vue SSR; assets on `acfs3.goodshort.com`; media via JSON |
| NetShort | `https://netshort.com` | SPA |
| ShortMax | `https://www.shorttv.live` | SPA |
| DramaWave | `https://mydramawave.com` | app-first; site may be thin |
| FreeReels | `https://free-reels.com` | app-first |
| iDrama | `https://www.idrama.video` | app-first |
| ReelShort | `https://www.reelshort.com` | SPA (often already works) |
| ShortFlix | `https://www.shortflix.net` | fan library, web-first |
| Hongguo (红果), QQTV, RaptDrama, ReelLife, DramaTV, DotDrama | app-only / region-locked | may have no usable web player |

**Takeaway:** these sites are **SPA/API-driven** — the media URL is fetched over XHR/JSON,
not present in the initial HTML, so the generic HTML sniffer usually won't find it.
That's exactly what the recipe + network-sniffing approach is for: point the bot's
browser at a show page, capture the media request, and store the pattern.

**Next concrete step:** run one of these home URLs through the bot's browser sandbox
with network capture (phase 4), distill the first media request into a recipe, and
verify a download. `goodshort.com` and `netshort.com` are the best first targets
(web-first, English).

## Legal note

Extracting from third-party apps may breach their terms of service. Recipe support
is a **tool capability**; using it against a given site is the operator's decision.
