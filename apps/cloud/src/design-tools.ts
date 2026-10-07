import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";

/**
 * Design hands: turn a title/subtitle into a simple poster (SVG) saved to the
 * bot's Library. Self-contained (no browser, no vendor) — the artifact can be
 * attached to a social post. docs/company-workspace.md Part III §27.
 */

const HEX = /^#[0-9a-fA-F]{3,8}$/;

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value.trim()) ? value.trim() : fallback;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "poster"
  );
}

export function renderPoster(input: {
  title: string;
  subtitle?: string;
  background?: string;
  foreground?: string;
  accent?: string;
}): string {
  const bg = color(input.background, "#0f172a");
  const fg = color(input.foreground, "#ffffff");
  const accent = color(input.accent, "#38bdf8");
  const title = escapeXml(input.title).slice(0, 90);
  const subtitle = input.subtitle ? escapeXml(input.subtitle).slice(0, 120) : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${bg}"/>
  <rect x="0" y="0" width="1200" height="12" fill="${accent}"/>
  <text x="80" y="330" fill="${fg}" font-family="Inter, Arial, sans-serif" font-size="64" font-weight="700">${title}</text>
  ${
    subtitle
      ? `<text x="80" y="420" fill="${fg}" fill-opacity="0.8" font-family="Inter, Arial, sans-serif" font-size="32">${subtitle}</text>`
      : ""
  }
</svg>`;
}

export function createDesignTools(store: Store, userId: string, botId: string): ToolDefinition[] {
  return [
    {
      name: "design.poster",
      description:
        "Create a simple poster/cover (SVG) and save it to the Library. Use for social covers, announcements and simple visuals.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Main text." },
          subtitle: { type: "string", description: "Optional supporting line." },
          colors: {
            type: "array",
            items: { type: "string" },
            description: "Optional hex colors: [background, foreground, accent].",
          },
        },
        required: ["title"],
      },
      run: async (args) => {
        const title = String(args.title ?? "")
          .trim()
          .slice(0, 120);
        if (!title) return { ok: false, output: "A title is required." };
        const colors = Array.isArray(args.colors)
          ? args.colors.filter((entry): entry is string => typeof entry === "string").slice(0, 3)
          : [];
        const svg = renderPoster({
          title,
          subtitle: typeof args.subtitle === "string" ? args.subtitle : undefined,
          background: colors[0],
          foreground: colors[1],
          accent: colors[2],
        });
        const name = `poster-${slug(title)}.svg`;
        const existing = (await store.listFiles(botId)).find((file) => file.name === name);
        const now = new Date().toISOString();
        await store.upsertFile({
          id: existing?.id ?? randomUUID(),
          botId,
          userId,
          name,
          content: svg,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        return { ok: true, output: `Saved ${name} to the Library.` };
      },
    },
  ];
}
