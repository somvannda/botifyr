import { describe, expect, it } from "vitest";
import { attachmentBucket, mediaKind } from "./mediaUtils";

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

describe("attachmentBucket", () => {
  it("maps media to Telegram-style buckets", () => {
    expect(attachmentBucket("pic.png")).toBe("photo");
    expect(attachmentBucket("clip.mp4")).toBe("video");
    expect(attachmentBucket("track.mp3")).toBe("voice");
    expect(attachmentBucket("report.pdf")).toBe("file");
  });

  it("separates recorded voice notes from real videos (both .webm)", () => {
    expect(attachmentBucket("voice-1699999999999.webm")).toBe("voice");
    expect(attachmentBucket("movie.webm")).toBe("video");
  });
});
