import type { ToolDefinition } from "@botifyr/agent-core";
import { decryptSecret } from "./vault.js";
import type { Store } from "./store/index.js";

/**
 * Camxora Music API tools (https://musicapi.camxora.com).
 *
 * The user connects Camxora with an API key from the Marketplace (a token app);
 * we store it encrypted in the vault (`connections` table, provider "camxora")
 * and use it here. Generation spends credits, so those tools are approval-gated.
 *
 * Coverage: a small set of high-level tools for the common operations, plus
 * `music.get` / `music.request` — a passthrough that reaches every one of the
 * API's ~47 endpoints without 47 near-identical tools.
 */

const BASE = (process.env.BOTIFYR_CAMXORA_URL ?? "https://musicapi.camxora.com").replace(/\/+$/, "");

/** Model keys the API accepts (docs → AI Model Versions). */
const MODELS = ["chirp-hawk", "chirp-goose", "chirp-hawk-wild"] as const;

async function camxoraKey(store: Store, vaultKey: Buffer, userId: string): Promise<string | null> {
  const record = await store.getConnection(userId, "camxora");
  if (!record) return null;
  try {
    const tokens = JSON.parse(decryptSecret(vaultKey, record)) as { accessToken?: string };
    return tokens.accessToken ?? null;
  } catch {
    return null;
  }
}

function notConnected(): { ok: boolean; output: string } {
  return {
    ok: false,
    output: 'Camxora isn\'t connected. Ask the user to add it under "Connect apps" → Camxora Music.',
  };
}

async function camxoraCall(
  key: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; output: string }> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    const trimmed =
      typeof data === "string" ? data.slice(0, 800) : JSON.stringify(data).slice(0, 1500);
    return response.ok
      ? { ok: true, output: trimmed }
      : { ok: false, output: `Camxora error ${response.status}: ${trimmed}` };
  } catch (error) {
    return {
      ok: false,
      output: `Camxora request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function createCamxoraTools(store: Store, vaultKey: Buffer, userId: string): ToolDefinition[] {
  const modelParam = {
    type: "string",
    enum: [...MODELS],
    description: "Model: chirp-hawk (V6, default), chirp-goose (V6-Mini, free), chirp-hawk-wild (V6-Wild).",
  };
  const clipId = { type: "string", description: "Clip / audio id from a previous generation or lookup." };
  return [
    {
      name: "music.credits",
      description: "Check the remaining Camxora credits on the connected API key.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        return camxoraCall(key, "GET", "/v1/credits");
      },
    },
    {
      name: "music.generate",
      description:
        "Generate a song (or instrumental) with Camxora from a description or lyrics. Returns a task id to poll with music.task. When the track is ready, share its audio URL with the user — it renders as an inline player.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Style/description, or lyrics in custom mode." },
          title: { type: "string", description: "Track title (custom mode)." },
          tags: { type: "string", description: "Style tags (custom mode)." },
          instrumental: { type: "boolean", description: "Generate an instrumental only." },
          customMode: { type: "boolean", description: "Enable custom mode (prompt + tags + title)." },
          model: modelParam,
        },
        required: ["prompt"],
      },
      requiresApproval: true,
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        return camxoraCall(key, "POST", "/v1/music", {
          gpt_description_prompt: String(args.prompt ?? ""),
          title: args.title,
          tags: args.tags,
          instrumental: args.instrumental,
          custom_mode: args.customMode,
          model: args.model,
        });
      },
    },
    {
      name: "music.extend",
      description: "Extend an existing Camxora clip from a timestamp.",
      parameters: {
        type: "object",
        properties: {
          clipId,
          continueAt: { type: "number", description: "Extension start seconds (default 170)." },
          prompt: { type: "string", description: "Optional continuation prompt." },
        },
        required: ["clipId"],
      },
      requiresApproval: true,
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        return camxoraCall(key, "POST", "/v1/music/extend", {
          clip_id: String(args.clipId ?? ""),
          continue_at: args.continueAt,
          prompt: args.prompt,
        });
      },
    },
    {
      name: "music.cover",
      description: "Reinterpret an existing Camxora clip in a new style (cover).",
      parameters: {
        type: "object",
        properties: { clipId, prompt: { type: "string", description: "Style / cover description." } },
        required: ["clipId"],
      },
      requiresApproval: true,
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        return camxoraCall(key, "POST", "/v1/music/cover", {
          clip_id: String(args.clipId ?? ""),
          prompt: args.prompt,
        });
      },
    },
    {
      name: "music.lyrics",
      description: "Generate AI lyrics from a theme (free — costs no credits).",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string", description: "Lyrics theme / prompt." } },
        required: ["prompt"],
      },
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        return camxoraCall(key, "POST", "/v1/lyrics", { prompt: String(args.prompt ?? "") });
      },
    },
    {
      name: "music.stems",
      description: "Separate a Camxora clip into vocals and instrumental stems.",
      parameters: { type: "object", properties: { clipId }, required: ["clipId"] },
      requiresApproval: true,
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        return camxoraCall(key, "POST", "/v1/music/stems", { clip_id: String(args.clipId ?? "") });
      },
    },
    {
      name: "music.wav",
      description: "Convert a Camxora clip to WAV (or MP3).",
      parameters: {
        type: "object",
        properties: { clipId, format: { type: "string", enum: ["wav", "mp3"] } },
        required: ["clipId"],
      },
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        return camxoraCall(key, "POST", "/v1/music/wav", {
          clip_id: String(args.clipId ?? ""),
          format: args.format,
        });
      },
    },
    {
      name: "music.video",
      description: "Generate an MP4 music video for a Camxora clip.",
      parameters: {
        type: "object",
        properties: {
          clipId,
          prompt: { type: "string", description: "Optional music-video visual prompt." },
          aspectRatio: { type: "string", description: 'e.g. "16:9" (default) or "9:16".' },
        },
        required: ["clipId"],
      },
      requiresApproval: true,
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        return camxoraCall(key, "POST", "/v1/mp4/generate", {
          clip_id: String(args.clipId ?? ""),
          prompt: args.prompt,
          aspect_ratio: args.aspectRatio,
        });
      },
    },
    {
      name: "music.task",
      description:
        "Poll a Camxora task's status and result by id. On success, relay the track's audio URL to the user — it renders as an inline player.",
      parameters: {
        type: "object",
        properties: { taskId: { type: "string", description: "Task id from a generate/extend/etc call." } },
        required: ["taskId"],
      },
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        return camxoraCall(key, "GET", `/v1/task/${encodeURIComponent(String(args.taskId ?? ""))}`);
      },
    },
    {
      name: "music.get",
      description:
        "Call any Camxora GET endpoint (read-only) not covered by a specific tool — e.g. clip detail, stems/video/midi/cover status, WAV detail. Path begins with '/'.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: 'e.g. "/v1/clip/abc" or "/v1/credits".' } },
        required: ["path"],
      },
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        const path = String(args.path ?? "");
        if (!path.startsWith("/")) return { ok: false, output: 'path must begin with "/".' };
        return camxoraCall(key, "GET", path);
      },
    },
    {
      name: "music.request",
      description:
        "Call any Camxora POST endpoint not covered above — mashup, remaster, replace-section, add-vocals/instrumental, cover-image, upload, voice/persona, sounds, midi, boost, recovery, etc. Spends credits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: 'e.g. "/v1/music/mashup".' },
          body: { type: "object", description: "JSON body for the endpoint." },
        },
        required: ["path"],
      },
      requiresApproval: true,
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        const path = String(args.path ?? "");
        if (!path.startsWith("/")) return { ok: false, output: 'path must begin with "/".' };
        return camxoraCall(key, "POST", path, (args.body as Record<string, unknown> | undefined) ?? {});
      },
    },
  ];
}

/** The tool names this factory provides (capability mapping + tests). */
export const CAMXORA_TOOL_NAMES = [
  "music.credits",
  "music.generate",
  "music.extend",
  "music.cover",
  "music.lyrics",
  "music.stems",
  "music.wav",
  "music.video",
  "music.task",
  "music.get",
  "music.request",
] as const;
