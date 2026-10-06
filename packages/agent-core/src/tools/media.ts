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

export function createMediaTools(
  backend: ShellBackend,
  outDir = "/workspace",
  getCookies?: () => Promise<string | null>,
): MediaTools {
  const cookieArg = async (): Promise<string> => {
    if (!getCookies) return "";
    try {
      const cookies = await getCookies();
      if (!cookies || !cookies.trim()) return "";
      await backend.writeFile("cookies.txt", cookies);
      return "--cookies /workspace/cookies.txt ";
    } catch {
      return "";
    }
  };

  const download: ToolDefinition = {
    name: "youtube.download",
    description:
      "Download a YouTube video (or its audio) with yt-dlp. Files are saved to the downloads folder so the user can retrieve them.",
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
      const cookies = await cookieArg();
      const command = audio
        ? `mkdir -p '${outDir}' && rm -f '${outDir}'/audio.* && ` +
          `yt-dlp ${cookies}--no-playlist -x --audio-format mp3 -o '${outDir}/audio.%(ext)s' '${url}' && ls -lh '${outDir}'`
        : `mkdir -p '${outDir}' && rm -f '${outDir}'/video.* && ` +
          `yt-dlp ${cookies}--no-playlist -f 'bv*[height<=${height}]+ba/b[height<=${height}]' --merge-output-format mp4 ` +
          `-o '${outDir}/video.%(ext)s' '${url}' && ls -lh '${outDir}'`;
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
