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

export interface MediaRecipeHint {
  pattern: string;
  headers?: Record<string, string>;
}

export interface MediaToolOptions {
  /** Default max video height when the model doesn't specify one. */
  quality?: number;
  /** Default to audio-only (much faster for big batches). */
  audioOnly?: boolean;
  /** Approved extraction recipe for a URL's domain (null when none). */
  getRecipe?: (url: string) => Promise<MediaRecipeHint | null>;
  /** Persist a self-learned recipe (as pending) for admin approval. */
  proposeRecipe?: (recipe: {
    domain: string;
    pattern: string;
    headers?: Record<string, string>;
    note?: string;
  }) => Promise<void>;
  /**
   * Ask a browser to open a page and return the media (m3u8/mp4) URL it loads.
   * For SPA players whose stream URL isn't in the HTML.
   */
  sniffMedia?: (url: string) => Promise<string | null>;
  /** Also save subtitle tracks (as `.srt`) next to the video when available. */
  subtitles?: boolean;
  /** Preferred subtitle languages, e.g. `en,km` (default). */
  subtitleLangs?: string;
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
    const common = `${cookies}--no-playlist --ignore-errors --continue --no-overwrites --no-warnings --no-progress`;
    // Save subtitle tracks next to the video when the site provides them.
    const subtitleLangs = (options.subtitleLangs ?? "en,km").replace(/[^a-zA-Z0-9,\-_]/g, "");
    const subsFlag =
      options.subtitles === true && subtitleLangs
        ? `--write-subs --write-auto-subs --sub-langs '${subtitleLangs}' --convert-subs srt `
        : "";
    await backend.exec(`mkdir -p '${outDir}'`);

    let ok = true;
    // 1) A learned recipe for this domain (if approved), then 2) the generic
    // sniffer: fetch the page and pull an HLS/MP4 URL out of it. Handles plain
    // and JSON-escaped (https:\/\/…) URLs, which most players embed.
    const tryRecipe = async (url: string): Promise<boolean> => {
      if (!options.getRecipe) return false;
      const recipe = await options.getRecipe(url).catch(() => null);
      if (!recipe?.pattern) return false;
      const headerFlags = recipe.headers
        ? Object.entries(recipe.headers)
            .map(([key, value]) => `-H '${key}: ${String(value).replace(/['\n\r]/g, "")}'`)
            .join(" ")
        : "";
      const pattern = recipe.pattern.replace(/['\n\r]/g, "");
      await backend.exec(
        `curl -sL ${headerFlags} -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' '${url}' -o /workspace/_page.html`,
      );
      const probe = await backend.exec(`grep -oE '${pattern}' /workspace/_page.html | head -n 3`);
      const candidate = probe.output
        .split("\n")
        .map((line) => line.trim().replace(/\\\//g, "/"))
        .filter((line) => /^https?:\/\/.+\.(m3u8|mp4)/.test(line))[0];
      if (!candidate) return false;
      const retry = await backend.exec(
        audio
          ? `yt-dlp ${common} -x --audio-format mp3 -o ${template} '${candidate}'`
          : `yt-dlp ${common} -f 'bv*[height<=${height}]+ba/b[height<=${height}]' ` +
              `--merge-output-format mp4 ${subsFlag}-o ${template} '${candidate}'`,
      );
      return retry.ok;
    };

    // Open the page in a browser and capture the media request (SPA players).
    const trySniff = async (url: string): Promise<boolean> => {
      if (!options.sniffMedia) return false;
      const candidate = await options.sniffMedia(url).catch(() => null);
      if (!candidate) return false;
      const retry = await backend.exec(
        audio
          ? `yt-dlp ${common} -x --audio-format mp3 -o ${template} '${candidate}'`
          : `yt-dlp ${common} -f 'bv*[height<=${height}]+ba/b[height<=${height}]' ` +
              `--merge-output-format mp4 ${subsFlag}-o ${template} '${candidate}'`,
      );
      return retry.ok;
    };

    const tryFallback = async (url: string): Promise<boolean> => {
      await backend.exec(
        `curl -sL -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' '${url}' -o /workspace/_page.html`,
      );
      const probe = await backend.exec(
        `grep -oE 'https?:[^" <>]+\\.(m3u8|mp4)' /workspace/_page.html | head -n 10`,
      );
      const candidates = probe.output
        .split("\n")
        .map((line) => line.trim().replace(/\\\//g, "/"))
        .filter((line) => /^https?:\/\/.+\.(m3u8|mp4)/.test(line));
      const candidate = candidates[0];
      if (!candidate) return false;
      const retry = await backend.exec(
        audio
          ? `yt-dlp ${common} -x --audio-format mp3 -o ${template} '${candidate}'`
          : `yt-dlp ${common} -f 'bv*[height<=${height}]+ba/b[height<=${height}]' ` +
              `--merge-output-format mp4 ${subsFlag}-o ${template} '${candidate}'`,
      );
      return retry.ok;
    };

    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      context.log(`download ${index + 1}/${urls.length} ${url}`);
      const command = audio
        ? `yt-dlp ${common} -x --audio-format mp3 -o ${template} '${url}'`
        : `yt-dlp ${common} -f 'bv*[height<=${height}]+ba/b[height<=${height}]' ` +
          `--merge-output-format mp4 ${subsFlag}-o ${template} '${url}'`;
      const result = await backend.exec(command);
      if (!result.ok) {
        const recovered = (await tryRecipe(url)) || (await trySniff(url)) || (await tryFallback(url));
        if (!recovered) ok = false;
      }
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
      // Print selected fields directly (no JSON parsing, so no truncation and
      // no failure when a field is missing).
      return backend.exec(
        `yt-dlp --no-playlist --no-warnings --print ` +
          `"Title: %(title)s\\nUploader: %(uploader)s\\nDuration: %(duration_string)s\\n` +
          `Views: %(view_count)s\\nUploaded: %(upload_date)s\\nThumbnail: %(thumbnail)s" '${url}'`,
      );
    },
  };

  const learnRecipe: ToolDefinition = {
    name: "media.learn_recipe",
    description:
      "Record a per-domain extraction recipe after you've found the real media URL (e.g. by watching the page's network in the browser). It's saved for admin approval, then reused automatically for that site.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "A sample page URL on the site." },
        pattern: { type: "string", description: "Regex that matches the stream URL in the page/API body." },
        headers: { type: "object", description: "Optional headers needed (Referer, User-Agent, …)." },
        note: { type: "string", description: "Optional note, e.g. the sample page used." },
      },
      required: ["url", "pattern"],
    },
    run: async (args) => {
      if (!options.proposeRecipe) {
        return { ok: false, output: "Recipe learning isn't enabled on this server." };
      }
      const url = safeUrl(args.url);
      if (!url) return { ok: false, output: "A valid http(s) sample URL is required." };
      const pattern = String(args.pattern ?? "")
        .trim()
        .slice(0, 400);
      if (!pattern) return { ok: false, output: "A regex pattern is required." };
      let domain = "";
      try {
        domain = new URL(url).hostname.toLowerCase();
      } catch {
        return { ok: false, output: "Could not determine the domain from the URL." };
      }
      const headers =
        args.headers && typeof args.headers === "object"
          ? Object.fromEntries(
              Object.entries(args.headers as Record<string, unknown>)
                .filter(([, value]) => typeof value === "string")
                .map(([key, value]) => [key, String(value)]),
            )
          : undefined;
      try {
        await options.proposeRecipe({
          domain,
          pattern,
          headers,
          note: typeof args.note === "string" ? args.note.slice(0, 300) : undefined,
        });
      } catch (error) {
        return {
          ok: false,
          output: `Could not save the recipe: ${error instanceof Error ? error.message : "unknown error"}`,
        };
      }
      return {
        ok: true,
        output: `Proposed a recipe for ${domain}. An admin must approve it before it's used automatically.`,
      };
    },
  };

  const sniff: ToolDefinition = {
    name: "media.sniff",
    description:
      "Open a page in a browser and return the media (m3u8/mp4) URL it loads. Use it for sites yt-dlp can't handle (e.g. short-drama apps), then download the returned URL with youtube.download.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "The page URL to inspect." } },
      required: ["url"],
    },
    run: async (args) => {
      const url = safeUrl(args.url);
      if (!url) return { ok: false, output: "A valid http(s) URL is required." };
      if (!options.sniffMedia) {
        return { ok: false, output: "Sniffing isn't available in this environment." };
      }
      const found = await options.sniffMedia(url).catch(() => null);
      return found
        ? { ok: true, output: `Found media URL: ${found}` }
        : {
            ok: false,
            output: "No media URL captured. Open the page and press play, then try again.",
          };
    },
  };

  return { tools: [download, downloadSearch, search, info, learnRecipe, sniff] };
}
