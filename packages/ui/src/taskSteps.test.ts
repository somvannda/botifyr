// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { TaskStep } from "@botifyr/shared";
import { stepDetail, visibleSteps } from "./BotifyrApp";

function step(partial: Partial<TaskStep> & Pick<TaskStep, "title" | "status">): TaskStep {
  return { id: partial.id ?? Math.random().toString(36).slice(2), index: 0, ...partial };
}

describe("visibleSteps", () => {
  it("drops finished 'Thinking' heartbeats but keeps the running one", () => {
    const steps = [
      step({ title: "Thinking", status: "done", detail: "Chose an action" }),
      step({ title: "music.task", status: "done", detail: '{"job_id":"x"}' }),
      step({ title: "Thinking", status: "done", detail: "Chose an action" }),
      step({ title: "Thinking", status: "running", detail: "Deciding the next action" }),
    ];
    const visible = visibleSteps(steps);
    expect(visible).toHaveLength(2);
    expect(visible.map((entry) => entry.title)).toEqual(["music.task", "Thinking"]);
    expect(visible[1].status).toBe("running");
  });
});

describe("stepDetail", () => {
  it("hides raw JSON output (truncated or not)", () => {
    expect(stepDetail(step({ title: "music.task", status: "done", detail: '{"job_id":"a"}' }))).toBeNull();
    expect(
      stepDetail(step({ title: "music.task", status: "done", detail: '{"job_id":"a","type":"lyrics","result":{"text…' })),
    ).toBeNull();
  });

  it("hides generated-media output even when it isn't JSON", () => {
    expect(stepDetail(step({ title: "music.generate", status: "done", detail: "https://cdn/x.mp3" }))).toBeNull();
  });

  it("turns a failed step into a friendly sentence, never the raw payload", () => {
    const detail = stepDetail(
      step({
        title: "music.generate",
        status: "failed",
        detail: 'Camxora error 400: {"error":"gpt_description_prompt or prompt is required"}',
      }),
    );
    expect(detail).toBeTruthy();
    expect(detail).not.toContain("gpt_description_prompt");
    expect(detail).not.toContain("Camxora error 400");
    expect(detail).not.toMatch(/[{}"]/);
    expect(detail).toMatch(/HTTP 400/);
  });

  it("keeps short, human-readable detail (e.g. a shell command)", () => {
    expect(stepDetail(step({ title: "shell.exec", status: "done", detail: "$ echo done" }))).toBe("$ echo done");
  });
});
