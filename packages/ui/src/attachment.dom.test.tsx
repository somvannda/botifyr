// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AttachmentMessage } from "./BotifyrApp";

/** DOM tests for the presentational attachment renderer. */
describe("AttachmentMessage", () => {
  it("renders an image with a caption", () => {
    const { container } = render(<AttachmentMessage text={"📎 pic.png\n/shared/tok\nLook!"} />);
    expect(container.querySelector(".dm-preview-img")).toBeTruthy();
    expect(container.querySelector(".dm-caption")?.textContent).toBe("Look!");
  });

  it("renders a document chip (with type icon) for non-media", () => {
    const { container } = render(<AttachmentMessage text={"📎 report.pdf\n/shared/tok"} />);
    const chip = container.querySelector(".dm-file");
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain("report.pdf");
    expect(chip?.querySelector(".dm-file-ico")?.textContent).toBe("📕");
  });

  it("renders an album grid for multiple attachments", () => {
    const { container } = render(<AttachmentMessage text={"📎 a.png\n/shared/t1\n📎 b.jpg\n/shared/t2"} />);
    expect(container.querySelectorAll(".dm-album-cell").length).toBe(2);
    expect(container.querySelectorAll(".dm-preview-img").length).toBe(2);
  });

  it("renders a video element for video files", () => {
    const { container } = render(<AttachmentMessage text={"📎 clip.mp4\n/shared/tok"} />);
    expect(container.querySelector("video.dm-preview-video")).toBeTruthy();
  });

  it("renders nothing for a plain message", () => {
    const { container } = render(<AttachmentMessage text={"just a normal message"} />);
    expect(container.firstChild).toBeNull();
  });
});
