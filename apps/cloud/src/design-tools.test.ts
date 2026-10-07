import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createDesignTools, renderPoster } from "./design-tools.js";

describe("design tools", () => {
  const ctx = { workspaceDir: ".", log: () => {} };

  it("renders the title into the SVG and escapes markup", () => {
    const svg = renderPoster({ title: "Grand <Open>", subtitle: "We're live & ready" });
    expect(svg).toContain("Grand &lt;Open&gt;");
    expect(svg).toContain("We're live &amp; ready");
  });

  it("rejects unsafe colors (no attribute injection)", () => {
    const svg = renderPoster({ title: "X", background: 'red" onload="alert(1)' });
    expect(svg).not.toContain("onload");
    expect(svg).toContain("#0f172a");
  });

  it("saves a poster to the bot's Library", async () => {
    const store = new MemoryStore();
    const [tool] = createDesignTools(store, "u1", "bot1");
    const result = await tool!.run({ title: "Launch Day" }, ctx);
    expect(result.ok).toBe(true);
    const files = await store.listFiles("bot1");
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("poster-launch-day.svg");
    expect(files[0]?.content).toContain("Launch Day");
  });

  it("rejects an empty title", async () => {
    const store = new MemoryStore();
    const [tool] = createDesignTools(store, "u1", "bot1");
    const result = await tool!.run({ title: "  " }, ctx);
    expect(result.ok).toBe(false);
  });
});
