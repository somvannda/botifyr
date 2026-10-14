// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { CONNECTORS } from "@botifyr/shared";
import { ConnectorsPanel } from "./ConnectorsPanel";

/** The marketplace explanation surface, rendered from the shared registry. */
describe("ConnectorsPanel", () => {
  it("renders one row per connector in the registry", () => {
    const { container } = render(<ConnectorsPanel />);
    expect(container.querySelectorAll(".conn-row").length).toBe(CONNECTORS.length);
  });

  it("shows the capabilities a connector provides, with its risk", () => {
    const { container } = render(<ConnectorsPanel />);
    const text = container.textContent ?? "";
    expect(text).toContain("ads.manage");
    expect(text).toContain("spends money"); // ads.manage risk
  });

  it("explains who acts on the user's behalf when expanded", () => {
    const { container } = render(<ConnectorsPanel />);
    expect(container.querySelector(".conn-details")).toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>(".conn-toggle");
    if (!toggle) throw new Error("expected a details toggle");
    fireEvent.click(toggle);
    const details = container.querySelector(".conn-details");
    expect(details).toBeTruthy();
    expect(details?.textContent).toContain("acts on your");
  });

  it("marks a connected connector as Added instead of offering Add", () => {
    const { container } = render(<ConnectorsPanel connected={["zernio"]} />);
    const row = container.querySelector(".conn-row");
    expect(row?.textContent).toContain("Added");
  });

  it("calls onAdd with the connector id", () => {
    const onAdd = vi.fn();
    const { container } = render(<ConnectorsPanel onAdd={onAdd} />);
    const add = container.querySelector<HTMLButtonElement>(".market-btn");
    if (!add) throw new Error("expected an add button");
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]?.[0]).toBe(CONNECTORS[0]?.id);
  });
});
