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

export type AttachmentBucket = "photo" | "video" | "voice" | "file";

/**
 * Telegram-style bucket for a shared attachment. Recorded voice notes
 * (`voice-*.webm`, from the composer) are separated from real videos even
 * though both use a `.webm` extension.
 */
export function attachmentBucket(name: string): AttachmentBucket {
  if (/^voice-/i.test(name)) return "voice";
  const kind = mediaKind(name);
  if (kind === "image") return "photo";
  if (kind === "video") return "video";
  if (kind === "audio") return "voice";
  return "file";
}
