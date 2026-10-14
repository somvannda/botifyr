import { describe, expect, it } from "vitest";
import { gpuTier, probeWebGpu } from "./webgpu";

/** The browser-executor probe must never throw and must pick a usable tier. */
describe("webgpu probe", () => {
  it("reports unsupported when WebGPU is absent, and falls back to subs", async () => {
    const probe = await probeWebGpu(null);
    expect(probe.supported).toBe(false);
    expect(probe.reason).toBeTruthy();
    expect(gpuTier(probe)).toBe("subs");
  });

  it("reads adapter info and picks the dub tier for a large buffer", async () => {
    const probe = await probeWebGpu({
      requestAdapter: async () => ({
        info: { vendor: "nvidia", architecture: "ampere" },
        limits: { maxBufferSize: 1024 * 1024 * 1024 },
      }),
    });
    expect(probe.supported).toBe(true);
    expect(probe.vendor).toBe("nvidia");
    expect(probe.architecture).toBe("ampere");
    expect(gpuTier(probe)).toBe("dub");
  });

  it("stays at subs without a large GPU buffer", async () => {
    const probe = await probeWebGpu({ requestAdapter: async () => ({ limits: { maxBufferSize: 64 * 1024 * 1024 } }) });
    expect(probe.supported).toBe(true);
    expect(gpuTier(probe)).toBe("subs");
  });

  it("handles a null adapter without throwing", async () => {
    const probe = await probeWebGpu({ requestAdapter: async () => null });
    expect(probe.supported).toBe(false);
    expect(gpuTier(probe)).toBe("subs");
  });
});
