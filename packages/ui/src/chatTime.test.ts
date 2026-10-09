// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { clockOf, dayKeyOf, dayLabelOf } from "./BotifyrApp";

/** Regression tests for the thread date/time helpers (separators + message times). */
describe("chat date/time helpers", () => {
  it("dayKeyOf groups by local calendar day, not timestamp", () => {
    const morning = new Date();
    morning.setHours(1, 0, 0, 0);
    const night = new Date(morning);
    night.setHours(23, 30, 0, 0);
    expect(dayKeyOf(morning.toISOString())).toBe(dayKeyOf(night.toISOString()));

    const nextDay = new Date(morning);
    nextDay.setDate(morning.getDate() + 1);
    expect(dayKeyOf(nextDay.toISOString())).not.toBe(dayKeyOf(morning.toISOString()));
  });

  it("dayLabelOf labels today and yesterday", () => {
    expect(dayLabelOf(new Date().toISOString())).toBe("Today");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(dayLabelOf(yesterday.toISOString())).toBe("Yesterday");
  });

  it("clockOf returns a local HH:MM time", () => {
    const at = new Date();
    at.setHours(9, 5, 0, 0);
    const expected = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    expect(clockOf(at.toISOString())).toBe(expected);
    expect(clockOf(at.toISOString())).toMatch(/\d{1,2}:\d{2}/);
  });

  it("degrades gracefully for missing or invalid timestamps", () => {
    expect(dayKeyOf(undefined)).toBeTruthy();
    expect(dayLabelOf("not-a-date")).toBe("");
    expect(clockOf("not-a-date")).toBe("");
    expect(clockOf(undefined)).toMatch(/\d{1,2}:\d{2}/);
  });
});
