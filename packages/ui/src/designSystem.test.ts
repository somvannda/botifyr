import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard (docs/design-system-audit.md).
 *
 * Protects the shared token layer from the two regressions we just fixed:
 *  1. The light theme must define every semantic color (it previously only
 *     overrode surfaces, so the dark accent/status colors were reused on white).
 *  2. The Feed must reference semantic tokens, not raw accent/danger literals.
 *
 * Also asserts the documented WCAG AA text-contrast pairs, so a future palette
 * tweak can't silently drop a color below 4.5:1.
 */

const css = readFileSync("packages/ui/src/styles.css", "utf8");

function block(selector: string): Record<string, string> {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`token block not found: ${selector}`);
  const out: Record<string, string> = {};
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, "");
  for (const decl of body.split(";")) {
    const [name, ...rest] = decl.split(":");
    if (name?.trim().startsWith("--")) out[name.trim()] = rest.join(":").trim();
  }
  return out;
}

function hex(value: string): string {
  const v = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`expected a 6-digit hex color, got "${value}"`);
  return v;
}

function lin(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(color: string): number {
  const h = hex(color).slice(1);
  return (
    0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(h.slice(4, 6), 16))
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composite a color at `alpha` over an opaque background, returning a hex. */
function composite(color: string, alpha: number, background: string): string {
  const fg = hex(color).slice(1);
  const bg = hex(background).slice(1);
  const channel = (i: number) => {
    const f = parseInt(fg.slice(i, i + 2), 16);
    const b = parseInt(bg.slice(i, i + 2), 16);
    return Math.round(f * alpha + b * (1 - alpha));
  };
  return `#${[0, 2, 4].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

const dark = block(":root");
const light = block('[data-theme="light"]');

const SEMANTIC = ["--accent", "--accent-2", "--ok", "--warn", "--danger"];

describe("design tokens", () => {
  it("exposes the shared semantic tints and shape scale", () => {
    for (const token of [
      "--accent-soft",
      "--accent-soft-strong",
      "--accent-border",
      "--accent-glow",
      "--accent-solid",
      "--accent-2-solid",
      "--danger-soft",
      "--danger-border",
      "--danger-solid",
      "--ok-soft",
      "--ok-border",
      "--warn-soft",
      "--warn-border",
      "--input-bg",
      "--overlay",
      "--focus-ring",
      "--radius-xs",
      "--radius-sm",
      "--radius-control",
      "--radius-md",
      "--radius-bubble",
      "--radius-card",
      "--radius-lg",
      "--radius-2xs",
      "--radius-pill",
      "--radius-round",
      "--text-4xs",
      "--text-3xs",
      "--text-2xs",
      "--text-xs",
      "--text-sm",
      "--text-md",
      "--text-lg",
      "--text-xl",
      "--text-2xl",
      "--text-3xl",
      "--text-4xl",
      "--text-5xl",
      "--space-1",
      "--space-2",
      "--space-3",
      "--space-4",
      "--space-5",
      "--space-6",
    ]) {
      expect(dark[token], `:root is missing ${token}`).toBeTruthy();
    }
  });

  it("overrides every semantic color in the light theme", () => {
    for (const token of [...SEMANTIC, "--input-bg"]) {
      expect(light[token], `[data-theme=light] is missing ${token}`).toBeTruthy();
      expect(light[token]).not.toBe(dark[token]);
    }
  });

  it("adopts the shape scale for the common corner radii", () => {
    for (const value of [
      "999px",
      "16px",
      "14px",
      "12px",
      "11px",
      "10px",
      "9px",
      "8px",
      "7px",
      "6px",
      "5px",
      "4px",
      "3px",
      "2px",
      "50%",
    ]) {
      expect(css, `border-radius: ${value} should use a --radius token`).not.toContain(
        `border-radius: ${value};`,
      );
    }
  });

  it("adopts the type scale for the common font sizes", () => {
    for (const value of [
      "10px",
      "10.5px",
      "11px",
      "11.5px",
      "12px",
      "12.5px",
      "13px",
      "13.5px",
      "14px",
      "15px",
      "16px",
      "18px",
    ]) {
      expect(css, `font-size: ${value} should use a --text token`).not.toContain(`font-size: ${value};`);
    }
  });

  it("routes keyboard focus outlines through --focus-ring", () => {
    expect(css).toContain("var(--focus-ring)");
    expect(css).not.toMatch(/outline:\s*2px solid var\(--accent\)/);
  });
});

describe("token values are pinned (visual-regression guard)", () => {
  it("dark semantic colors", () => {
    expect(dark["--bg"]).toBe("#0a0a0b");
    expect(dark["--accent"]).toBe("#6d8bff");
    expect(dark["--accent-2"]).toBe("#8f6dff");
    expect(dark["--ok"]).toBe("#3fd18b");
    expect(dark["--warn"]).toBe("#f2b544");
    expect(dark["--danger"]).toBe("#ff6b6b");
    expect(dark["--accent-solid"]).toBe("#5568e0");
    expect(dark["--danger-solid"]).toBe("#c8324a");
  });

  it("light semantic colors", () => {
    expect(light["--accent"]).toBe("#3d52c2");
    expect(light["--accent-2"]).toBe("#6d4ad6");
    expect(light["--ok"]).toBe("#0b7a44");
    expect(light["--warn"]).toBe("#8a5a00");
    expect(light["--danger"]).toBe("#c8324a");
    expect(light["--muted"]).toBe("#616875");
  });
});

describe("WCAG AA text contrast (both themes)", () => {
  const pairs: Array<[string, string]> = [
    ["--text", "--bg"],
    ["--text", "--panel"],
    ["--muted", "--bg"],
    ["--muted", "--panel"],
    ["--accent", "--bg"],
    ["--accent", "--panel"],
    ["--danger", "--bg"],
    ["--danger", "--panel"],
  ];

  for (const [themeName, tokens] of [
    ["dark", dark],
    ["light", light],
  ] as const) {
    for (const [fg, bg] of pairs) {
      it(`${themeName}: ${fg} on ${bg} >= 4.5:1`, () => {
        const fgColor = themeName === "light" && tokens[fg] ? tokens[fg] : dark[fg];
        const ratio = contrast(fgColor, tokens[bg]);
        expect(ratio, `${fg} on ${bg} was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("white text on the solid danger surface >= 4.5:1", () => {
    const ratio = contrast("#ffffff", dark["--danger-solid"]);
    expect(ratio, `white on --danger-solid was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("white text on the solid accent surfaces >= 4.5:1 (both themes)", () => {
    for (const token of ["--accent-solid", "--accent-2-solid"]) {
      for (const [name, tokens] of [
        ["dark", dark],
        ["light", light],
      ] as const) {
        const color = tokens[token] || dark[token];
        const ratio = contrast("#ffffff", color);
        expect(ratio, `white on ${name} ${token} was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("light: accent text clears AA on the accent-tinted pills (axe)", () => {
    const alphaOf = (token: string) => Number((dark[token].match(/(\d+(?:\.\d+)?)%/) || [])[1]) / 100;
    const soft = alphaOf("--accent-soft");
    const strong = alphaOf("--accent-soft-strong");
    const acc = light["--accent"];
    const cases: Array<[number, string, string]> = [
      [soft, light["--panel"], "14% tint on panel"],
      [soft, light["--bg"], "14% tint on bg"],
      [strong, light["--panel"], "22% tint on panel"],
    ];
    for (const [alpha, base, label] of cases) {
      const ratio = contrast(acc, composite(acc, alpha, base));
      expect(ratio, `accent on ${label} was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("Feed adopts the tokens", () => {
  const feedStart = css.indexOf("/* Feed (social wall)");
  const feedEnd = css.indexOf("/* Startup Workspace");
  const feed = css.slice(feedStart, feedEnd);

  it("found the Feed region", () => {
    expect(feedStart).toBeGreaterThan(-1);
    expect(feedEnd).toBeGreaterThan(feedStart);
  });

  it("no longer hardcodes accent/danger literals in the Feed", () => {
    expect(feed).not.toMatch(/rgba\(\s*109\s*,\s*139\s*,\s*255/);
    expect(feed).not.toMatch(/rgba\(\s*240\s*,\s*85\s*,\s*107/);
    expect(feed).not.toContain("#f0556b");
  });

  it("no longer hardcodes accent/danger color literals anywhere", () => {
    expect(css).not.toMatch(/rgba\(\s*109\s*,\s*139\s*,\s*255/);
    expect(css).not.toMatch(/rgba\(\s*240\s*,\s*85\s*,\s*107/);
    expect(css).not.toMatch(/rgba\(\s*239\s*,\s*68\s*,\s*68/);
    expect(css).not.toContain("#f0556b");
    expect(css).not.toMatch(/#f87171|#ef4444|#e5484d/i);
  });

  it("uses the semantic tint tokens for interactive Feed surfaces", () => {
    expect(feed).toContain("var(--accent-soft)");
    expect(feed).toContain("var(--accent-soft-strong)");
    expect(feed).toContain("var(--accent-border)");
    expect(feed).toContain("var(--danger-soft)");
    expect(feed).toContain("var(--danger-border)");
  });

  it("adopts the 4-pt spacing scale app-wide", () => {
    expect(css).toContain("var(--space-");
    const properties = [
      "gap",
      "row-gap",
      "column-gap",
      "padding",
      "padding-top",
      "padding-bottom",
      "margin",
      "margin-top",
      "margin-bottom",
    ];
    for (const value of [
      "2px",
      "3px",
      "4px",
      "5px",
      "6px",
      "7px",
      "8px",
      "9px",
      "10px",
      "12px",
      "14px",
      "16px",
    ]) {
      for (const prop of properties) {
        expect(css, `${prop}: ${value} should use a --space token`).not.toContain(`${prop}: ${value};`);
      }
    }
  });
});
