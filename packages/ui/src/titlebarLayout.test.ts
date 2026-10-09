import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Header / scroll layout guard.
 *
 * The shared UI is a fixed app shell: the host sizes a title bar via the
 * `--titlebar` CSS variable (see AGENTS.md §7) and the app content is offset
 * below it. A parallel refactor of `styles.css` once dropped these rules, which
 * let the document scroll and slid the content behind the header. These
 * assertions keep that from regressing.
 */

const css = readFileSync("packages/ui/src/styles.css", "utf8");

/** Raw declaration body of the first `selector { … }` rule. */
function rule(selector: string): string {
  const match = css.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  if (!match) throw new Error(`rule not found: ${selector}`);
  return match[1].replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("title bar layout guard", () => {
  it("sizes the title bar from the host --titlebar variable", () => {
    expect(rule(".titlebar")).toMatch(/height:\s*var\(--titlebar,\s*34px\)/);
  });

  it("offsets the app content below the title bar", () => {
    const app = rule(".app");
    expect(app).toMatch(/margin-top:\s*var\(--titlebar,\s*0px\)/);
    expect(app).toMatch(/height:\s*calc\(100vh - var\(--titlebar,\s*0px\)\)/);
  });

  it("never lets the document scroll behind the header", () => {
    expect(rule("html")).toMatch(/overflow:\s*hidden/);
  });

  it("offsets full-pane overlays below the title bar", () => {
    for (const selector of [".startup", ".apps-overlay", ".settings-overlay"]) {
      expect(rule(selector), `${selector} must offset by --titlebar`).toMatch(
        /inset:\s*var\(--titlebar,\s*0px\)/,
      );
    }
  });

  it("keeps the in-app top bars compact (52px)", () => {
    for (const selector of [".topbar", ".feed-topbar", ".cws-topbar"]) {
      expect(rule(selector), `${selector} should be 52px`).toMatch(/height:\s*52px/);
    }
  });
});
