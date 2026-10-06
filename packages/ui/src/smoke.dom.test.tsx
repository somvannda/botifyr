// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BotifyrApp } from "./BotifyrApp";
import { defaultBridge } from "./bridge";

/** DOM smoke test: the shared UI mounts and shows the sign-in screen. */
describe("BotifyrApp (DOM smoke)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 401 })));
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the sign-in screen when unauthenticated", async () => {
    render(<BotifyrApp bridge={defaultBridge} />);
    expect(await screen.findByText("Botifyr")).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });
});
