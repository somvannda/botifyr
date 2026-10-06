# Botifyr — Development Guide

How to run what we've built, choose a model, and test it.

## Current status

| Milestone | State |
| --- | --- |
| **M0** — cloud + desktop walking skeleton | ✅ done |
| **M1** — real agent loop + browser use | ✅ done (keyless mock provider by default) |
| **M2** — per-task container isolation | ✅ verified (opt-in: `BOTIFYR_SANDBOX=docker`) |
| **M3** — desktop computer use + live framebuffer | ✅ verified |
| **M4** — accounts, Postgres persistence, encrypted vault, audit | ✅ verified |
| **M5** — messaging channels (local chat + Telegram) | ✅ verified (local) |
| **M6** — code & shell tools in an isolated sandbox | ✅ verified |

## Prerequisites

- **Node.js 20+** (developed on 24) and npm.
- **Rust + Tauri prerequisites** — only for the native desktop window.
  On Windows: MSVC Build Tools + WebView2. See
  [Tauri prerequisites](https://tauri.app/start/prerequisites/).
- Playwright's Chromium is installed automatically (`npx playwright install chromium`).
- Docker is available for the sandbox work that starts in M2.

## Install

From the repo root (npm workspaces — always install here):

```bash
npm install
npx playwright install chromium   # first time only
```

## Run it

### Terminal 1 — cloud service

```bash
npm run dev:cloud
# Botifyr Cloud listening on http://localhost:8787
```

### Terminal 2 — desktop UI

```bash
npm run dev:desktop        # http://localhost:1420 (browser preview, fastest)
# or
npm run dev:desktop:tauri  # native window (needs the MSVC toolchain)
```

Type any goal into the app. With the default (mock) provider it will drive a
real Chromium browser against the built-in demo page at
`http://localhost:8787/demo`, pause at an approval gate, then finish — and you'll
see live screenshots of the sandbox.

## Run with Docker (recommended, always on)

Runs Postgres **and** the cloud in containers, independent of any terminal:

```bash
npm run db:up                 # or: docker compose up -d --build
docker compose up -d --build  # builds + starts postgres + cloud
docker compose logs -f cloud
docker compose down           # stop (data is kept)
```

The cloud container:
- reads secrets from `apps/cloud/.env`,
- connects to `postgres` on the compose network,
- spawns **per-task sandbox containers** through the mounted Docker socket, on a
  shared `botifyr-net` network (addressed by container name),
- restarts automatically (`restart: unless-stopped`).

The desktop app connects to `http://localhost:8787` as usual.

## Conversations

A **conversation** (session) keeps a transcript. Sending a message appends your
turn, runs the agent with the **prior transcript as context**, then appends the
assistant's reply — so the model remembers earlier turns. The sidebar lists
conversations, and the running task's steps/approval/screen appear inline.

## Choosing a model (bring your own key)

Botifyr is **model-agnostic**. The provider is chosen from environment
variables on the **cloud** process. With no keys set it uses the keyless `mock`
provider, which replays a fixed script through the *real* loop and tools — great
for development and tests.

Set these before `npm run dev:cloud`:

| Variable | Meaning |
| --- | --- |
| `BOTIFYR_PROVIDER` | `mock`, `openai`, `openrouter`, `deepseek`, `groq`, or `ollama`. `auto` (default) picks one from whichever key is present. |
| `BOTIFYR_MODEL` | Override the preset model. |
| `BOTIFYR_API_KEY` | Explicit key (otherwise the preset's env var is used). |
| `BOTIFYR_BASE_URL` | Override the endpoint (e.g. a local server). |
| `BOTIFYR_DEMO_URL` | Where the mock provider points the browser. |
| `BOTIFYR_MAX_STEPS` | Step budget per task (default 12). |

Presets read the usual env vars: `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
`DEEPSEEK_API_KEY`, `GROQ_API_KEY`. Example (PowerShell):

```powershell
$env:BOTIFYR_PROVIDER="deepseek"
$env:DEEPSEEK_API_KEY="sk-..."
npm run dev:cloud
```

A local OpenAI-compatible server (Ollama / LM Studio / vLLM) works too:

```bash
BOTIFYR_PROVIDER=ollama BOTIFYR_MODEL=llama3.1 BOTIFYR_BASE_URL=http://localhost:11434/v1 npm run dev:cloud
```

## Browser isolation (sandboxes)

By default the browser runs in-process (`BOTIFYR_SANDBOX=local`) — fast to
iterate on, but **not isolated**. Set `BOTIFYR_SANDBOX=docker` and every task
gets its **own throwaway container** running headless Chromium; the container is
removed when the task ends. Nothing the agent does touches the cloud process's
filesystem, credentials, or network.

Build the image once (from the repo root):

```bash
docker build -t botifyr/browser-sandbox:1.63.0 infra/browser-sandbox
```

Then run with isolation on:

```bash
BOTIFYR_SANDBOX=docker npm run dev:cloud
```

How it works: the agent loop stays in the cloud, but browser tools call a small
HTTP action API inside the container (`infra/browser-sandbox/server.mjs`). The
container reaches the host's demo page via `host.docker.internal`. The same
`BrowserBackend` interface drives local and Docker modes, so the loop, providers,
and tools never change.

Verified end to end: in Docker mode the smoke test drove a containerized
Chromium (the container fetched `/demo` from `host.docker.internal`), produced a
screenshot, and was removed afterwards with no leftovers.

## Capabilities

The agent's tool set is chosen per deployment with `BOTIFYR_CAPABILITIES`
(comma-separated):

| Capability | Tools | Isolation |
| --- | --- | --- |
| `browser` | `browser.goto` · `extract` · `type` · `click` · `screenshot` | local or Docker |
| `computer` | `computer.screenshot` · `move` · `click` · `type` · `key` · `scroll` | Docker desktop |
| `code` | `shell.exec` · `file.read` · `file.write` · `file.list` | Docker code sandbox |

```bash
# desktop computer use inside a container
BOTIFYR_CAPABILITIES=computer BOTIFYR_SANDBOX=docker npm run dev:cloud
```

Both can be enabled at once (`browser,computer`). Consequential clicks are
approval-gated in both capabilities.

## Desktop computer use

Build the desktop image once (from the repo root):

```bash
docker build -t botifyr/desktop-sandbox:1 infra/desktop-sandbox
```

Each computer-use task gets its own container with a virtual X desktop
(Xvfb + openbox + xterm). The agent sees the screen through ffmpeg's `x11grab`
and drives it with `xdotool` (move / click / type / key / scroll). The desktop
service also exposes a live **MJPEG framebuffer**, which the cloud proxies at
`GET /v1/tasks/:id/stream` — so the app shows a live view of the isolated
desktop while the task runs (and falls back to the last screenshot when idle).

Verified end to end:
- a container-level test typed into the terminal and captured before/after
  frames (`docs/assets/desktop-before.png`, `docs/assets/desktop-after.png`);
- the agent smoke ran computer use with an approval gate on `computer.click`;
- `GET /v1/tasks/:id/stream` returned `multipart/x-mixed-replace` with a real
  JPEG frame, and the container was removed afterwards.

## Accounts, persistence, and secrets

- **Accounts** — email + password (scrypt hashes) with bearer tokens. `/auth/*`
  is public; everything under `/v1/*` and the websocket requires a token.
- **Persistence** — `BOTIFYR_STORE=memory` (default, zero setup) or `postgres`
  for durable, multi-user storage.
- **Secret vault** — secrets are encrypted with AES-256-GCM using
  `BOTIFYR_VAULT_KEY` *before* they reach the store, so plaintext never hits the
  database. This is the concrete fix for the "secrets not encrypted at rest"
  weakness seen in other open agents.
- **Audit log** — every tool run, approval gate, and task outcome is recorded
  and readable at `GET /v1/tasks/:id/audit`.

Run the database and start the cloud against it:

```bash
npm run db:up
BOTIFYR_STORE=postgres \
DATABASE_URL=postgres://botifyr:botifyr@localhost:54329/botifyr \
BOTIFYR_VAULT_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
npm run dev:cloud
```

Verified: in Postgres mode a task and its audit trail **survived a full cloud
restart**, and the `secrets` row held ciphertext (`is_plaintext = f`), not the
plaintext value.

> Without `BOTIFYR_VAULT_KEY` the cloud uses an ephemeral key and warns on
> startup; set it for anything durable.

## Channels

Reach the agent from a chat surface instead of the desktop app. A channel maps a
conversation to a session; each message starts a task, the agent asks for
approval **in the chat**, and you reply `allow` or `deny`.

- **local** — an authenticated HTTP chat, always on:
  - `POST /channels/local/messages { text }` → send a goal
  - `GET /channels/local/messages` → the conversation (inbound + outbound)
- **telegram** — turns on automatically when `TELEGRAM_BOT_TOKEN` is set. It
  uses long polling, so it needs no public URL.

Verified: the channel smoke test sent a goal, received
`Approval needed: Approve: browser.click` in the chat, replied `allow`, and got
the final result:

```bash
cd apps/cloud && node scripts/smoke-channels.mjs   # -> [channels] PASSED
```

Telegram is code-complete but not exercised here (no bot token); set the token
and message the bot to use it.

## Code & shell

Build the code image once:

```bash
npm run code:build      # docker build -t botifyr/code-sandbox:1 infra/code-sandbox
```

With `BOTIFYR_CAPABILITIES=code`, each task gets a throwaway container running
as a **non-root user** with a private `/workspace`. The agent can run commands
(`shell.exec`, approval-gated) and read, write, and list files. Commands run via
`sh -c`, capped at 60 s and 200 KB of output, and file paths cannot escape the
workspace.

```bash
BOTIFYR_CAPABILITIES=code BOTIFYR_SANDBOX=docker npm run dev:cloud
cd apps/cloud && node scripts/smoke-code.mjs     # -> [code] PASSED
```

Verified: the smoke test ran a real command inside the container (its output
contained `sandbox math: 42`), wrote a file, read it back, listed the workspace,
and the container was removed afterwards.

## Local node (operate your own computer)

The cloud sandboxes are isolated. To let Botifyr operate a browser on **your own**
machine, run a **node** there:

```powershell
$env:BOTIFYR_EMAIL="you@example.com"
$env:BOTIFYR_PASSWORD="your password"
npm run node:start
```

The node connects outbound to the cloud, launches a **visible Chromium**, and
exposes `local.browser.*` tools to your account. Those tools exist only while
your node is connected, and local clicks require approval. Set
`BOTIFYR_NODE_HEADLESS=1` to run the browser off-screen.

The app's **Computer** button shows whether a node is connected. Verified: with a
node connected, the agent used `local.browser.goto` → `local.browser.extract`
and returned the page's h1.

### Browser-based sign-in (Grok Bot style)

The app opens your browser for sign-in and picks up the session afterwards —
Google only, no email/password in the app:

```
Desktop "Sign in" → browser opens /auth/google → Google consent
   → cloud issues a token → desktop polls /auth/google/result and stores it
```

Set up a Google OAuth client:

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
2. Add an **Authorized redirect URI**: `http://localhost:8787/auth/google/callback`.
3. Put the values in `apps/cloud/.env`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8787/auth/google/callback
```

Then `docker compose up -d cloud`. `/auth/config` reports `{"google":true}` when configured.
(Email/password endpoints still exist for scripts/tests; the app UI is Google-only.)

### Drive your real Chrome (CDP attach)

The node prefers, in order: (1) attach to an already-running Chrome that has
remote debugging on, (2) launch your Chrome profile, (3) a fresh profile. To use
your real tabs/logins:

```bash
# 1. Fully quit Chrome (windows + background process), then:
npm run chrome:debug      # starts Chrome with --remote-debugging-port=9222 + your profile
```

On the next browser step the node attaches over CDP, opens its **own new tab**
(leaving your tabs alone), and drives your real Chrome. Env knobs:
`BOTIFYR_NODE_CDP` (endpoint), `BOTIFYR_NODE_NO_CDP=1` (disable), `BOTIFYR_CDP_PORT`.

## Smoke test

With the cloud running:

```bash
cd apps/cloud
node scripts/smoke.mjs
```

It creates a session, opens the event stream, hands off a task, approves the
approval gate, and verifies a PNG screenshot was captured. Expected final line:
`[smoke] PASSED`.

For a computer-use cloud (with a desktop image), also verify the live stream:

```bash
BOTIFYR_CAPABILITIES=computer BOTIFYR_SANDBOX=docker npm run dev:cloud   # terminal 1
cd apps/cloud && node scripts/verify-stream.mjs                          # terminal 2
```

Saved proof from a real run: `docs/assets/m1-browser-screenshot.png`.

## What Milestone 1 does

```
desktop (React)  ──REST──►  cloud API (Fastify)
       ▲                          │
       │                          ▼
       │                   runAgent()  ──►  ModelProvider (mock | openai-compatible)
       │                          │
       └──── WebSocket + ◄────────┤
             screenshots          └──►  Tools: Playwright browser
```

- **Agent loop** (`packages/agent-core/src/agent.ts`): plan → act → observe,
  step budget, approval gates, progress callbacks.
- **Providers** (`packages/agent-core/src/providers`): a keyless `mock` provider
  and one OpenAI-compatible adapter that covers OpenAI, OpenRouter, DeepSeek,
  Groq, and local servers.
- **Browser tool** (`packages/agent-core/src/tools/browser.ts`): Playwright
  `goto`, `extract`, `type`, `click` (approval-gated), `screenshot`, with a PNG
  snapshot after each mutating action.
- **Cloud** wraps the loop, streams steps/approvals, and stores the latest
  screenshot. **Desktop** renders the live screen.

## What is still stubbed (M2+)

| Area | Now | Next |
| --- | --- | --- |
| Browser isolation | Per-task container (opt-in) | microVM, egress allowlist |
| Desktop computer use | Per-task container + live stream | policy/approval rules for keys + typing |
| Code & shell | Per-task container, approval-gated exec | CPU/memory limits, egress allowlist |
| Persistence | memory or Postgres | migrations, backups |
| Accounts | Email + bearer tokens | OAuth, MFA, teams/RBAC |
| Secret vault | AES-256-GCM at rest | per-user KMS, automatic tool injection |
| Channels | local chat + Telegram | Slack, WhatsApp, Discord |
| Mobile / voice | None | Later milestones |

## API reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness. |
| `GET` | `/v1/config` | Active provider, capabilities, sandbox, store (and whether the demo model is on). |
| `GET` | `/demo` | Built-in page the agent can operate. |
| `POST` | `/v1/sessions` | Create a session. |
| `GET` | `/v1/sessions/:id` | Read a session. |
| `POST` | `/v1/sessions/:id/tasks` | Hand off a goal (`{ goal }`). |
| `GET` | `/v1/sessions` | List your conversations. |
| `POST` | `/v1/sessions/:id/messages` | Send a chat message (appends to the thread, runs the agent with context). |
| `GET` | `/v1/tasks/:id` | Read a task (includes `screenshotAt`). |
| `GET` | `/v1/tasks/:id/screenshot` | Latest sandbox screenshot (PNG). |
| `GET` | `/v1/tasks/:id/stream` | Live MJPEG framebuffer of a computer-use task's desktop. |
| `GET` | `/v1/tasks/:id/audit` | Task audit log (tool runs, approvals, outcome). |
| `POST` | `/auth/signup` | Create an account; returns a bearer token. |
| `POST` | `/auth/login` | Log in; returns a bearer token. |
| `POST` | `/auth/logout` | Revoke the current token. |
| `GET` | `/auth/me` | Current account. |
| `POST` | `/v1/secrets` | Store an encrypted secret (`{ name, value }`). |
| `GET` | `/v1/secrets` | List secret names (never values). |
| `DELETE` | `/v1/secrets/:id` | Delete a secret. |
| `POST` | `/channels/local/messages` | Send a goal over the authenticated chat channel. |
| `GET` | `/channels/local/messages` | The chat conversation (inbound + outbound). |
| `POST` | `/v1/tasks/:id/approvals/:approvalId` | Resolve an approval (`{ decision }`). |
| `WS` | `/v1/stream` | Realtime `ServerEvent` stream. |
| `WS` | `/v1/node` | Local node connection (operate the user's own machine). |

Shared types: [`packages/shared`](../packages/shared).

## Repo layout

```
apps/
  cloud/        Fastify API + WebSocket + runner + store/ (memory | postgres)
  desktop/      Tauri 2 + React client (the window)
packages/
  agent-core/   provider-agnostic agent loop, providers, tools (local + docker)
  channels/     channel framework (local chat + Telegram)
  shared/       TypeScript contracts shared everywhere
infra/
  browser-sandbox/  Dockerfile + service for per-task browser isolation
  desktop-sandbox/  Dockerfile + service for per-task virtual desktops
  code-sandbox/     Dockerfile + service for per-task code/shell execution
docker-compose.yml    Postgres for the durable store
docs/           research, blueprint, assets
```
