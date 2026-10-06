/**
 * Small, pure media helpers. Kept out of BotifyrApp.tsx so that file only
 * exports the component (React Fast Refresh requires a component-only module).
 */

export type MediaKind = "video" | "audio" | "image" | "file";

/** Classify a downloaded file by extension (Telegram-style media categories). */
export function mediaKind(name: string): MediaKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["mp4", "webm", "m4v", "mov", "mkv", "avi"].includes(ext)) return "video";
  if (["mp3", "m4a", "aac", "ogg", "wav", "flac"].includes(ext)) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  return "file";
}
