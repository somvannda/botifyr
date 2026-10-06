import type { ReactNode } from "react";

/**
 * A tiny, dependency-free markdown renderer that builds React elements (no
 * innerHTML), so model output can never inject markup. Supports fenced code,
 * headings, bullet/numbered lists, bold, italic, inline code and links.
 */

function inline(text: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${prefix}-${index}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
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
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
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
        blocks.push(<p key={`p-${segIndex}-${blocks.length}`}>{inline(content, `p${segIndex}`)}</p>);
      paragraph = [];
    };
    const flushList = () => {
      if (items.length === 0 || !listType) return;
      const key = `${listType}-${segIndex}-${blocks.length}`;
      blocks.push(listType === "ul" ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>);
      items = [];
      listType = null;
    };

    lines.forEach((line, lineIndex) => {
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);

      if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length;
        const key = `h-${segIndex}-${lineIndex}`;
        const content = inline(heading[2], key);
        blocks.push(
          level === 1 ? (
            <h3 key={key}>{content}</h3>
          ) : level === 2 ? (
            <h4 key={key}>{content}</h4>
          ) : (
            <h5 key={key}>{content}</h5>
          ),
        );
        return;
      }
      if (bullet) {
        flushParagraph();
        if (listType && listType !== "ul") flushList();
        listType = "ul";
        items.push(
          <li key={`li-${segIndex}-${lineIndex}`}>{inline(bullet[1], `li${segIndex}${lineIndex}`)}</li>,
        );
        return;
      }
      if (numbered) {
        flushParagraph();
        if (listType && listType !== "ol") flushList();
        listType = "ol";
        items.push(
          <li key={`li-${segIndex}-${lineIndex}`}>{inline(numbered[1], `li${segIndex}${lineIndex}`)}</li>,
        );
        return;
      }
      flushList();
      paragraph.push(line);
    });

    flushList();
    flushParagraph();
  });

  return <div className="md">{blocks}</div>;
}
