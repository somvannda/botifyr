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

export interface MediaToolOptions {
  /** Default max video height when the model doesn't specify one. */
  quality?: number;
  /** Default to audio-only (much faster for big batches). */
  audioOnly?: boolean;
}

export function createMediaTools(
  backend: ShellBackend,
  outDir = "/workspace",
  getCookies?: () => Promise<string | null>,
  options: MediaToolOptions = {},
): MediaTools {
  const defaultQuality = Math.min(2160, Math.max(144, Number(options.quality) || 720));
  const defaultAudio = options.audioOnly === true;
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
      "Download one or many YouTube (or other yt-dlp supported) URLs with yt-dlp. For a list, pass `urls` (up to 50) instead of `url` — a single call downloads them all. Files are saved with their titles so the user can retrieve them.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "A single URL." },
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Multiple URLs to download in one call (preferred for lists of links).",
        },
        audio_only: { type: "boolean", description: "Extract audio as mp3 instead of video." },
        quality: { type: "number", description: "Max video height, e.g. 720 or 1080." },
      },
    },
    requiresApproval: true,
    run: async (args, context) => {
      const raw = Array.isArray(args.urls) ? args.urls : args.url !== undefined ? [args.url] : [];
      const urls = raw.map(safeUrl).filter((value): value is string => Boolean(value));
      if (urls.length === 0) return { ok: false, output: "At least one valid http(s) URL is required." };
      const list = urls.slice(0, 50);
      const audio = args.audio_only === true || (args.audio_only === undefined && defaultAudio);
      const height = Math.min(2160, Math.max(144, Number(args.quality) || defaultQuality));
      const cookies = await cookieArg();
      // Titles keep each file distinct, so a batch doesn't overwrite itself.
      const template = `'${outDir}/%(title)s [%(id)s].%(ext)s'`;
      const common = `${cookies}--no-playlist --ignore-errors --no-overwrites --no-warnings --no-progress`;
      await backend.exec(`mkdir -p '${outDir}'`);

      // Download one at a time so the transcript can show per-file progress.
      const outputs: string[] = [];
      let ok = true;
      for (let index = 0; index < list.length; index += 1) {
        if (list.length > 1) context.log(`download ${index + 1}/${list.length} ${list[index]}`);
        const url = `'${list[index]}'`;
        const command = audio
          ? `yt-dlp ${common} -x --audio-format mp3 -o ${template} ${url}`
          : `yt-dlp ${common} -f 'bv*[height<=${height}]+ba/b[height<=${height}]' ` +
            `--merge-output-format mp4 -o ${template} ${url}`;
        const result = await backend.exec(command);
        outputs.push(result.output);
        if (!result.ok) ok = false;
      }

      const listing = await backend.exec(`ls -lh '${outDir}'`);
      const tail = outputs.join("\n").slice(-2500);
      return { ok, output: `${tail}\n--- files ---\n${listing.output}`.slice(0, 6000) };
    },
  };

  const search: ToolDefinition = {
    name: "youtube.search",
    description:
      "Search YouTube and return matching video links (title + URL). Use this to find links when the user names an artist, song or topic instead of pasting URLs.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms, e.g. an artist or song." },
        count: { type: "number", description: "How many results (default 10, max 50)." },
      },
      required: ["query"],
    },
    run: async (args) => {
      const query = String(args.query ?? "")
        .replace(/['\n\r]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      if (!query) return { ok: false, output: "A search query is required." };
      const count = Math.min(50, Math.max(1, Number(args.count) || 10));
      const cookies = await cookieArg();
      const command =
        `yt-dlp ${cookies}'ytsearch${count}:${query}' --flat-playlist --no-warnings ` +
        `--print "%(webpage_url)s :: %(title)s" 2>&1 | head -n ${count}`;
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
      return backend.exec(`yt-dlp --no-playlist --no-warnings --dump-single-json '${url}' | head -c 1200`);
    },
  };

  return { tools: [download, search, info] };
}
