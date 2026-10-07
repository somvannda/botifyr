import { describe, expect, it } from "vitest";
import { confidentPlan, planMedia } from "./server.js";

/**
 * The deterministic media planner must make retries and first sends behave the
 * same, and an explicit count ("only 5 videos") must beat "all".
 */
describe("planMedia", () => {
  it("downloads pasted URLs, with an explicit count beating 'all'", () => {
    const plan = planMedia("https://youtu.be/abc grab all his videos only 5 videos ok?");
    expect(plan.mediaTask).toBe(true);
    expect(plan.initialToolCall?.name).toBe("youtube.download");
    expect(plan.initialToolCall?.arguments.limit).toBe(5);
    expect(plan.initialToolOnly).toBe(true);
  });

  it("downloads a search when a download verb accompanies a query", () => {
    const plan = planMedia("grab 10 songs by Heng Pitou");
    expect(plan.initialToolCall?.name).toBe("youtube.download_search");
    expect(plan.initialToolCall?.arguments.count).toBe(10);
    expect(plan.initialToolOnly).toBe(true);
  });

  it("plain-searches when there is no download verb", () => {
    const plan = planMedia("find 10 links of Khmer songs");
    expect(plan.initialToolCall?.name).toBe("youtube.search");
    expect(plan.mediaTask).toBe(true);
    expect(plan.initialToolOnly).toBe(false);
  });

  it("leaves ordinary chat to the model", () => {
    expect(planMedia("hello, how are you?").mediaTask).toBe(false);
  });

  it("maps 'highest' to 2160p and 'mp3' to audio-only", () => {
    const plan = planMedia("grab this in highest quality as mp3 https://youtu.be/abc");
    expect(plan.initialToolCall?.name).toBe("youtube.download");
    expect(plan.initialToolCall?.arguments.quality).toBe(2160);
    expect(plan.initialToolCall?.arguments.audio_only).toBe(true);
  });

  it("flags a bulk search with no explicit count as low confidence", () => {
    const plan = planMedia("grab songs by Heng Pitou");
    expect(plan.initialToolCall?.name).toBe("youtube.download_search");
    expect(plan.confidence).toBe("low");
  });

  it("flags a download mixed with another ask as low confidence", () => {
    const plan = planMedia("download https://youtu.be/abc then summarize it for me");
    expect(plan.initialToolCall?.name).toBe("youtube.download");
    expect(plan.confidence).toBe("low");
  });

  it("confidentPlan drops a low-confidence guess so the model confirms", () => {
    expect(confidentPlan("grab songs by Heng Pitou").mediaTask).toBe(false);
    expect(confidentPlan("grab songs by Heng Pitou").initialToolCall).toBeUndefined();
    expect(confidentPlan("grab 10 songs by Heng Pitou").mediaTask).toBe(true);
    expect(confidentPlan("download https://youtu.be/abc").mediaTask).toBe(true);
  });
});
