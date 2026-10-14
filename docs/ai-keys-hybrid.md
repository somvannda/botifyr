# BYO AI key — hybrid storage (decision: C)

Users can run Botifyr on their own model provider key. There are two hosts (the
**desktop** app with a local node, and the **web/portal**), so we support a
**hybrid**:

- **`server` mode (default, both hosts):** the key is stored **encrypted** in the
  vault (`BOTIFYR_AI_CONFIG`, AES-256-GCM) and the **cloud** calls the provider.
- **`device` mode (desktop only):** the key **never leaves the user's device**.
  It is stored encrypted on the device, and the **local node** performs the model
  calls; the cloud only orchestrates.

Both modes are **encrypted at rest**. The difference is *who can decrypt*: in
`server` mode the deployment operator can (they hold the vault key); in `device`
mode only the user's machine can.

## Why device mode needs the node

The agent loop runs **server-side** (`apps/cloud/src/runner.ts` → `runAgent`), and
the provider is what talks to the model API. So a device-only key only works if
the model call is executed on the device — i.e. the node (`apps/node`) must proxy
`complete` for the cloud. With no node online, device mode cannot run; the task
must fail with a clear message (or fall back to `server` mode — see policy).

## Phased plan

1. **Contract (shared)** — add `mode?: "server" | "device"` to `AiKeyConfig` /
   `AiKeyInput`; `/v1/ai/provider` stores it; the web host may only use `server`.
2. **Device provider (cloud)** — a `NodeProvider` that implements `ModelProvider`
   by calling `invokeNode(userId, "model.complete", …)`. Non-streaming first
   (`complete`); streaming (`completeStream`) can follow. `providerForUser`
   returns it when `mode === "device"` and a node is online.
3. **Node execution** — the node handles `model.complete`: build the
   OpenAI-compatible request with the device-held key and relay the response
   (reuse `createOpenAIProvider` from `@botifyr/agent-core` so the wire format
   matches exactly).
4. **Local encrypted storage** — the desktop stores the key encrypted
   (Tauri OS keychain / an encrypted file) and hands it to the node **without**
   ever sending it to the cloud. The cloud stores only `{mode, provider, model}`.
5. **Guardrails & UX** — the mode selector appears only where a node exists
   (desktop); enabling `device` requires a connected node; a clear status line
   ("key stays on this device — node online"); on node-offline, either block with
   a message or fall back per an admin setting. Add tests for the contract, the
   node provider, and the loopback.

## Security notes

- `server` mode: encrypted at rest; the operator can decrypt (by design).
- `device` mode: the cloud never receives the key or the model traffic; only
  prompts/results cross the node boundary — note the **prompts still traverse the
  cloud** to reach the node, so this protects the *key*, not the content. A fully
  private path (node runs the whole loop) is a larger, separate change.
- Never log keys; mask to the last 4 in all diagnostics (already done).
