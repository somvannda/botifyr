import type { Skill } from "@botifyr/shared";

/**
 * Built-in knowledge packs ("skills") a bot can be taught. Selecting a skill
 * injects its guide into the bot's system instructions, so the agent follows the
 * right steps for a given tool/workflow.
 */

export interface SkillDefinition extends Skill {
  content: string;
}

export const SKILLS: SkillDefinition[] = [
  {
    id: "capcut",
    name: "CapCut (video editing)",
    description: "Edit and export videos in CapCut's desktop app.",
    content: [
      "CapCut (desktop) — operator guide.",
      "Import: drag media into the media panel, or Media > Import.",
      "Timeline: drag a clip onto the timeline; move the playhead and press Ctrl+B (razor) to split; select a clip and Delete to remove; drag its edges to trim.",
      "Arrange: drag clips left/right to reorder; use the timeline zoom slider for precision.",
      "Text: Text > Add text (or press T), type in the preview, then set font/size/color in the right panel. Auto captions: Text > Auto captions > choose language > Generate.",
      "Transitions: open the Transitions tab and drag one between two clips.",
      "Audio: Audio > import or use built-in tracks; set volume (and keyframes for fades) in the right panel.",
      "Effects/filters/animations: Effects tab; drag onto a clip.",
      "Speed: right panel > Speed (0.1x–100x) or a speed curve.",
      "Export: press Ctrl+E (or Export, top-right); choose resolution (1080p), frame rate (30 or 60), format MP4; pick an output folder.",
      "Shortcuts: Space play/pause, Ctrl+B split, Ctrl+Z undo, Ctrl+E export, T text, +/- timeline zoom.",
      "Working tips: keep source assets and exports in the sandbox workspace (e.g. /workspace/in and /workspace/out); after exporting, verify with `ls -lh`.",
    ].join(" "),
  },
  {
    id: "youtube",
    name: "YouTube download & clip",
    description: "Download YouTube media with yt-dlp and process it with ffmpeg.",
    content: [
      "YouTube workflow (runs in the code sandbox; needs the 'code' capability).",
      "Finding links: youtube.search({ query, count }) returns matching video URLs (title + link) straight from yt-dlp — prefer it over scraping the browser. In a group chat, @mention the member who should download and include the URLs in that same message so they can act on them.",
      "Other sites: youtube.download uses yt-dlp, which also supports WeTV, iQIYI, Vimeo, X/Twitter, TikTok, Facebook and many more. For short-drama platforms yt-dlp doesn't handle directly (DramaBox, Hongguo, GoodShort, ShortMax, NetShort, QQTV, DramaWave, FreeReels, RaptDrama, ReelLife, ShortFlix, DramaTV, DotDrama, iDrama) just pass the page URL: if yt-dlp fails, the tool fetches the page and downloads the first HLS/MP4 stream (.m3u8/.mp4) it finds. Those sites are mostly app/API-only, so a dedicated extractor may be needed for full support.",
      "Inspect first: youtube.info(url) returns the title, duration and available formats.",
      "Download: youtube.download({ url, audio_only, quality }) saves the file(s) into the downloads folder, which the app serves back to the user as Download links. For a list of links, call youtube.download ONCE with urls: [ ... ] (up to 50) rather than one call per link — one approval, one step, all files.",
      "If the user says 'download those links' without repeating them, list the links you can see (including from your own earlier chat with them) and confirm which ones to download before starting — end your reply with a fenced `options` block (e.g. each candidate link, plus 'All of them').",
      "If a download fails with HTTP 429 or a 'Sign in to confirm you're not a bot' error, the sandbox IP is being rate-limited by YouTube. Offer the user options (end your reply with a fenced `options` block): 'Add my YouTube cookies', 'Retry without cookies', 'Try a different URL'.",
      "The user can paste their cookies.txt (Netscape format) under Settings > Downloads (stored encrypted as the YOUTUBE_COOKIES secret); yt-dlp then uses it automatically on the next attempt.",
      "Then process with shell/code: ffmpeg can trim, convert, extract audio, resize, or burn subtitles.",
    ].join(" "),
  },
  {
    id: "video",
    name: "Video processing (ffmpeg)",
    description: "Trim, convert, compress and caption video with ffmpeg.",
    content: [
      "ffmpeg is available in the code sandbox.",
      "Trim: ffmpeg -ss 00:00:10 -to 00:00:25 -i in.mp4 -c copy out.mp4.",
      "Extract audio: ffmpeg -i in.mp4 -vn -acodec mp3 out.mp3.",
      "Resize/scale: ffmpeg -i in.mp4 -vf scale=1280:-2 out.mp4.",
      "Compress: ffmpeg -i in.mp4 -vcodec libx264 -crf 23 -preset veryfast out.mp4.",
      "Concatenate: create a list.txt of `file 'clip.mp4'` lines and run ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4.",
    ].join(" "),
  },
];

export function skillInstructions(ids: string[] | undefined): string {
  if (!ids || ids.length === 0) return "";
  return ids
    .map((id) => SKILLS.find((skill) => skill.id === id))
    .filter((skill): skill is SkillDefinition => Boolean(skill))
    .map((skill) => `## Skill: ${skill.name}\n${skill.content}`)
    .join("\n\n");
}
