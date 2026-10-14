// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Markdown } from "./Markdown";

afterEach(() => cleanup());

/** Markdown renders media URLs (e.g. a Camxora track) as inline players. */
describe("Markdown media URLs", () => {
  it("renders a bare audio URL as an inline player", () => {
    const { container } = render(<Markdown text="Here: https://cdn.example/song.mp3?x=1 — enjoy" />);
    const audio = container.querySelector("audio.md-audio");
    expect(audio).toBeTruthy();
    expect(audio?.getAttribute("src")).toBe("https://cdn.example/song.mp3?x=1");
  });

  it("renders a video URL as a video player", () => {
    const { container } = render(<Markdown text="https://cdn.example/clip.mp4" />);
    expect(container.querySelector("video.md-video")).toBeTruthy();
  });

  it("leaves a non-media URL as a clickable link", () => {
    const { container } = render(<Markdown text="https://example.com/page" />);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/page");
    expect(container.querySelector("audio")).toBeNull();
  });

  it("renders a markdown link to an audio file as a player", () => {
    const { container } = render(<Markdown text="[track](https://cdn.example/a.m4a)" />);
    expect(container.querySelector("audio.md-audio")).toBeTruthy();
  });

  it("still renders bold text and ordinary links", () => {
    const { container } = render(<Markdown text="**bold** [site](https://example.com)" />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
  });
});
