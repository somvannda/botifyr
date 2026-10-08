// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { decodeShare, fileIconFor, formatSize, previewText, sharedFileOf, sharedFilesOf } from "./BotifyrApp";

describe("sharedFileOf", () => {
  it("parses an attachment message into name + token", () => {
    expect(sharedFileOf("📎 hello.txt\n/shared/abc.def-_")).toEqual({
      name: "hello.txt",
      token: "abc.def-_",
      caption: "",
    });
  });

  it("parses an optional caption after the token line", () => {
    expect(sharedFileOf("📎 pic.png\n/shared/tok\nLook at this!")).toEqual({
      name: "pic.png",
      token: "tok",
      caption: "Look at this!",
    });
  });

  it("falls back to a generic name when the message has no label", () => {
    expect(sharedFileOf("/shared/tok123")).toEqual({
      name: "Shared file",
      token: "tok123",
      caption: "",
    });
  });

  it("returns null for plain messages", () => {
    expect(sharedFileOf("just a normal message")).toBeNull();
  });
});

describe("previewText", () => {
  it("shows the file name for an attachment (never the raw token)", () => {
    expect(previewText("📎 hello.txt\n/shared/abc.def")).toBe("📎 hello.txt");
  });

  it("collapses whitespace for normal messages", () => {
    expect(previewText("  hi   there \n")).toBe("hi there");
  });
});

describe("sharedFilesOf", () => {
  it("parses a single attachment", () => {
    expect(sharedFilesOf("📎 a.png\n/shared/t1")).toEqual({
      files: [{ name: "a.png", token: "t1" }],
      caption: "",
    });
  });

  it("parses an album with a caption", () => {
    expect(sharedFilesOf("📎 a.png\n/shared/t1\n📎 b.jpg\n/shared/t2\nHoliday!")).toEqual({
      files: [
        { name: "a.png", token: "t1" },
        { name: "b.jpg", token: "t2" },
      ],
      caption: "Holiday!",
    });
  });

  it("returns nothing for a plain message", () => {
    expect(sharedFilesOf("hello there")).toEqual({ files: [], caption: "" });
  });
});

describe("formatSize", () => {
  it("formats byte counts", () => {
    expect(formatSize(0)).toBe("");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1048576)).toBe("1 MB");
  });
});

describe("decodeShare", () => {
  it("decodes the payload name + size", () => {
    const payload = Buffer.from(JSON.stringify({ n: "a.png", s: 2048 })).toString("base64url");
    expect(decodeShare(`${payload}.sig`)).toMatchObject({ n: "a.png", s: 2048 });
  });

  it("returns null for a malformed token", () => {
    expect(decodeShare("not-a-token")).toBeNull();
  });

  it("surfaces the size on a parsed attachment", () => {
    const payload = Buffer.from(JSON.stringify({ n: "a.png", s: 2048 })).toString("base64url");
    const { files } = sharedFilesOf(`📎 a.png\n/shared/${payload}.sig`);
    expect(files[0].size).toBe(2048);
  });
});

describe("fileIconFor", () => {
  it("picks a type icon from the extension", () => {
    expect(fileIconFor("report.pdf")).toBe("📕");
    expect(fileIconFor("sheet.XLSX")).toBe("📗");
    expect(fileIconFor("archive.zip")).toBe("🗜️");
  });

  it("falls back to a generic icon", () => {
    expect(fileIconFor("mystery")).toBe("📎");
  });
});
