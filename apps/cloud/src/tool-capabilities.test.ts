import { describe, expect, it } from "vitest";
import { capabilityForTool, removeDeniedTools } from "./tool-capabilities.js";

describe("tool capabilities", () => {
  it("maps tools to capabilities", () => {
    expect(capabilityForTool("library.write")).toBe("files.write");
    expect(capabilityForTool("library.read")).toBe("files.read");
    expect(capabilityForTool("social.publish")).toBe("social.publish");
    expect(capabilityForTool("browser.click")).toBe("browser.use");
    expect(capabilityForTool("design.poster")).toBe("files.write");
    expect(capabilityForTool("email.send")).toBe("email.send");
    expect(capabilityForTool("company.delegate")).toBeNull();
    expect(capabilityForTool("feed.read")).toBe("social.read_insights");
    expect(capabilityForTool("feed.insights")).toBe("social.read_insights");
    expect(capabilityForTool("feed.post")).toBe("social.publish");
    expect(capabilityForTool("feed.reel")).toBe("social.publish");
    expect(capabilityForTool("feed.thread")).toBe("social.reply");
    expect(capabilityForTool("group.post")).toBe("social.publish");
    expect(capabilityForTool("page.manage")).toBe("social.publish");
  });

  it("removes only tools whose capability is denied", () => {
    const tools = [{ name: "library.read" }, { name: "library.write" }, { name: "company.delegate" }];
    const kept = removeDeniedTools(tools, new Set(["files.write"]));
    expect(kept.map((tool) => tool.name)).toEqual(["library.read", "company.delegate"]);
  });

  it("returns the tools unchanged when nothing is denied", () => {
    const tools = [{ name: "library.write" }];
    expect(removeDeniedTools(tools, new Set())).toBe(tools);
  });
});
