import { Fragment } from "react";
import { cn } from "@/lib/utils";

export function MarkdownContent({
  text,
  variant = "assistant",
}: {
  text: string;
  variant?: "assistant" | "system";
}) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className={cn("space-y-2", variant === "system" && "text-xs")}>
      {blocks.map((block, index) => (
        <Fragment key={`md-${index}`}>{renderMarkdownBlock(block, index, variant)}</Fragment>
      ))}
    </div>
  );
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "hr" }
  | { type: "blockquote"; text: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

function parseMarkdownBlocks(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  const isBlank = (line: string) => line.trim() === "";
  const isFence = (line: string) => line.trimStart().startsWith("```");

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    if (isFence(line)) {
      const lang = trimmed.replace(/^```/, "").trim() || undefined;
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !isFence(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && isFence(lines[i])) i += 1;
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4,
        text: headingMatch[2].trim(),
      });
      i += 1;
      continue;
    }

    if (looksLikeMarkdownTable(lines, i)) {
      const header = splitTableRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", headers: header, rows });
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+/);
    const bulletMatch = trimmed.match(/^[-*+]\s+/);
    if (orderedMatch || bulletMatch) {
      const ordered = Boolean(orderedMatch);
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        if (ordered ? /^\d+\.\s+/.test(current) : /^[-*+]\s+/.test(current)) {
          items.push(current.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, ""));
          i += 1;
          continue;
        }
        if (isBlank(lines[i])) i += 1;
        break;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      const nextTrimmed = next.trim();
      if (
        isBlank(next) ||
        isFence(next) ||
        /^---+$/.test(nextTrimmed) ||
        /^#{1,4}\s+/.test(nextTrimmed) ||
        nextTrimmed.startsWith(">") ||
        looksLikeMarkdownTable(lines, i) ||
        /^\d+\.\s+/.test(nextTrimmed) ||
        /^[-*+]\s+/.test(nextTrimmed)
      ) {
        break;
      }
      paragraphLines.push(next);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

function looksLikeMarkdownTable(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const header = lines[index].trim();
  const separator = lines[index + 1].trim();
  if (!header.includes("|")) return false;
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(separator);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdownBlock(
  block: MarkdownBlock,
  index: number,
  variant: "assistant" | "system"
) {
  if (block.type === "hr") return <hr className="border-border/60" />;
  if (block.type === "heading") {
    const className =
      block.level === 1
        ? "text-base font-semibold"
        : block.level === 2
          ? "text-sm font-semibold"
          : "text-sm font-medium";
    return <h4 className={className}>{renderInlineMarkdown(block.text, `${index}-h`)}</h4>;
  }
  if (block.type === "paragraph") {
    return (
      <p className={cn("whitespace-pre-wrap leading-relaxed", variant === "system" && "leading-normal")}>
        {renderInlineMarkdown(block.text, `${index}-p`)}
      </p>
    );
  }
  if (block.type === "blockquote") {
    return (
      <blockquote className="border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground italic">
        {renderInlineMarkdown(block.text, `${index}-bq`)}
      </blockquote>
    );
  }
  if (block.type === "code") {
    return (
      <div className="rounded-md border bg-muted/70">
        {block.lang && (
          <div className="border-b px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {block.lang}
          </div>
        )}
        <pre className="max-h-72 overflow-auto p-2 text-xs">
          <code>{block.code}</code>
        </pre>
      </div>
    );
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className={cn("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
        {block.items.map((item, itemIndex) => (
          <li key={`${index}-li-${itemIndex}`} className="leading-relaxed">
            {renderInlineMarkdown(item, `${index}-li-${itemIndex}`)}
          </li>
        ))}
      </Tag>
    );
  }
  if (block.type === "table") {
    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[480px] border-collapse text-xs">
          <thead className="bg-muted/40">
            <tr>
              {block.headers.map((header, headerIndex) => (
                <th
                  key={`${index}-th-${headerIndex}`}
                  className="border-b px-2 py-1.5 text-left font-semibold align-top"
                >
                  {renderInlineMarkdown(header, `${index}-thc-${headerIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${index}-row-${rowIndex}`} className="border-t">
                {row.map((cell, cellIndex) => (
                  <td key={`${index}-td-${rowIndex}-${cellIndex}`} className="px-2 py-1.5 align-top">
                    {renderInlineMarkdown(cell, `${index}-tdc-${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

function renderInlineMarkdown(text: string, keyBase: string): React.ReactNode[] {
  const parts = text
    .split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|\[[^\]]+\]\([^)]+\))/g)
    .filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${keyBase}-${index}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyBase}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={`${keyBase}-${index}`}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("_") && part.endsWith("_")) {
      return <em key={`${keyBase}-${index}`}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("~~") && part.endsWith("~~")) {
      return <s key={`${keyBase}-${index}`}>{part.slice(2, -2)}</s>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a key={`${keyBase}-${index}`} href={linkMatch[2]} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {linkMatch[1]}
        </a>
      );
    }
    return <Fragment key={`${keyBase}-${index}`}>{part}</Fragment>;
  });
}
