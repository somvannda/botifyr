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
      "Inspect first: youtube.info(url) returns the title, duration and available formats.",
      "Download: youtube.download({ url, audio_only, quality }) saves video.mp4 (or audio.mp3) into /workspace.",
      "Then process with shell/code: ffmpeg can trim (-ss/-to), convert, extract audio, resize, or burn subtitles.",
      "The sandbox workspace is per-task; if the user needs the file on their own computer, export it there via the local machine tools or ask for a retrieval step.",
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
