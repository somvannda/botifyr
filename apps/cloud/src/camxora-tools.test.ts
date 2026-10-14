import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAMXORA_TOOL_NAMES,
  camxoraTaskIdsFromAudit,
  createCamxoraTools,
  rewriteMediaStreams,
  unplayableMediaStream,
} from "./camxora-tools.js";
import { capabilityForTool } from "./tool-capabilities.js";
import { MemoryStore } from "./store/memory.js";
import { encryptSecret } from "./vault.js";

/** Camxora music tools: gated on a stored API key, approval-gated for spend. */
const vaultKey = Buffer.alloc(32);
const ctx = { workspaceDir: ".", log: () => {} };

async function connect(store: MemoryStore, token: string): Promise<void> {
  const encrypted = encryptSecret(
    vaultKey,
    JSON.stringify({ accessToken: token, refreshToken: null, expiresAt: null }),
  );
  await store.upsertConnection({
    id: "conn-camxora",
    userId: "u1",
    provider: "camxora",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
    createdAt: new Date().toISOString(),
  });
}

function tool(name: string, store: MemoryStore) {
  const found = createCamxoraTools(store, vaultKey, "u1").find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe("camxora music tools", () => {
  afterEach(() => vi.restoreAllMocks());

  it("provides the curated toolset", () => {
    const store = new MemoryStore();
    expect(createCamxoraTools(store, vaultKey, "u1").map((t) => t.name)).toEqual([...CAMXORA_TOOL_NAMES]);
  });

  it("gates generation behind approval", () => {
    const store = new MemoryStore();
    for (const name of ["music.generate", "music.stems", "music.request"]) {
      expect(tool(name, store).requiresApproval).toBe(true);
    }
    expect(tool("music.credits", store).requiresApproval).toBeFalsy();
  });

  it("reports not-connected when no key is stored", async () => {
    const result = await tool("music.credits", new MemoryStore()).run({}, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("isn't connected");
  });

  it("calls the API with the stored key", async () => {
    const store = new MemoryStore();
    await connect(store, "secret-key");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ credits: 42 }), { status: 200 }));

    const result = await tool("music.credits", store).run({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("42");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://musicapi.camxora.com/v1/credits");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
  });

  it("rejects a passthrough path that isn't rooted", async () => {
    const store = new MemoryStore();
    await connect(store, "k");
    const result = await tool("music.get", store).run({ path: "v1/credits" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('must begin with "/"');
  });

  it("batch-generates N songs in one call", async () => {
    const store = new MemoryStore();
    await connect(store, "k");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ id: "task-1" }), { status: 200 }));
    const result = await tool("music.generate_batch", store).run({ prompt: "khmer rap", count: 3 }, ctx);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://musicapi.camxora.com/v1/music");
    expect(result.output).toContain("task-1");
  });

  it("polls several tasks and surfaces only the playable MP3", async () => {
    const store = new MemoryStore();
    await connect(store, "k");
    const payload = (id: string) => ({
      job_id: id,
      status: "running",
      result: {
        clips: [
          {
            id,
            title: "Test Song",
            status: "complete",
            // The playable file Camxora hosts on its own storage.
            stream_audio_url: `https://b2.example/${id}.mp3?sig=1`,
            // Values the model must NOT use for playback: an auth-gated
            // placeholder and an encrypted CloudFront m4a.
            audio_url: "https://studio-api.prod.suno.com/api/forbidden",
            media_urls: [{ url: `https://cdn.example/${id}.m4a` }],
          },
        ],
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const id = String(url).split("/").pop() ?? "?";
      return new Response(JSON.stringify(payload(id)), { status: 200 });
    });
    const result = await tool("music.tasks", store).run({ taskIds: ["a", "b"] }, ctx);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.output).toContain("https://b2.example/a.mp3");
    expect(result.output).toContain("https://b2.example/b.mp3");
    // Never the encrypted m4a or the auth-gated placeholder.
    expect(result.output).not.toContain(".m4a");
    expect(result.output).not.toContain("/api/forbidden");
    // Ready clips tell the model to reply with a media block per track.
    expect(result.output).toContain("media");
  });

  it("keeps polling while a clip is complete but its MP3 copy isn't ready", async () => {
    const saved = process.env.BOTIFYR_MUSIC_POLL_MAX_MS;
    process.env.BOTIFYR_MUSIC_POLL_MAX_MS = "0";
    try {
      const store = new MemoryStore();
      await connect(store, "k");
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              status: "running",
              result: {
                clips: [
                  {
                    id: "a",
                    status: "complete",
                    audio_url: "https://studio-api.prod.suno.com/api/forbidden",
                    media_urls: [{ url: "https://cdn.example/a.m4a" }],
                  },
                ],
              },
            }),
            { status: 200 },
          ),
      );
      const result = await tool("music.task", store).run({ taskId: "a" }, ctx);
      expect(result.output).toContain("preparing");
      expect(result.output).toContain("do not reply");
    } finally {
      if (saved === undefined) delete process.env.BOTIFYR_MUSIC_POLL_MAX_MS;
      else process.env.BOTIFYR_MUSIC_POLL_MAX_MS = saved;
    }
  });

  it("waits inside a single call until the MP3 is ready", async () => {
    const savedInterval = process.env.BOTIFYR_MUSIC_POLL_INTERVAL_MS;
    const savedMax = process.env.BOTIFYR_MUSIC_POLL_MAX_MS;
    process.env.BOTIFYR_MUSIC_POLL_INTERVAL_MS = "1";
    process.env.BOTIFYR_MUSIC_POLL_MAX_MS = "5000";
    try {
      const store = new MemoryStore();
      await connect(store, "k");
      let calls = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        calls += 1;
        const ready = calls >= 2;
        return new Response(
          JSON.stringify({
            status: ready ? "complete" : "running",
            result: {
              clips: [
                {
                  id: "a",
                  title: "Song",
                  status: ready ? "complete" : "streaming",
                  stream_audio_url: ready ? "https://b2.example/a.mp3" : undefined,
                  audio_url: "https://studio-api.prod.suno.com/api/forbidden",
                },
              ],
            },
          }),
          { status: 200 },
        );
      });
      const result = await tool("music.task", store).run({ taskId: "a" }, ctx);
      // One agent call, two upstream polls: it waited for readiness.
      expect(calls).toBe(2);
      expect(result.output).toContain("https://b2.example/a.mp3");
    } finally {
      if (savedInterval === undefined) delete process.env.BOTIFYR_MUSIC_POLL_INTERVAL_MS;
      else process.env.BOTIFYR_MUSIC_POLL_INTERVAL_MS = savedInterval;
      if (savedMax === undefined) delete process.env.BOTIFYR_MUSIC_POLL_MAX_MS;
      else process.env.BOTIFYR_MUSIC_POLL_MAX_MS = savedMax;
    }
  });

  it("maps the spend tools to a money capability, leaving reads unmapped", () => {
    expect(capabilityForTool("music.generate")).toBe("music.generate");
    expect(capabilityForTool("music.generate_batch")).toBe("music.generate");
    expect(capabilityForTool("music.batch")).toBe("music.generate");
    expect(capabilityForTool("music.request")).toBe("music.generate");
    expect(capabilityForTool("music.credits")).toBeNull();
    expect(capabilityForTool("music.task")).toBeNull();
  });

  it("runs a batch of calls in one run, reporting per call", async () => {
    const store = new MemoryStore();
    await connect(store, "k");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => new Response(JSON.stringify({ path: url }), { status: 200 }));
    const result = await tool("music.batch", store).run(
      { calls: [{ path: "/v1/music/extend", body: { clip_id: "a" } }, { path: "bad" }] },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the rooted path hits the API
    expect(result.output).toContain("/v1/music/extend");
    expect(result.output).toContain("skipped");
  });
});

describe("old-track refresh helpers", () => {
  it("flags the legacy unplayable URLs only", () => {
    expect(unplayableMediaStream("https://d2lwuy8qc234o3.cloudfront.net/1/clip/x.m4a")).toBe(true);
    expect(unplayableMediaStream("https://studio-api.prod.suno.com/api/forbidden")).toBe(true);
    expect(unplayableMediaStream("https://s3.example/clips/x.mp3?sig=1")).toBe(false);
  });

  it("rewrites only unplayable media blocks, in order, leaving good ones alone", () => {
    const content =
      'A\n```media\n{"stream":"https://d2lwuy8qc234o3.cloudfront.net/1/clip/a.m4a","title":"x"}\n```\n' +
      'B\n```media\n{"stream":"https://s3.example/ok.mp3"}\n```';
    const out = rewriteMediaStreams(content, [{ stream: "https://s3.example/new.mp3" }]);
    expect(out).toContain("https://s3.example/new.mp3");
    expect(out).not.toContain("cloudfront.net");
    expect(out).toContain("https://s3.example/ok.mp3");
  });

  it("rewrites bare legacy track links, in order, leaving good ones alone", () => {
    const content =
      'Both tracks are done.\n\n' +
      '1) Song A\n- ▶️ https://d2lwuy8qc234o3.cloudfront.net/1/clip/a.m4a\n\n' +
      '2) Song B\n- ▶️ https://d2lwuy8qc234o3.cloudfront.net/1/clip/b.m4a\n\n' +
      'Extra: https://s3.example/ok.mp3';
    const out = rewriteMediaStreams(content, [{ stream: "https://b2.example/a.mp3" }, { stream: "https://b2.example/b.mp3" }]);
    expect(out).toContain("https://b2.example/a.mp3");
    expect(out).toContain("https://b2.example/b.mp3");
    expect(out).not.toContain("cloudfront.net");
    // An already-playable bare link is left untouched.
    expect(out).toContain("https://s3.example/ok.mp3");
  });

  it("extracts Camxora task ids from audit details (old and new formats)", () => {
    const ids = camxoraTaskIdsFromAudit([
      '- 5c948dfe-4c5b-463e-bee1-38b1f9b9cc83: {"job_id":"5c948dfe-4c5b-463e-bee1-38b1f9b9cc83"}',
      '{"job_id":"62969a2d-109f-4d73-a9e4-921bb804c2a3","status":"running"}',
    ]);
    expect(ids).toContain("5c948dfe-4c5b-463e-bee1-38b1f9b9cc83");
    expect(ids).toContain("62969a2d-109f-4d73-a9e4-921bb804c2a3");
  });
});
