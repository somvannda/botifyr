# Botifyr

**Botifyr** is an AI agent that gets real work done — on the web, on a computer,
and through the tools and apps you already use. It is "a bot for you": you give
it a goal, it plans, operates software, and comes back when the job is finished
or when it needs your approval.

This repository contains a working **agent (Milestones 1–6)**: a Tauri 2 +
React desktop app (the window) talking to a cloud service (the brain and hands)
that runs a model-agnostic plan → act → observe loop with real **browser use**,
**desktop computer use**, and **code/shell use**, each inside a **throwaway
container per task** with a live framebuffer stream — backed by **accounts,
Postgres persistence, an encrypted secret vault, and an audit log**, and
reachable over **messaging channels** — plus the **research and product
blueprint**.

It runs **with no API key** (a keyless mock provider), and swaps to OpenAI,
OpenRouter, DeepSeek, Groq, or a local model via environment variables.

## Documentation

| Doc | What's inside |
| --- | --- |
| [docs/competitive-analysis.md](docs/competitive-analysis.md) | What Grok Bot, OpenClaw, and Muse actually are, a feature matrix, and a SWOT for each. |
| [docs/botifyr-blueprint.md](docs/botifyr-blueprint.md) | The proposed architecture, capability map, tech stack, roadmap, and MVP definition for Botifyr. |
| [docs/development.md](docs/development.md) | How to install, run, and test what's built; what is real vs. stubbed. |
| [docs/cost-controls.md](docs/cost-controls.md) | Product runtime cost limits (rate limit, token caps, daily budget). |
| [AGENTS.md](AGENTS.md) | Guidance for AI coding agents to minimise development cost/context. |

## Quick start

```bash
npm install

# Everything (Postgres + cloud) in Docker — always on:
docker compose up -d --build
# …or run the cloud locally in a terminal:
npm run dev:cloud        # http://localhost:8787

# The desktop app (window):
npm run dev:desktop      # http://localhost:1420 (browser preview)
# or: npm run dev:desktop:tauri   # native window
```

With the cloud running, verify the whole loop:

```bash
cd apps/cloud && node scripts/smoke.mjs   # -> [smoke] PASSED
```

See [docs/development.md](docs/development.md) for details.

## Project structure

A single npm-workspace monorepo: **apps/** are runnable/deployable, **packages/**
are dependency-light libraries they import.

```
botifyr/
├─ apps/
│  ├─ cloud/       Fastify API + agent runner + Postgres (the "brain")
│  ├─ desktop/     Tauri 2 + React window (Vite front end, Rust shell)
│  ├─ node/        Local helper on your machine (its own browser + shell)
│  └─ web/         Marketing + help site (static, our own domain content)
├─ packages/
│  ├─ agent-core/  Provider-agnostic agent loop, tools, model providers
│  ├─ channels/    Messaging channels (local API, Telegram)
│  └─ shared/      Cross-app contracts (types imported everywhere)
├─ infra/          Per-task Docker images (browser / desktop / code sandboxes)
├─ docs/           Blueprint, competitive analysis, development guide
├─ scripts/        Developer tooling
└─ assets/         Brand source (logo)
```

**Conventions**

- Cross-app types live in `@botifyr/shared` — apps never redeclare them.
- Secrets are never committed: `.env` is ignored, `.env.example` documents the keys.
- Per-task sandboxes are separate Docker images under `infra/`, built via `npm run *:build`.
- Typecheck everything with `npm run typecheck`; CI runs it on every push/PR.
- Lint with `npm run lint`, format with `npm run format`, test with `npm test`.
- Node 22 (`.nvmrc`); formatting rules in `.editorconfig` + `.prettierrc`.

## TL;DR

The market has split into two camps:

- **Closed, managed, easy** — Grok Bot (xAI/ SpaceXAI) and Muse (Meta). Cloud
  computers, polished UX, vendor lock-in, no self-hosting, trust concerns.
- **Open, self-hosted, powerful, risky** — OpenClaw. Runs on your machine,
  model-agnostic, huge ecosystem, but security is not on by default.

**Botifyr's wedge:** be *open and self-hostable like OpenClaw*, but *safe by
default and easy like Grok Bot/Muse* — with **broader hands** (browser + desktop
computer use + code + mobile + APIs + voice) and **per-task isolation** instead
of one shared machine.

> Research current as of **October 5, 2026**. This space moves fast — re-verify
> pricing and feature claims before committing to a plan.
