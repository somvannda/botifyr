import { describe, expect, it } from "vitest";
import { mediaKind } from "./BotifyrApp";

describe("mediaKind", () => {
  it("classifies media by file extension, case-insensitively", () => {
    expect(mediaKind("song.mp4")).toBe("video");
    expect(mediaKind("clip.MKV")).toBe("video");
    expect(mediaKind("track.mp3")).toBe("audio");
    expect(mediaKind("voice.m4a")).toBe("audio");
    expect(mediaKind("cover.PNG")).toBe("image");
    expect(mediaKind("notes.txt")).toBe("file");
    expect(mediaKind("archive.zip")).toBe("file");
    expect(mediaKind("noextension")).toBe("file");
  });
});
