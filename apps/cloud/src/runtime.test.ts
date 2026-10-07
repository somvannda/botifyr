import { describe, expect, it } from "vitest";
import {
  clearComputerSandbox,
  getComputerSandbox,
  setComputerSandbox,
  takeIdleComputerSandboxes,
  touchComputerSandbox,
} from "./runtime.js";

/**
 * Regression guard for the desktop-sandbox idle reaper: it's what stops leaked
 * `botifyr-desk-*` containers from piling up and slowing the host.
 */
describe("computer sandbox idle tracking", () => {
  // The tracking helpers never touch the backend object itself.
  const backend = {} as never;

  it("returns keys idle past the threshold, and consumes them", () => {
    setComputerSandbox("idle-a", backend);
    setComputerSandbox("idle-b", backend);

    const farFuture = Date.now() + 10_000;
    expect(takeIdleComputerSandboxes(1_000, farFuture).sort()).toEqual(["idle-a", "idle-b"]);
    // takeIdle* removes them from tracking, so a second sweep finds nothing.
    expect(takeIdleComputerSandboxes(1_000, farFuture)).toEqual([]);

    clearComputerSandbox("idle-a");
    clearComputerSandbox("idle-b");
  });

  it("keeps a key that was just touched", () => {
    setComputerSandbox("live", backend);
    touchComputerSandbox("live");
    // 10-minute threshold against the real clock → not idle.
    expect(takeIdleComputerSandboxes(10 * 60_000, Date.now())).not.toContain("live");
    clearComputerSandbox("live");
  });

  it("ignores keys that aren't tracked and clears cleanly", () => {
    touchComputerSandbox("ghost"); // no throw, no entry
    expect(getComputerSandbox("ghost")).toBeUndefined();
    clearComputerSandbox("ghost");
  });
});
