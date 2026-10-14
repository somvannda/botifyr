/**
 * WebGPU capability probe for the video-translation pipeline
 * (docs/video-translation.md §7.1).
 *
 * A browser can run the **light** stages (ASR, subtitles, ffmpeg mux, dub-lite)
 * on the user's GPU via WebGPU — zero-install, for the web portal. The heavy
 * stages (lip-sync, voice cloning) do not run in-browser. This probe reports
 * what the current browser can do and picks the tier, mirroring the GPU probe in
 * the desktop path (§13.1).
 */

/** Executor tier from §13.1. A browser never reaches `full` (no lip-sync). */
export type GpuTier = "full" | "dub" | "subs";

export interface GpuProbe {
  /** True when `navigator.gpu` exists and returned an adapter. */
  supported: boolean;
  /** Adapter vendor when reported (e.g. "nvidia", "apple"). */
  vendor?: string;
  architecture?: string;
  /** Max bytes the adapter may allocate in one buffer — a rough VRAM signal. */
  maxBufferBytes?: number;
  /** Why the probe failed, when it did. */
  reason?: string;
}

interface AdapterLike {
  info?: { vendor?: string; architecture?: string };
  limits?: { maxBufferSize?: number };
  requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string }>;
}

interface GpuLike {
  requestAdapter: () => Promise<AdapterLike | null>;
}

/**
 * Probe the browser for WebGPU and an adapter. Never throws.
 *
 * `gpu` is for tests: pass `null` to force "absent", omit it to read
 * `navigator.gpu` (the real path).
 */
export async function probeWebGpu(gpu?: GpuLike | null): Promise<GpuProbe> {
  const nav = globalThis.navigator as (Navigator & { gpu?: GpuLike }) | undefined;
  const device = gpu !== undefined ? gpu : nav?.gpu;
  if (!device || typeof device.requestAdapter !== "function") {
    return { supported: false, reason: "WebGPU is not available in this browser." };
  }
  try {
    const adapter = await device.requestAdapter();
    if (!adapter) return { supported: false, reason: "No GPU adapter was returned." };
    const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : undefined);
    return {
      supported: true,
      vendor: info?.vendor,
      architecture: info?.architecture,
      maxBufferBytes: adapter.limits?.maxBufferSize,
    };
  } catch (error) {
    return { supported: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** A rough "enough VRAM for dubbing" threshold (512 MB single-buffer). */
const DUB_BUFFER_BYTES = 512 * 1024 * 1024;

/**
 * Map a probe to the video-translation tier the browser can run. Browsers cap
 * at `dub` (lip-sync is out of reach); without a sizeable GPU buffer we fall
 * back to `subs` so the pipeline is never a dead end.
 */
export function gpuTier(probe: GpuProbe): GpuTier {
  if (!probe.supported) return "subs";
  return (probe.maxBufferBytes ?? 0) >= DUB_BUFFER_BYTES ? "dub" : "subs";
}
