import type { ToolDefinition } from "../types.js";
import type { ShellBackend } from "./shell.js";

/**
 * Media tools backed by yt-dlp (installed in the code sandbox). Downloads land
 * in the sandbox workspace, so the agent can then process them with shell/code.
 */

/** Only allow http(s) URLs and strip characters that could break out of the
 * single-quoted shell argument. */
function safeUrl(value: unknown): string | null {
  const url = String(value ?? "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return null;
  return url.replace(/['"`\\\n\r]/g, "");
}

export interface MediaTools {
  tools: ToolDefinition[];
}

export function createMediaTools(backend: ShellBackend): MediaTools {
  const download: ToolDefinition = {
    name: "youtube.download",
    description:
      "Download a YouTube video (or its audio) into the sandbox workspace with yt-dlp. Returns the saved file list.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "YouTube (or other yt-dlp supported) URL." },
        audio_only: { type: "boolean", description: "Extract audio as mp3 instead of video." },
        quality: { type: "number", description: "Max video height, e.g. 720 or 1080 (default 1080)." },
      },
      required: ["url"],
    },
    requiresApproval: true,
    run: async (args) => {
      const url = safeUrl(args.url);
      if (!url) return { ok: false, output: "A valid http(s) URL is required." };
      const audio = args.audio_only === true;
      const height = Math.min(2160, Math.max(144, Number(args.quality) || 1080));
      const command = audio
        ? `cd /workspace && rm -f audio.* && yt-dlp --no-playlist -x --audio-format mp3 -o 'audio.%(ext)s' '${url}' && ls -lh`
        : `cd /workspace && rm -f video.* && ` +
          `yt-dlp --no-playlist -f 'bv*[height<=${height}]+ba/b[height<=${height}]' --merge-output-format mp4 ` +
          `-o 'video.%(ext)s' '${url}' && ls -lh`;
      return backend.exec(command);
    },
  };

  const info: ToolDefinition = {
    name: "youtube.info",
    description: "Get metadata (title, duration, formats) for a YouTube URL via yt-dlp.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    run: async (args) => {
      const url = safeUrl(args.url);
      if (!url) return { ok: false, output: "A valid http(s) URL is required." };
      return backend.exec(`yt-dlp --no-playlist --dump-single-json '${url}' | head -c 2000`);
    },
  };

  return { tools: [download, info] };
}
