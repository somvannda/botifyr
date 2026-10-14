import { useState, type ReactNode } from "react";

/**
 * A tiny, dependency-free markdown renderer that builds React elements (no
 * innerHTML), so model output can never inject markup. Supports fenced code,
 * headings, bullet/numbered lists, tables, horizontal rules, bold, italic,
 * inline code and links. Bare media URLs (and media links) render as inline
 * audio/video players, so a generated track can be played right in the chat.
 *
 * File names (e.g. OKRS.md, weekly-scorecard.md) become clickable refs when an
 * `onFileRef` handler is provided, so the reader can open the doc.
 */

const FILE_RE = /([A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|markdown|txt|csv|json|ya?ml|html?))/g;

function isFileName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|markdown|txt|csv|json|ya?ml|html?)$/.test(value);
}

const AUDIO_URL_RE = /\.(?:mp3|wav|m4a|aac|ogg|oga|opus|flac)(?:[?#].*)?$/i;
const VIDEO_URL_RE = /\.(?:mp4|webm|mov|m4v|ogv)(?:[?#].*)?$/i;

/**
 * Inline player for a media URL, plus a direct download link.
 *
 * Nothing is proxied through our server: playback streams from the provider's
 * CDN and the download goes straight to the same URL. When a streaming URL is
 * signed/expiring, pass a durable `download` URL too — playback starts on the
 * stream and, if it fails (expired), switches to the durable URL.
 */
function MediaPlayer({
  stream,
  download,
  cover,
  kind,
  title,
}: {
  stream: string;
  download?: string;
  cover?: string;
  kind: "audio" | "video";
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = failed && download ? download : stream;
  const href = download ?? stream;
  const mediaProps = { src, controls: true, preload: "metadata" as const, onError: () => setFailed(true) };
  return (
    <span className="md-media">
      {cover && <img className="md-media-cover" src={cover} alt="" loading="lazy" />}
      {title && <span className="md-media-title">{title}</span>}
      {kind === "audio" ? <audio className="md-audio" {...mediaProps} /> : <video className="md-video" {...mediaProps} />}
      <a className="md-download" href={href} download target="_blank" rel="noreferrer">
        {failed && !download ? "Couldn't play — download from Camxora" : "Download"}
      </a>
    </span>
  );
}

/** Render a media URL as a playable element; null when it isn't audio/video. */
function mediaPlayer(url: string, key: string): ReactNode | null {
  if (AUDIO_URL_RE.test(url)) return <MediaPlayer key={key} stream={url} kind="audio" />;
  if (VIDEO_URL_RE.test(url)) return <MediaPlayer key={key} stream={url} kind="video" />;
  return null;
}

/**
 * A fenced `media` block carries a stream URL and an optional durable download
 * URL, e.g.:
 *
 * ```media
 * { "stream": "https://cdn…/song.mp3?token=…", "download": "https://cdn…/song.mp3" }
 * ```
 *
 * The player starts on `stream` and falls back to `download` when it expires.
 */
function parseMediaBlock(segment: string): { stream: string; download?: string; cover?: string; kind: "audio" | "video"; title?: string } | null {
  const nl = segment.indexOf("\n");
  if (nl === -1 || segment.slice(0, nl).trim() !== "media") return null;
  try {
    const raw = JSON.parse(segment.slice(nl + 1).trim()) as {
      stream?: unknown;
      download?: unknown;
      cover?: unknown;
      title?: unknown;
    };
    if (typeof raw.stream !== "string" || !raw.stream) return null;
    return {
      stream: raw.stream,
      download: typeof raw.download === "string" ? raw.download : undefined,
      cover: typeof raw.cover === "string" ? raw.cover : undefined,
      kind: VIDEO_URL_RE.test(raw.stream) ? "video" : "audio",
      title: typeof raw.title === "string" ? raw.title : undefined,
    };
  } catch {
    return null;
  }
}

export interface MediaTrack {
  stream: string;
  download?: string;
  cover?: string;
  title?: string;
  kind: "audio" | "video";
}

/**
 * Pull the fenced `media` blocks out of a message so they can be shown as a
 * dedicated Results list instead of inline. The remaining prose is returned as
 * `body` (with the blocks removed).
 */
export function parseMediaBlocks(text: string): { body: string; tracks: MediaTrack[] } {
  const tracks: MediaTrack[] = [];
  const body = text
    .replace(/```media[^\n]*\n([\s\S]*?)```/g, (whole, inner: string) => {
      const parsed = parseMediaBlock(`media\n${String(inner).trim()}`);
      if (!parsed) return whole;
      tracks.push(parsed);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, tracks };
}

/** A structured "Results" list for generated tracks (title, cover, player, download). */
export function MediaResults({ tracks }: { tracks: MediaTrack[] }): ReactNode {
  if (tracks.length === 0) return null;
  return (
    <div className="md-results">
      <div className="md-results-title">{tracks.length === 1 ? "Result" : `Results (${tracks.length})`}</div>
      {tracks.map((track, index) => (
        <div className="md-result" key={`${track.stream}-${index}`}>
          <MediaPlayer
            stream={track.stream}
            download={track.download}
            cover={track.cover}
            kind={track.kind}
            title={track.title}
          />
        </div>
      ))}
    </div>
  );
}

function fileRef(name: string, key: string, onFileRef: (name: string) => void): ReactNode {
  return (
    <button key={key} type="button" className="file-ref" onClick={() => onFileRef(name)} title={`Open ${name}`}>
      {name}
    </button>
  );
}

/** Split plain text into text + clickable file references. */
function plainText(text: string, prefix: string, onFileRef?: (name: string) => void): ReactNode[] {
  if (!onFileRef || !text) return [text];
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  FILE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_RE.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(fileRef(match[1] as string, `${prefix}-f${index}`, onFileRef));
    last = match.index + (match[1] as string).length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function inline(text: string, prefix: string, onFileRef?: (name: string) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>()[\]]+)/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(...plainText(text.slice(last, match.index), `${prefix}-${index}`, onFileRef));
    const token = match[0];
    const key = `${prefix}-${index}`;
    if (token.startsWith("`")) {
      const inner = token.slice(1, -1);
      nodes.push(
        onFileRef && isFileName(inner) ? fileRef(inner, key, onFileRef) : <code key={key}>{inner}</code>,
      );
    } else if (token.startsWith("**")) {
      const inner = token.slice(2, -2);
      nodes.push(
        onFileRef && isFileName(inner) ? fileRef(inner, key, onFileRef) : <strong key={key}>{inner}</strong>,
      );
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const url = link?.[2] ?? "";
      nodes.push(
        mediaPlayer(url, key) ?? (
          <a key={key} href={url} target="_blank" rel="noreferrer">
            {link?.[1]}
          </a>
        ),
      );
    } else if (/^https?:\/\//.test(token)) {
      // A bare URL: play it when it's media, otherwise make it a clickable link.
      nodes.push(
        mediaPlayer(token, key) ?? (
          <a key={key} href={token} target="_blank" rel="noreferrer">
            {token}
          </a>
        ),
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(...plainText(text.slice(last), `${prefix}-tail`, onFileRef));
  return nodes;
}

const RULE_RE = /^\s*([-*_])\1{2,}\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function Markdown({ text, onFileRef }: { text: string; onFileRef?: (name: string) => void }) {
  const blocks: ReactNode[] = [];
  const segments = text.split("```");

  segments.forEach((segment, segIndex) => {
    if (segIndex % 2 === 1) {
      const media = parseMediaBlock(segment);
      if (media) {
        blocks.push(
          <MediaPlayer
            key={`media-${segIndex}`}
            stream={media.stream}
            download={media.download}
            kind={media.kind}
            title={media.title}
          />,
        );
        return;
      }
      blocks.push(
        <pre key={`code-${segIndex}`} className="md-code">
          <code>{segment.replace(/^\n/, "").replace(/\n$/, "")}</code>
        </pre>,
      );
      return;
    }

    const lines = segment.split("\n");
    let items: ReactNode[] = [];
    let listType: "ul" | "ol" | null = null;
    let paragraph: string[] = [];

    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      const content = paragraph.join("\n");
      if (content.trim())
        blocks.push(
          <p key={`p-${segIndex}-${blocks.length}`}>{inline(content, `p${segIndex}`, onFileRef)}</p>,
        );
      paragraph = [];
    };
    const flushList = () => {
      if (items.length === 0 || !listType) return;
      const key = `${listType}-${segIndex}-${blocks.length}`;
      blocks.push(listType === "ul" ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>);
      items = [];
      listType = null;
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] as string;

      // Tables: a header row followed by a separator row.
      if (TABLE_ROW_RE.test(line) && TABLE_SEP_RE.test(lines[lineIndex + 1] ?? "")) {
        flushParagraph();
        flushList();
        const header = cells(line);
        const bodyRows: string[][] = [];
        let row = lineIndex + 2;
        while (row < lines.length && TABLE_ROW_RE.test(lines[row] as string)) {
          bodyRows.push(cells(lines[row] as string));
          row += 1;
        }
        const key = `table-${segIndex}-${lineIndex}`;
        blocks.push(
          <table key={key} className="md-table">
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex}>{inline(cell, `${key}-h${cellIndex}`, onFileRef)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((bodyRow, rowIndex) => (
                <tr key={rowIndex}>
                  {bodyCells(bodyRow, header.length).map((cell, cellIndex) => (
                    <td key={cellIndex}>{inline(cell, `${key}-r${rowIndex}c${cellIndex}`, onFileRef)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
        );
        lineIndex = row - 1;
        continue;
      }

      // Horizontal rule.
      if (RULE_RE.test(line)) {
        flushParagraph();
        flushList();
        blocks.push(<hr key={`hr-${segIndex}-${lineIndex}`} />);
        continue;
      }

      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);

      if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length;
        const key = `h-${segIndex}-${lineIndex}`;
        const content = inline(heading[2], key, onFileRef);
        blocks.push(
          level === 1 ? (
            <h3 key={key}>{content}</h3>
          ) : level === 2 ? (
            <h4 key={key}>{content}</h4>
          ) : (
            <h5 key={key}>{content}</h5>
          ),
        );
        continue;
      }
      if (bullet) {
        flushParagraph();
        if (listType && listType !== "ul") flushList();
        listType = "ul";
        items.push(
          <li key={`li-${segIndex}-${lineIndex}`}>
            {inline(bullet[1], `li${segIndex}${lineIndex}`, onFileRef)}
          </li>,
        );
        continue;
      }
      if (numbered) {
        flushParagraph();
        if (listType && listType !== "ol") flushList();
        listType = "ol";
        items.push(
          <li key={`li-${segIndex}-${lineIndex}`}>
            {inline(numbered[1], `li${segIndex}${lineIndex}`, onFileRef)}
          </li>,
        );
        continue;
      }
      flushList();
      paragraph.push(line);
    }

    flushList();
    flushParagraph();
  });

  return <div className="md">{blocks}</div>;
}

/** Pad/truncate a body row so it lines up with the header column count. */
function bodyCells(row: string[], count: number): string[] {
  if (row.length >= count) return row.slice(0, count);
  return [...row, ...Array.from({ length: count - row.length }, () => "")];
}
