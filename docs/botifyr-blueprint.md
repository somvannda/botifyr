# Botifyr — Build Blueprint

> A plan for building Botifyr: an AI agent with many "hands" (browser use,
> computer use, code, mobile, APIs, voice) that is **open and self-hostable**
> like OpenClaw, **safe by default** like Muse's Sentinel model, and **easy**
> like Grok Bot — without locking users into one cloud or one model.

See [competitive-analysis.md](competitive-analysis.md) for the market context.

---

## 1. Product thesis

> **Give everyone a trustworthy bot that can operate any software, for any task,
> on any surface — and prove what it did.**

Three promises:

1. **Breadth** — one agent that can browse, click, type, run code, call APIs,
   drive a desktop, and (later) a phone.
2. **Trust** — isolated execution per task, encrypted secrets, approval gates,
   and a human-readable audit trail of every action.
3. **Openness** — self-host for free, bring your own model, swap any component,
   and never be locked to a vendor.

**Positioning line:** *"OpenClaw's power, Muse's safety, Grok Bot's ease."*

---

## 2. Capability map

| Capability | Description | Phase |
| --- | --- | --- |
| **Chat / reasoning** | Plan, ask clarifying questions, summarize, report back. | P1 |
| **Browser use** | Navigate, read DOM + accessibility tree + screenshots, click, type, extract. | P1 |
| **Code & shell** | Run scripts/commands in a sandbox for "glue" work and data tasks. | P1 |
| **Files** | Read/write a per-user workspace; attach outputs to chat. | P1 |
| **Memory** | Short-term context + long-term vector/structured memory + preferences. | P1 |
| **Skills / routines** | Teach-a-task (record → replay) and declarative `SKILL.md`. | P1–P2 |
| **Connectors / MCP** | Structured access to Gmail, Calendar, GitHub, Notion, etc. | P2 |
| **Computer use (desktop)** | Isolated virtual desktop: screenshot + mouse/keyboard control. | P2 |
| **Scheduling / proactivity** | Cron, triggers, webhooks, "work while you're away". | P2 |
| **Messaging channels** | WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams. | P2 |
| **Multi-agent orchestration** | Supervisor + specialists that hand off work. | P3 |
| **Mobile use** | Drive an Android emulator/app via ADB. | P3–P4 |
| **Voice** | Realtime speech in/out. | P4 |
| **Skills marketplace** | Vetted, scanned skills/plugins with revenue share. | P3 |

---

## 3. Architecture

```
                       ┌──────────────────────────────────────────────┐
   Interfaces          │  Web app · Desktop · Mobile · Chat channels   │
   (how users reach it)│  Voice · CLI · API/SDK · Email address        │
                       └──────────────────────┬───────────────────────┘
                                              │
                       ┌──────────────────────▼───────────────────────┐
   Orchestration       │  Gateway / Orchestrator (local or cloud)      │
   (the brain)         │  • Session + task state  • Planner/executor   │
                       │  • Model router (BYO model)  • Memory          │
                       │  • Skill loader  • Scheduler / triggers        │
                       └───────┬──────────────┬───────────────┬────────┘
                               │              │               │
                 ┌─────────────▼───┐  ┌───────▼──────┐  ┌─────▼────────┐
   Safety          │ Policy engine   │  │ Secret vault │  │ Audit log /  │
   (the guardrails)│ + approvals     │  │ (encrypted)  │  │ replay       │
                 └─────────┬───────┘  └──────┬───────┘  └─────┬────────┘
                           │                 │                │
                 ┌─────────▼─────────────────▼────────────────▼────────┐
   Execution       │  Ephemeral, isolated sandboxes (one per task)      │
   ("the hands")   │  ┌────────┐ ┌─────────────┐ ┌───────┐ ┌─────────┐  │
                   │  │Browser │ │Desktop (VM) │ │ Code  │ │ Mobile  │  │
                   │  │Playwr. │ │ VNC + OS    │ │ Docker│ │ Android │  │
                   │  └────────┘ └─────────────┘ └───────┘ └─────────┘  │
                   │  + Connectors/MCP for structured tools             │
                   └────────────────────────────────────────────────────┘
```

### 3.1 Orchestration ("the brain")

- **Planner / executor loop**: goal → plan → act (tool call) → observe →
  reflect → repeat, with a step budget and cost budget.
- **Model router**: per-task model choice (frontier model for planning, cheaper
  vision model for repetitive clicking, local model for private data). BYO keys.
  Never hard-code one vendor.
- **Memory**:
  - *Working*: conversation + current task state.
  - *Episodic*: past task runs (for "do it like last time").
  - *Semantic*: vector store of facts, people, projects, preferences.
  - *Procedural*: **skills/routines** learned from demonstration.
- **Scheduler**: cron, event triggers (new email, webhook), heartbeats for
  proactive work.

### 3.2 Safety ("the guardrails") — the moat

- **Policy engine**: per-tool, per-domain, per-action rules. Defaults:
  read-only first; **deny by default for consequential actions** (send, pay,
  delete, publish, post); explicit allow once / always / deny.
- **Approval gates**: pause and ask a human for money, messages, deletions,
  identity, 2FA, CAPTCHA, and anything irreversible.
- **Secret vault**: credentials and tokens **encrypted at rest** (per-user KMS),
  injected into the tool call without ever entering the model context. (This
  fixes OpenClaw's biggest documented weakness.)
- **Sentinel-style supervisor**: a second, cheaper model that reviews planned
  actions against policy and flags risky/looping behavior before execution.
- **Prompt-injection defense**: treat all web/page/tool content as **untrusted**;
  never let fetched content issue instructions; strip/neutralize instructions
  in retrieved text; constrain the agent to a declared task.
- **Audit trail**: every action recorded, replayable, and exportable.
- **Isolation**: **one ephemeral sandbox per task** (fresh filesystem, fresh
  browser profile, ephemeral network egress allowlist). Tear it down after.
  This is the concrete upgrade over Grok Bot's shared machine.

### 3.3 Execution ("the hands")

- **Browser use** — Playwright/CDP. Hybrid perception: accessibility tree + DOM
  for precision, screenshots + a vision model as fallback (and for canvas/visual
  apps). Set-of-Marks prompting. Per-task isolated browser context.
- **Computer use (desktop)** — a containerized/VM desktop (Linux + virtual
  display + VNC) driven by screenshot → coordinate/typing actions. Later: macOS
  and Windows desktops. Use microVMs (Firecracker) or gVisor for isolation;
  managed alternatives (E2B, Daytona, cloud desktops) to move fast.
- **Code** — sandboxed containers with CPU/memory/time/network limits.
- **Mobile** — Android emulator + ADB (later).
- **Connectors / MCP** — prefer structured APIs over clicking when available
  (more reliable + auditable).

---

## 4. Tech stack (recommended)

| Layer | Choice | Why |
| --- | --- | --- |
| Core / gateway | **TypeScript (Node)** | Matches OpenClaw + MCP ecosystem; great async I/O; easy plugin SDK. |
| Browser use | **Playwright** + CDP | Best-in-class automation, accessibility tree access. |
| Computer use | Container/VM (Docker + Xvfb + VNC) or E2B/Daytona | Isolation + speed to market. Python/OpenCV helpers for vision. |
| Model layer | **provider-agnostic** (AI SDK / LiteLLM-style router) | BYO model; no lock-in. |
| Memory | **Postgres + pgvector**, Redis for queues | Boring, proven, self-hostable. |
| Queue / jobs | **BullMQ** or **Temporal** | Durable long-running tasks. |
| Secrets | AES-256-GCM vault + per-user KMS keys | "Encrypted at rest" by default. |
| Frontend | **Next.js + React** | Fits the `botifyr.xyz` web surface. |
| Sandbox | Docker/gVisor now → Firecracker microVMs later | Isolation is the moat. |
| Packaging | Docker Compose (self-host) + managed cloud | Open to run, easy to buy. |

**Monorepo layout (suggested)**

```
botifyr/
├─ apps/
│  ├─ web/          # Next.js app + API
│  ├─ desktop/      # optional Electron/Tauri shell
│  └─ cli/
├─ packages/
│  ├─ core/         # orchestrator, planner, model router, memory
│  ├─ tools/        # browser, computer, code, files, connectors
│  ├─ sandbox/      # isolation + lifecycle
│  ├─ policy/       # policy engine, approvals, audit
│  ├─ secrets/      # vault
│  ├─ skills/       # skill format, loader, recorder
│  └─ sdk/          # plugin + public SDK
├─ infra/           # docker-compose, Dockerfiles
└─ docs/
```

---

## 5. Roadmap

### Phase 0 — Foundations (this doc)
Architecture, threat model, model/tool interfaces, repo scaffold, CI.

### Phase 1 — MVP: the browser agent (ship something real)
- Web chat UI + CLI.
- Planner/executor loop with a step + cost budget.
- **Browser use** via Playwright with hybrid perception.
- Sandboxed code + file workspace.
- Memory (working + a simple vector store).
- **Policy engine + approval gates + audit log**.
- Encrypted secret vault.
- 2–3 connectors (e.g., Gmail, Calendar, GitHub) over MCP.
- **Teach-a-task** (record a workflow → replay as a skill).
- *Success test:* a new user can hand Botifyr a 5-step web task (e.g., "find 10
  prospects matching X and put them in a sheet") and get a verifiable result
  with an audit trail, without a security incident.

### Phase 2 — More hands + proactivity
- **Desktop computer use** in isolated VMs.
- Scheduling, triggers, heartbeats.
- Messaging channels (start with Telegram + Slack + Discord).
- Connector/MCP marketplace (with security scanning).
- Self-host packaging (Docker Compose) + managed cloud.

### Phase 3 — Scale + ecosystem
- Multi-agent orchestration (supervisor + specialists, handoffs).
- Skills/plugin SDK + marketplace + rev share.
- Teams / enterprise control plane (SSO, RBAC, policy-as-code, data residency).
- Mobile app; Android use.

### Phase 4 — Ambient
- Realtime voice; smart-glasses/device-adjacent surfaces.
- Proactive agents that start work before you ask.
- Confidential compute (key-only-user-holds) tier.

---

## 6. Business model

Hybrid **open-core + cloud**, mirroring what the market has proven:

- **Free / self-host** — full core, MIT-style license. Builds trust + community
  (the OpenClaw flywheel) and is the top of funnel.
- **Botifyr Cloud (usage-based + subscription)** — managed, isolated sandboxes,
  connectors, scheduling, teams. Compete with Grok Bot/Muse on convenience while
  staying model-agnostic.
- **Marketplace rev-share** on skills/connectors.
- **Enterprise** — control plane, SSO/RBAC, policy-as-code, audit exports,
  on-prem/VPC deployment.

---

## 7. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| **Security / prompt injection** (kills trust, see OpenClaw) | Untrusted-content rule, policy engine, Sentinel supervisor, per-task isolation, encrypted vault, default-deny. |
| **Sites blocking agents** (see Amazon vs. Muse) | Identify as an agent, honor robots/ToS, prefer official APIs/connectors, ship browser-extension "co-pilot" mode where the user is present. |
| **Cost of computer use** (screenshots + vision tokens add up) | Hybrid perception (DOM first, vision fallback), cheaper models for repetitive steps, budgets + caching, browser-use over desktop-use when possible. |
| **Reliability** (both incumbents have failures) | Checkpointing, resumable tasks, confidence thresholds, ask-for-help instead of guessing, replayable logs. |
| **Incumbent labs** (OpenAI, Google, Anthropic, Meta, xAI) | Don't compete on model IQ; compete on openness + breadth + trust. Move fast on the open/self-host niche they won't serve. |
| **Legal / regulatory** | Clear ToS/AUP, data-residency, no agentic purchase without approval, audit exports. |
| **Scope creep** (the "do everything" trap) | Ship browser-use MVP first; add hands only after the safety + reliability spine is solid. |

---

## 8. First milestone (concrete)

Build a **single-user, local, browser-use agent** that:

1. Takes a goal in a web chat.
2. Plans and executes multi-step browser tasks with Playwright.
3. Runs code in a sandbox and writes files to a workspace.
4. Requires approval for consequential actions and logs every step.
5. Stores secrets encrypted and never puts them in the model prompt.
6. Learns one skill by demonstration and replays it.

Everything else in this blueprint exists to grow that seed without breaking the
trust spine. Ship the seed first.
