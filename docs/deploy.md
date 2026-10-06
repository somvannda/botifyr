# Deploying Botifyr

Three deployables: **web** (marketing + help, static), **cloud** (Fastify API + agent
runner), and the **desktop** app (Tauri, built and shipped to users). Postgres backs
the cloud.

The provided `docker-compose.yml` runs the server-side pieces:

| Service | Image | Port (host) | Notes |
| --- | --- | --- | --- |
| `postgres` | `pgvector/pgvector:pg16` | `54329` | data in volume `botifyr-pg` |
| `cloud` | `apps/cloud/Dockerfile` | `8787` | reads `apps/cloud/.env`; needs the Docker socket |
| `web` | `apps/web/Dockerfile` (nginx) | `${WEB_PORT:-4322}` | static site; `/help` → `help.html` |

## 1. The web site (`botifyr.xyz`)

```bash
docker compose up -d --build web      # http://localhost:4322
```

Point your DNS `A`/`CNAME` for `botifyr.xyz` at the host, and put TLS in front (Caddy,
Traefik, or nginx). The container serves `/` and `/help`; add `WEB_PORT=80` (or map
behind a reverse proxy) as needed.

Minimal Caddy example:

```
botifyr.xyz {
  reverse_proxy localhost:4322
}
```

## 2. The cloud (`api.botifyr.xyz`)

1. Create `apps/cloud/.env` (copy `.env.example`) and set at minimum:
   - `BOTIFYR_STORE=postgres`, `DATABASE_URL`, `BOTIFYR_VAULT_KEY`
   - the model provider (`BOTIFYR_PROVIDER` + `BOTIFYR_API_KEY`)
   - Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
     `GOOGLE_REDIRECT_URI` and `GOOGLE_CONNECT_REDIRECT_URI`
2. `docker compose up -d --build cloud`
3. Put TLS in front of `8787` and set the same hostname in `VITE_CLOUD_URL` when
   building the desktop app.

### Media retention & quota

Downloads live on the `botifyr-downloads` volume. The cloud sweeps it on boot
and every `BOTIFYR_MEDIA_CLEANUP_MINUTES` (default 360):

- `BOTIFYR_MEDIA_RETENTION_DAYS` (default 30) — delete a task's files this many
  days after their last activity. `0` keeps them forever.
- `BOTIFYR_MEDIA_QUOTA_MB` (default 0 = unlimited) — when the volume grows past
  this, the oldest task folders are removed first.

Set both to `0` to disable automatic cleanup entirely. Removing a task's files
also clears its entries from the media manifest.

### Optional: billing (Stripe)

Plans are `trial` (default) and `pro`. Stripe is off unless configured:

- `STRIPE_SECRET_KEY` — Stripe secret key
- `STRIPE_PRICE_ID` — the recurring price to sell
- `STRIPE_WEBHOOK_SECRET` — shared secret checked on `/v1/billing/webhook`
  (point Stripe at it for `checkout.session.completed` and
  `customer.subscription.deleted`)

Without these, the app still shows the current plan and explains that billing
isn't configured. Admins can set a plan directly:
`POST /admin/users/:id/plan` with `{ "plan": "pro" }`.

Google Cloud: add these **Authorized redirect URIs** to the OAuth client:
- `https://<cloud-host>/auth/google/callback` (sign-in)
- `https://<cloud-host>/auth/google/connect/callback` (Connect apps)

## 3. The desktop app

```bash
VITE_CLOUD_URL=https://api.botifyr.xyz npm run tauri -w @botifyr/desktop -- build
```

Installers land in `apps/desktop/src-tauri/target/release/bundle/`. The installer
registers the `botifyr://` deep link so the web "Open Botifyr" button works.

## Local (development)

```bash
docker compose up -d --build cloud   # brain
npm run dev:web                      # http://localhost:4321
npm run dev:desktop:tauri            # app window
```
