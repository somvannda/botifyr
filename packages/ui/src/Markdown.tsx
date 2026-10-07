import type { ReactNode } from "react";

/**
 * A tiny, dependency-free markdown renderer that builds React elements (no
 * innerHTML), so model output can never inject markup. Supports fenced code,
 * headings, bullet/numbered lists, tables, horizontal rules, bold, italic,
 * inline code and links.
 *
 * File names (e.g. OKRS.md, weekly-scorecard.md) become clickable refs when an
 * `onFileRef` handler is provided, so the reader can open the doc.
 */

const FILE_RE = /([A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|markdown|txt|csv|json|ya?ml|html?))/g;

function isFileName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|markdown|txt|csv|json|ya?ml|html?)$/.test(value);
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
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
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
      nodes.push(
        <a key={key} href={link?.[2]} target="_blank" rel="noreferrer">
          {link?.[1]}
        </a>,
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
