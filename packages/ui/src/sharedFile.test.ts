// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fileIconFor, previewText, sharedFileOf } from "./BotifyrApp";

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
