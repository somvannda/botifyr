import { describe, expect, it } from "vitest";
import { unifiedLineDiff } from "./diff.js";

describe("unifiedLineDiff", () => {
  it("marks added and removed lines with context", () => {
    const diff = unifiedLineDiff("a\nb\nc", "a\nB\nc");
    expect(diff).toContain("  a");
    expect(diff).toContain("- b");
    expect(diff).toContain("+ B");
    expect(diff).not.toContain("- a");
  });

  it("treats a brand-new file as all additions", () => {
    const diff = unifiedLineDiff("", "hello\nworld");
    expect(diff).toContain("+ hello");
    expect(diff).toContain("+ world");
  });
});
