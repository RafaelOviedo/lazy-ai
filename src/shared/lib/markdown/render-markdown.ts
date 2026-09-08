import { escapeHtml } from "../html/index.js";

type ListKind = "ordered" | "unordered";

/**
 * Renders a small, terminal-friendly Markdown subset as escaped HTML.
 */
export function renderMarkdown(value: string): string {
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeFence = line.match(/^```\s*([^`]*)\s*$/);

    if (codeFence) {
      const language = codeFence[1]?.trim() ?? "";
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].match(/^```\s*$/)) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push(renderCodeBlock(codeLines.join("\n"), language));
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);

    if (heading) {
      blocks.push(`<div class="details-markdown__heading details-markdown__heading--${heading[1].length}">${renderInlineMarkdown(heading[2])}</div>`);
      index += 1;
      continue;
    }

    const blockquote = line.match(/^>\s?(.*)$/);

    if (blockquote) {
      const quoteLines: string[] = [];

      while (index < lines.length) {
        const quoteLine = lines[index].match(/^>\s?(.*)$/);

        if (!quoteLine) break;

        quoteLines.push(quoteLine[1]);
        index += 1;
      }

      blocks.push(`<div class="details-markdown__quote">${quoteLines.map(renderInlineMarkdown).join("<br>")}</div>`);
      continue;
    }

    const unorderedListItem = readListItem(line, "unordered");
    const orderedListItem = readListItem(line, "ordered");

    if (unorderedListItem || orderedListItem) {
      const kind: ListKind = unorderedListItem ? "unordered" : "ordered";
      const items: string[] = [];

      while (index < lines.length) {
        const item = readListItem(lines[index], kind);

        if (!item) break;

        items.push(renderListItem(item.marker, item.text));
        index += 1;
      }

      blocks.push(`<div class="details-markdown__list">${items.join("")}</div>`);
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length && shouldContinueParagraph(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    if (paragraphLines.length === 0) {
      blocks.push(`<div class="details-markdown__paragraph">${renderInlineMarkdown(line.trim())}</div>`);
      index += 1;
      continue;
    }

    blocks.push(`<div class="details-markdown__paragraph">${renderInlineMarkdown(paragraphLines.join(" "))}</div>`);
  }

  return blocks.join("");
}

/**
 * Renders inline Markdown markers after escaping user-provided text.
 */
function renderInlineMarkdown(value: string): string {
  const inlineCodeParts = value.split(/(`[^`]+`)/g);

  return inlineCodeParts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
        return `<span class="details-markdown__inline-code">${escapeHtml(part.slice(1, -1))}</span>`;
      }

      return renderEmphasis(escapeHtml(part));
    })
    .join("");
}

/**
 * Renders lightweight emphasis on escaped text.
 */
function renderEmphasis(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '<span class="details-markdown__strong">$1</span>')
    .replace(/\*([^*]+)\*/g, '<span class="details-markdown__em">$1</span>');
}

/**
 * Renders a fenced code block.
 */
function renderCodeBlock(code: string, language: string): string {
  const languageMarkup = language ? `<div class="details-markdown__code-language">${escapeHtml(language)}</div>` : "";

  return `
    <div class="details-markdown__code-block">
      ${languageMarkup}
      <pre class="details-markdown__code">${escapeHtml(code)}</pre>
    </div>
  `;
}

/**
 * Reads one supported list item.
 */
function readListItem(line: string, kind: ListKind): { marker: string; text: string } | null {
  if (kind === "unordered") {
    const match = line.match(/^\s*[-*]\s+(.+)$/);

    return match ? { marker: "-", text: match[1] } : null;
  }

  const match = line.match(/^\s*(\d+)[.)]\s+(.+)$/);

  return match ? { marker: `${match[1]}.`, text: match[2] } : null;
}

/**
 * Renders one list row.
 */
function renderListItem(marker: string, text: string): string {
  return `
    <div class="details-markdown__list-item">
      <span class="details-markdown__list-marker">${escapeHtml(marker)}</span>
      <span class="details-markdown__list-text">${renderInlineMarkdown(text)}</span>
    </div>
  `;
}

/**
 * Checks whether a line can be folded into a paragraph.
 */
function shouldContinueParagraph(line: string): boolean {
  return Boolean(line.trim())
    && !line.match(/^```/)
    && !line.match(/^(#{1,4})\s+/)
    && !line.match(/^>\s?/)
    && !readListItem(line, "unordered")
    && !readListItem(line, "ordered");
}
