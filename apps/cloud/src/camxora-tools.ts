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

/** Max songs one `music.generate_batch` may start (bounds credits in one approval). */
const MAX_BATCH = Math.max(1, Math.min(20, Number(process.env.BOTIFYR_MUSIC_MAX_BATCH ?? 10)));

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

/** One Camxora call, returning the parsed body for callers that need fields. */
async function camxoraRaw(
  key: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
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
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: error instanceof Error ? error.message : String(error) };
  }
}

/** Serialize a result into a bounded string for the model context. */
function trim(data: unknown, max = 1500): string {
  return typeof data === "string" ? data.slice(0, 800) : JSON.stringify(data).slice(0, max);
}

async function camxoraCall(
  key: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; output: string }> {
  const res = await camxoraRaw(key, method, path, body);
  return res.ok
    ? { ok: true, output: trim(res.data) }
    : { ok: false, output: `Camxora error ${res.status}: ${trim(res.data)}` };
}

/** Best-effort task id from a create response (Camxora native or sunoapi shape). */
function taskIdOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const pick = (value: unknown): string | null =>
    typeof value === "string" && value ? value : typeof value === "number" ? String(value) : null;
  const obj = data as Record<string, unknown>;
  const nested = (obj.data ?? {}) as Record<string, unknown>;
  return pick(obj.task_id) ?? pick(obj.taskId) ?? pick(obj.id) ?? pick(nested.task_id) ?? pick(nested.taskId) ?? null;
}

interface MusicClip {
  id: string;
  title: string;
  status: string;
  /** The playable CDN file (media_urls[0].url). */
  audio?: string;
  image?: string;
  model?: string;
}

/**
 * The playable audio URL for a clip. Camxora hosts a normal MP3 on its own
 * storage (`stream_audio_url` / `audio_url`); until that copy exists the fields
 * hold a Suno placeholder ("…/api/forbidden") and `media_urls[]` points at an
 * encrypted CloudFront `.m4a` the browser cannot decode. So we only accept a
 * real http(s) MP3 and treat everything else as "not ready yet".
 */
function playableAudio(clip: Record<string, unknown>): string | undefined {
  for (const field of ["stream_audio_url", "audio_url"]) {
    const value = clip[field];
    if (typeof value === "string" && /^https?:\/\//i.test(value) && !/\/forbidden\b/.test(value)) {
      return value;
    }
  }
  return undefined;
}

/** Compact view of a Camxora task (drops the ~1.5 KB of raw JSON). */
function summarizeMusicTask(data: unknown): { clips: MusicClip[]; running: boolean } {
  const root = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const result = (root.result ?? root.data ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(result.clips) ? result.clips : Array.isArray(root.clips) ? root.clips : [];
  const clips: MusicClip[] = (raw as unknown[]).map((entry) => {
    const clip = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    return {
      id: String(clip.id ?? ""),
      title: String(clip.title ?? ""),
      status: String(clip.status ?? "unknown"),
      audio: playableAudio(clip),
      image: typeof clip.image_url === "string" ? clip.image_url : undefined,
      model: typeof clip.model_name === "string" ? clip.model_name : undefined,
    };
  });
  const status = String(root.status ?? result.status ?? "");
  // "Ready" means a playable MP3 exists, not merely status === "complete" —
  // Camxora finishes its own copy a little later.
  const running =
    clips.length > 0 ? clips.some((clip) => !clip.audio) : status === "running" || status === "pending";
  return { clips, running };
}

/** A model-friendly poll result: only the playable URL, plus a clear next step. */
function musicTaskOutput(id: string, data: unknown): string {
  const { clips, running } = summarizeMusicTask(data);
  if (clips.length === 0) {
    return `${id}: ${running ? "still generating" : "no clips yet"}. Poll again shortly; don't reply yet.`;
  }
  const ready = clips.filter((clip) => clip.audio);
  const lines = clips.map((clip) => {
    const state = clip.audio ? "✅ ready" : "⏳ preparing";
    return (
      `${state}: "${clip.title}"${clip.model ? ` (${clip.model})` : ""}` +
      (clip.audio ? `\n  play: ${clip.audio}` : "") +
      (clip.image ? `\n  cover: ${clip.image}` : "")
    );
  });
  const hint = ready.length
    ? "\n\nReply now: include ONE fenced `media` block PER ✅ track (all of them), using exactly its \"play\" URL as " +
      '"stream". Do not use the media_urls/audio_url values from the raw JSON.'
    : "\n\nStill preparing the audio — poll again shortly and do not reply to the user yet.";
  return `${id}: ${running ? "preparing" : "finished"}\n${lines.join("\n")}${hint}`;
}

/** A task's clips are ready when every clip has a playable MP3. */
function clipsReady(data: unknown): boolean {
  const { clips } = summarizeMusicTask(data);
  return clips.length > 0 && clips.every((clip) => clip.audio);
}

/**
 * True for a media URL that a browser can't play: Suno's encrypted CloudFront
 * `.m4a` or the auth-gated `/api/forbidden` placeholder. Old messages (written
 * before the tool surfaced the MP3) contain these.
 */
export function unplayableMediaStream(url: string): boolean {
  return /\/forbidden\b/.test(url) || /cloudfront\.net\/\d+\/clip\//i.test(url);
}

/**
 * Replace unplayable media URLs in a message with resolved tracks, matched in
 * order. Handles both fenced `media` blocks and bare URLs (older messages wrote
 * the Suno CloudFront `.m4a` link straight into a bullet — see
 * `unplayableMediaStream`). Non-media text is left untouched; already-playable
 * links are kept as-is.
 */
export function rewriteMediaStreams(content: string, tracks: Array<{ stream: string }>): string {
  if (tracks.length === 0) return content;
  let index = 0;
  const nextStream = (): string => {
    const track = tracks[index] ?? tracks[tracks.length - 1];
    index += 1;
    return track.stream;
  };
  const MEDIA_BLOCK_OR_URL = /```media[^\n]*\n([\s\S]*?)```|https?:\/\/[^\s<>()[\]]+/g;
  return content.replace(MEDIA_BLOCK_OR_URL, (whole: string, body?: string) => {
    // Fenced `media` block: rewrite its `stream` field.
    if (body !== undefined) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body.trim()) as Record<string, unknown>;
      } catch {
        return whole;
      }
      const stream = typeof parsed.stream === "string" ? parsed.stream : "";
      if (!unplayableMediaStream(stream)) return whole;
      return `\`\`\`media\n${JSON.stringify({ ...parsed, stream: nextStream() })}\n\`\`\``;
    }
    // Bare URL: swap an unplayable one for the next playable track.
    if (!unplayableMediaStream(whole)) return whole;
    return nextStream();
  });
}

/** Camxora task ("job") ids referenced by a task's audit details. */
export function camxoraTaskIdsFromAudit(details: string[]): string[] {
  const ids = new Set<string>();
  for (const detail of details) {
    for (const match of detail.matchAll(/"job_id"\s*:\s*"([0-9a-fA-F-]{36})"/g)) ids.add(match[1]);
    for (const match of detail.matchAll(/(?:^|\n)-\s*([0-9a-fA-F-]{36})\s*:/g)) ids.add(match[1]);
  }
  return [...ids];
}

export interface ResolvedTrack {
  title: string;
  stream: string;
  cover?: string;
}

/** Resolve the playable MP3s for a set of Camxora task ids (for refreshing old messages). */
export async function resolveCamxoraTracks(
  store: Store,
  vaultKey: Buffer,
  userId: string,
  taskIds: string[],
): Promise<ResolvedTrack[]> {
  const key = await camxoraKey(store, vaultKey, userId);
  if (!key) return [];
  const out: ResolvedTrack[] = [];
  for (const id of [...new Set(taskIds)].slice(0, MAX_BATCH)) {
    const res = await camxoraRaw(key, "GET", `/v1/task/${encodeURIComponent(id)}`);
    if (!res.ok) continue;
    for (const clip of summarizeMusicTask(res.data).clips) {
      if (clip.audio) out.push({ title: clip.title, stream: clip.audio, cover: clip.image });
    }
  }
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Read the poll window lazily so tests can shrink it. */
function pollWindow(): { interval: number; max: number } {
  return {
    interval: Math.max(0, Number(process.env.BOTIFYR_MUSIC_POLL_INTERVAL_MS ?? 3000)),
    max: Math.max(0, Number(process.env.BOTIFYR_MUSIC_POLL_MAX_MS ?? 15000)),
  };
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
      name: "music.generate_batch",
      description:
        "Start several songs (same prompt/style) in ONE approval instead of calling music.generate repeatedly. Returns a task id per generation; poll them together with music.tasks.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Style/description, or lyrics in custom mode." },
          count: { type: "number", description: `How many to generate (1–${MAX_BATCH}).` },
          instrumental: { type: "boolean", description: "Generate instrumentals only." },
          model: modelParam,
        },
        required: ["prompt", "count"],
      },
      requiresApproval: true,
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        const requested = Math.floor(Number(args.count ?? 1));
        const count = Math.max(1, Math.min(MAX_BATCH, Number.isFinite(requested) ? requested : 1));
        const tasks: string[] = [];
        for (let index = 0; index < count; index += 1) {
          const res = await camxoraRaw(key, "POST", "/v1/music", {
            gpt_description_prompt: String(args.prompt ?? ""),
            instrumental: args.instrumental,
            model: args.model,
          });
          if (!res.ok) {
            return {
              ok: false,
              output: `Batch stopped after ${index}/${count} (−${count - index} not started). ${trim(res.data, 300)}`,
            };
          }
          tasks.push(taskIdOf(res.data) ?? `? ${trim(res.data, 160)}`);
        }
        return {
          ok: true,
          output:
            `Started ${count} generation(s) (≈${count * 10} credits). Poll with music.tasks:\n` +
            tasks.map((task, index) => `${index + 1}. ${task}`).join("\n"),
        };
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
      description:
        "Convert a Camxora clip to WAV (or MP3). The result is a durable file served from Camxora's own storage — poll it with music.wav_status and relay the download URL, so the track can be kept after a streaming link expires.",
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
      name: "music.wav_status",
      description:
        "Poll a WAV conversion (from music.wav) by id. On success the result carries a durable download URL served from Camxora's storage — share it so the track can be kept even after the streaming URL expires.",
      parameters: {
        type: "object",
        properties: { taskId: { type: "string", description: "WAV conversion task id from music.wav." } },
        required: ["taskId"],
      },
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        return camxoraCall(key, "GET", `/v1/music/wav/${encodeURIComponent(String(args.taskId ?? ""))}`);
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
        'Poll a Camxora task\'s status and result by id. When a clip is ✅ ready it reports a "play" URL (the playable MP3); present each ready clip to the user as a fenced `media` block using that "play" URL as "stream".',
      parameters: {
        type: "object",
        properties: { taskId: { type: "string", description: "Task id from a generate/extend/etc call." } },
        required: ["taskId"],
      },
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        const id = String(args.taskId ?? "");
        const { interval, max } = pollWindow();
        const deadline = Date.now() + max;
        for (;;) {
          const res = await camxoraRaw(key, "GET", `/v1/task/${encodeURIComponent(id)}`);
          if (!res.ok) return { ok: false, output: `Camxora error ${res.status}: ${trim(res.data, 300)}` };
          // Wait inside the call so a generation that finishes in a few seconds
          // is reported ready in one step, not by the agent polling every second.
          if (clipsReady(res.data) || Date.now() >= deadline) {
            return { ok: true, output: musicTaskOutput(id, res.data) };
          }
          await sleep(interval);
        }
      },
    },
    {
      name: "music.tasks",
      description:
        'Poll several Camxora tasks at once (from music.generate_batch). Waits briefly for the audio, then reports each clip compactly with its playable MP3 "play" URL; present EVERY ✅ clip as its own `media` block (one per track).',
      parameters: {
        type: "object",
        properties: {
          taskIds: { type: "array", items: { type: "string" }, description: "Task ids to poll." },
        },
        required: ["taskIds"],
      },
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        const ids = Array.isArray(args.taskIds)
          ? args.taskIds.map(String).filter(Boolean).slice(0, MAX_BATCH)
          : [];
        if (ids.length === 0) return { ok: false, output: "Provide taskIds." };
        const { interval, max } = pollWindow();
        const deadline = Date.now() + max;
        const latest = new Map<string, { ok: boolean; data: unknown }>();
        for (;;) {
          await Promise.all(
            ids.map(async (id) => {
              const res = await camxoraRaw(key, "GET", `/v1/task/${encodeURIComponent(id)}`);
              latest.set(id, {
                ok: res.ok,
                data: res.ok ? res.data : `Camxora error ${res.status}: ${trim(res.data, 200)}`,
              });
            }),
          );
          const allReady = ids.every((id) => {
            const entry = latest.get(id);
            return entry?.ok === true && clipsReady(entry.data);
          });
          if (allReady || Date.now() >= deadline) break;
          await sleep(interval);
        }
        const lines = ids.map((id) => {
          const entry = latest.get(id);
          if (!entry) return `${id}: no response`;
          return entry.ok ? musicTaskOutput(id, entry.data) : `${id}: ${entry.data}`;
        });
        return { ok: true, output: lines.join("\n") };
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
    {
      name: "music.batch",
      description:
        "Run several Camxora POST calls under ONE approval — e.g. extend/cover/stems/video a list of clips, or any mix of spend endpoints. Each call is { path, body }; results are returned per call.",
      parameters: {
        type: "object",
        properties: {
          calls: {
            type: "array",
            description: `Calls to run (1–${MAX_BATCH}).`,
            items: {
              type: "object",
              properties: {
                path: { type: "string", description: 'e.g. "/v1/music/extend".' },
                body: { type: "object", description: "JSON body for that endpoint." },
              },
              required: ["path"],
            },
          },
        },
        required: ["calls"],
      },
      requiresApproval: true,
      run: async (args) => {
        const key = await camxoraKey(store, vaultKey, userId);
        if (!key) return notConnected();
        const calls = Array.isArray(args.calls) ? args.calls.slice(0, MAX_BATCH) : [];
        if (calls.length === 0) return { ok: false, output: "Provide calls: [{ path, body }]." };
        const lines: string[] = [];
        let succeeded = 0;
        for (let index = 0; index < calls.length; index += 1) {
          const call = (calls[index] ?? {}) as { path?: unknown; body?: unknown };
          const path = String(call.path ?? "");
          if (!path.startsWith("/")) {
            lines.push(`${index + 1}. skipped — path must begin with "/"`);
            continue;
          }
          const res = await camxoraCall(key, "POST", path, (call.body as Record<string, unknown> | undefined) ?? {});
          if (res.ok) succeeded += 1;
          lines.push(`${index + 1}. ${path}: ${res.output.slice(0, 300)}`);
        }
        return { ok: succeeded > 0, output: `${succeeded}/${calls.length} succeeded:\n${lines.join("\n")}` };
      },
    },
  ];
}

/** The tool names this factory provides (capability mapping + tests). */
export const CAMXORA_TOOL_NAMES = [
  "music.credits",
  "music.generate",
  "music.generate_batch",
  "music.extend",
  "music.cover",
  "music.lyrics",
  "music.stems",
  "music.wav",
  "music.wav_status",
  "music.video",
  "music.task",
  "music.tasks",
  "music.get",
  "music.request",
  "music.batch",
] as const;
