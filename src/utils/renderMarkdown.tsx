import React from "react";

/**
 * Parse markdown and render as React elements.
 * Supports: links [text](url), **bold**, bullet lists, numbered lists
 */

function renderInlineMarkdown(
  line: string,
  keyPrefix: string
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  const combinedRegex = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let match;
  let matchIndex = 0;

  while ((match = combinedRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }

    if (match[1] && match[2]) {
      parts.push(
        <a
          key={`${keyPrefix}-link-${matchIndex}`}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
        >
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      parts.push(
        <strong
          key={`${keyPrefix}-bold-${matchIndex}`}
          className="font-semibold"
        >
          {match[3]}
        </strong>
      );
    }

    lastIndex = match.index + match[0].length;
    matchIndex++;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts.length > 0 ? parts : line;
}

export function renderMarkdownText(text: string): React.ReactNode {
  const sections = text.split(/\n\n+/);

  return (
    <div className="space-y-3">
      {sections.map((section, sectionIdx) => {
        const lines = section.split("\n");

        // Check if section starts with a heading
        const firstLine = lines[0]?.trim() || "";
        const h2Match = firstLine.match(/^##\s+(.*)/);
        const h3Match = firstLine.match(/^###\s+(.*)/);

        if (h2Match || h3Match) {
          const headingText = h2Match ? h2Match[1] : h3Match![1];
          const remainingLines = lines.slice(1).filter((l) => l.trim());

          return (
            <div key={sectionIdx}>
              {h2Match ? (
                <div className="text-sm font-semibold text-slate-900 dark:text-white mt-1 mb-1">
                  {renderInlineMarkdown(headingText, `h2-${sectionIdx}`)}
                </div>
              ) : (
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-1 mb-0.5">
                  {renderInlineMarkdown(headingText, `h3-${sectionIdx}`)}
                </div>
              )}
              {remainingLines.length > 0 && (
                <div className="space-y-1">
                  {remainingLines.map((line, lineIdx) =>
                    renderLine(line, sectionIdx, lineIdx)
                  )}
                </div>
              )}
            </div>
          );
        }

        const isNumberedList = lines.some((l) => /^\d+\.\s/.test(l.trim()));
        const isBulletList = lines.some(
          (l) => /^[-•*]\s/.test(l.trim()) && !l.trim().startsWith("**")
        );

        if (isNumberedList || isBulletList) {
          return (
            <div key={sectionIdx} className="space-y-1">
              {lines.map((line, lineIdx) =>
                renderLine(line, sectionIdx, lineIdx)
              )}
            </div>
          );
        }

        return (
          <p key={sectionIdx}>
            {renderInlineMarkdown(
              section.replace(/\n/g, " "),
              `p-${sectionIdx}`
            )}
          </p>
        );
      })}
    </div>
  );
}

function renderLine(
  line: string,
  sectionIdx: number,
  lineIdx: number
): React.ReactNode {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const leadingSpaces = line.match(/^(\s*)/)?.[1].length || 0;
  const indentLevel = Math.floor(leadingSpaces / 2);

  const numberedMatch = trimmed.match(/^(\d+)\.\s*(.*)/);
  const bulletMatch = trimmed.match(/^[-•*]\s*(.*)/);

  const marginClasses = ["", "ml-4", "ml-8", "ml-12"];
  const marginClass = marginClasses[Math.min(indentLevel, 3)] || "";

  if (numberedMatch) {
    return (
      <div
        key={`${sectionIdx}-${lineIdx}`}
        className={`flex gap-2 ${marginClass}`}
      >
        <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">
          {numberedMatch[1]}.
        </span>
        <span>
          {renderInlineMarkdown(numberedMatch[2], `${sectionIdx}-${lineIdx}`)}
        </span>
      </div>
    );
  } else if (bulletMatch) {
    return (
      <div
        key={`${sectionIdx}-${lineIdx}`}
        className={`flex gap-2 ${marginClass}`}
      >
        <span className="text-slate-400 dark:text-slate-500 shrink-0">•</span>
        <span>
          {renderInlineMarkdown(bulletMatch[1], `${sectionIdx}-${lineIdx}`)}
        </span>
      </div>
    );
  } else {
    return (
      <div key={`${sectionIdx}-${lineIdx}`} className={marginClass}>
        {renderInlineMarkdown(trimmed, `${sectionIdx}-${lineIdx}`)}
      </div>
    );
  }
}
