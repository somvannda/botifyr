// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Markdown, MediaResults, parseMediaBlocks } from "./Markdown";

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

  it("offers a direct download link to the CDN (no server proxy)", () => {
    const { container } = render(<Markdown text="https://cdn.example/song.mp3" />);
    const link = container.querySelector("a.md-download") as HTMLAnchorElement;
    expect(link?.getAttribute("href")).toBe("https://cdn.example/song.mp3");
    expect(link?.hasAttribute("download")).toBe(true);
  });

  it("falls back to the download link when playback fails (expired URL)", () => {
    const { container } = render(<Markdown text="https://cdn.example/song.mp3" />);
    const audio = container.querySelector("audio") as HTMLAudioElement;
    fireEvent.error(audio);
    expect(container.querySelector("a.md-download")?.textContent).toMatch(/download/i);
  });

  it("streams the media block's stream URL and swaps to the durable download on expiry", () => {
    const text = [
      "```media",
      JSON.stringify({ stream: "https://cdn.example/song.mp3?t=1", download: "https://cdn.example/song.mp3" }),
      "```",
    ].join("\n");
    const { container } = render(<Markdown text={text} />);
    const audio = container.querySelector("audio") as HTMLAudioElement;
    expect(audio?.getAttribute("src")).toBe("https://cdn.example/song.mp3?t=1");
    expect((container.querySelector("a.md-download") as HTMLAnchorElement)?.getAttribute("href")).toBe(
      "https://cdn.example/song.mp3",
    );
    fireEvent.error(audio);
    expect((container.querySelector("audio") as HTMLAudioElement)?.getAttribute("src")).toBe(
      "https://cdn.example/song.mp3",
    );
  });

  it("extracts media blocks into tracks and strips them from the body", () => {
    const text = [
      "Here are your tracks.",
      "```media",
      JSON.stringify({ stream: "https://s3/a.mp3", title: "Song A", cover: "https://s3/a.jpg" }),
      "```",
      "Enjoy!",
      "```media",
      JSON.stringify({ stream: "https://s3/b.mp3", title: "Song B" }),
      "```",
    ].join("\n");
    const { body, tracks } = parseMediaBlocks(text);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].title).toBe("Song A");
    expect(tracks[0].cover).toBe("https://s3/a.jpg");
    expect(tracks[1].stream).toBe("https://s3/b.mp3");
    expect(body).toContain("Here are your tracks.");
    expect(body).toContain("Enjoy!");
    expect(body).not.toContain("```media");
  });

  it("renders a Results list with one player per track", () => {
    const { container } = render(
      <MediaResults
        tracks={[
          { stream: "https://s3/a.mp3", title: "A", kind: "audio" },
          { stream: "https://s3/b.mp3", title: "B", kind: "audio" },
        ]}
      />,
    );
    expect(container.querySelectorAll("audio")).toHaveLength(2);
    expect(container.textContent).toContain("Results (2)");
    expect(container.textContent).toContain("A");
  });
});
