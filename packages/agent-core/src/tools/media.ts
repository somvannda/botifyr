import type { ToolDefinition, ToolResult, ToolContext } from "../types.js";
import type { ShellBackend } from "./shell.js";

/**
 * Media tools backed by yt-dlp (installed in the code sandbox). Downloads land
 * in the shared downloads folder, which the cloud serves back to the user.
 */

/** Only allow http(s) URLs and strip characters that could break out of the
 * single-quoted shell argument. */
function safeUrl(value: unknown): string | null {
  const url = String(value ?? "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return null;
  return url.replace(/['"`\\\n\r]/g, "");
}

function safeQuery(value: unknown): string {
  return String(value ?? "")
    .replace(/['\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
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

  /** Download a concrete list of video URLs, logging progress per file. */
  const runDownloads = async (
    urls: string[],
    audio: boolean,
    height: number,
    context: Pick<ToolContext, "log">,
  ): Promise<ToolResult> => {
    const cookies = await cookieArg();
    const template = `'${outDir}/%(title)s [%(id)s].%(ext)s'`;
    const common = `${cookies}--no-playlist --ignore-errors --no-overwrites --no-warnings --no-progress`;
    await backend.exec(`mkdir -p '${outDir}'`);

    let ok = true;
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      context.log(`download ${index + 1}/${urls.length} ${url}`);
      const command = audio
        ? `yt-dlp ${common} -x --audio-format mp3 -o ${template} '${url}'`
        : `yt-dlp ${common} -f 'bv*[height<=${height}]+ba/b[height<=${height}]' ` +
          `--merge-output-format mp4 -o ${template} '${url}'`;
      const result = await backend.exec(command);
      if (!result.ok) ok = false;
    }

    const listing = await backend.exec(`ls -lh '${outDir}'`);
    const files = listing.output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const header = ok
      ? `Downloaded ${urls.length} item(s) into the downloads folder.`
      : `Downloaded with some errors (${urls.length} requested).`;
    return { ok, output: `${header}\n${files.join("\n")}`.slice(0, 4000) };
  };

  /** Enumerate a channel/playlist URL into individual video URLs. */
  const expandCollections = async (urls: string[], limit: number): Promise<string[]> => {
    const cookies = await cookieArg();
    const expanded: string[] = [];
    for (const url of urls) {
      const isCollection = /\/(channel|c|user)\/|\/playlist|[@?&]list=/.test(url);
      if (!isCollection) {
        expanded.push(url);
        continue;
      }
      const cap = limit > 0 ? limit : 500;
      const enumerated = await backend.exec(
        `yt-dlp ${cookies}--flat-playlist --no-warnings --print "%(webpage_url)s" '${url}' | head -n ${cap}`,
      );
      for (const line of enumerated.output.split("\n")) {
        const candidate = line.trim();
        if (/^https?:\/\//.test(candidate)) expanded.push(candidate);
      }
    }
    return (limit > 0 ? expanded.slice(0, limit) : expanded).slice(0, 500);
  };

  const resolveQuality = (value: unknown): number =>
    Math.min(2160, Math.max(144, Number(value) || defaultQuality));
  const resolveAudio = (value: unknown): boolean => value === true || (value === undefined && defaultAudio);

  const download: ToolDefinition = {
    name: "youtube.download",
    description:
      "Download one or many YouTube (or other yt-dlp supported) URLs with yt-dlp. For a list, pass `urls` (up to 50) instead of `url` — a single call downloads them all. A channel/playlist URL downloads its videos (use `limit`).",
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
        limit: {
          type: "number",
          description:
            "For a channel/playlist URL, how many videos to download (default 20; 0 = all, max 500).",
        },
      },
    },
    requiresApproval: true,
    run: async (args, context) => {
      const raw = Array.isArray(args.urls) ? args.urls : args.url !== undefined ? [args.url] : [];
      const urls = raw.map(safeUrl).filter((value): value is string => Boolean(value));
      if (urls.length === 0) return { ok: false, output: "At least one valid http(s) URL is required." };
      const limit = args.limit === undefined ? 20 : Math.max(0, Math.min(500, Number(args.limit) || 0));
      const finalList = await expandCollections(urls.slice(0, 50), limit);
      if (finalList.length === 0) {
        return { ok: false, output: "No downloadable videos were found at that URL." };
      }
      return runDownloads(finalList, resolveAudio(args.audio_only), resolveQuality(args.quality), context);
    },
  };

  const downloadSearch: ToolDefinition = {
    name: "youtube.download_search",
    description:
      "Search YouTube and download the top N matching videos in one step (no links needed). Use when the user names an artist/song/topic and asks to download, e.g. 'search X and download 10 videos'.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms, e.g. an artist or song." },
        count: { type: "number", description: "How many videos to download (default 10, max 50)." },
        audio_only: { type: "boolean", description: "Extract audio as mp3 instead of video." },
        quality: { type: "number", description: "Max video height, e.g. 720 or 1080." },
      },
      required: ["query"],
    },
    requiresApproval: true,
    run: async (args, context) => {
      const query = safeQuery(args.query);
      if (!query) return { ok: false, output: "A search query is required." };
      const count = Math.min(50, Math.max(1, Number(args.count) || 10));
      const cookies = await cookieArg();
      const found = await backend.exec(
        `yt-dlp ${cookies}'ytsearch${count}:${query}' --flat-playlist --no-warnings ` +
          `--print "%(webpage_url)s" 2>&1 | head -n ${count}`,
      );
      const urls = found.output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^https?:\/\//.test(line))
        .slice(0, count);
      if (urls.length === 0) return { ok: false, output: "No videos were found for that search." };
      return runDownloads(urls, resolveAudio(args.audio_only), resolveQuality(args.quality), context);
    },
  };

  const search: ToolDefinition = {
    name: "youtube.search",
    description:
      "Search YouTube and return matching video links (title + URL) without downloading. Use to find links when the user names an artist, song or topic.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms, e.g. an artist or song." },
        count: { type: "number", description: "How many results (default 10, max 50)." },
      },
      required: ["query"],
    },
    run: async (args) => {
      const query = safeQuery(args.query);
      if (!query) return { ok: false, output: "A search query is required." };
      const count = Math.min(50, Math.max(1, Number(args.count) || 10));
      const cookies = await cookieArg();
      return backend.exec(
        `yt-dlp ${cookies}'ytsearch${count}:${query}' --flat-playlist --no-warnings ` +
          `--print "%(webpage_url)s :: %(title)s" 2>&1 | head -n ${count}`,
      );
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

  return { tools: [download, downloadSearch, search, info] };
}
