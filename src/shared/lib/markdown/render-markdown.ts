import { escapeHtml } from "../html/index.js";

type ListKind = "ordered" | "unordered";

type TableAlignment = "left" | "center" | "right";

type TableBlock = {
  alignments: TableAlignment[];
  nextIndex: number;
  rows: string[][];
};

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

    const table = readTable(lines, index);

    if (table) {
      blocks.push(renderTable(table));
      index = table.nextIndex;
      continue;
    }

    const paragraphLines: string[] = [];

    // A table can follow a paragraph with no blank line between them, so the
    // paragraph ends where one starts instead of folding its rows into prose.
    while (index < lines.length && shouldContinueParagraph(lines[index]) && !readTable(lines, index)) {
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

/**
 * Reads a GitHub-style table: a header row, the delimiter row that sets the
 * column alignments, then body rows up to the first line that cannot be one.
 * Returns null unless both of the first two lines are there, so everything
 * else falls through to the paragraph reader instead of being half-read.
 */
function readTable(lines: string[], start: number): TableBlock | null {
  const headerLine = lines[start];
  const delimiterLine = lines[start + 1];

  if (headerLine === undefined || delimiterLine === undefined) return null;
  if (!isTableRow(headerLine)) return null;

  const alignments = readTableAlignments(delimiterLine);

  if (!alignments) return null;

  const header = splitTableRow(headerLine);
  const columns = header.length;
  const rows: string[][] = [header];
  let index = start + 2;

  while (index < lines.length && isTableRow(lines[index])) {
    rows.push(fitRow(splitTableRow(lines[index]), columns));
    index += 1;
  }

  return { alignments: fitAlignments(alignments, columns), nextIndex: index, rows };
}

/**
 * Checks whether a line can stand as a table row. Blocks that own their line
 * win over the table, so a list or a heading ends it rather than joining it.
 */
function isTableRow(line: string): boolean {
  const text = line.trim();

  if (!text) return false;
  if (text.match(/^```/)) return false;
  if (text.match(/^(#{1,4})\s+/)) return false;
  if (text.match(/^>\s?/)) return false;
  if (readListItem(text, "unordered") || readListItem(text, "ordered")) return false;

  // A leading pipe is enough on its own, which is what keeps a single-column
  // table readable; without one the row needs a pipe that separates two cells.
  return text.startsWith("|") || splitTableRow(text).length > 1;
}

/**
 * Reads the delimiter row, which is what tells a table apart from prose that
 * happens to carry pipes. Every cell has to be dashes with optional colons.
 */
function readTableAlignments(line: string): TableAlignment[] | null {
  if (!isTableRow(line)) return null;

  const cells = splitTableRow(line);
  const alignments: TableAlignment[] = [];

  for (const cell of cells) {
    if (!cell.match(/^:?-+:?$/)) return null;

    const left = cell.startsWith(":");
    const right = cell.endsWith(":");

    alignments.push(left && right ? "center" : right ? "right" : "left");
  }

  return alignments.length > 0 ? alignments : null;
}

/**
 * Splits one row on the pipes that separate its cells. A pipe that is escaped
 * or inside inline code belongs to the text, which matters here because cells
 * routinely carry commands, paths and code spans.
 */
function splitTableRow(line: string): string[] {
  let text = line.trim();

  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  let inCode = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "\\" && text[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }

    if (character === "`") inCode = !inCode;

    if (character === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(cell.trim());

  return cells;
}

/**
 * Squares a row off against the header, which is what decides the column
 * count. Short rows are padded and long ones are cut, so the grid holds.
 */
function fitRow(cells: string[], columns: number): string[] {
  const row = cells.slice(0, columns);

  while (row.length < columns) row.push("");

  return row;
}

/**
 * Squares the alignments off the same way, for a delimiter row that does not
 * agree with the header about how many columns there are.
 */
function fitAlignments(alignments: TableAlignment[], columns: number): TableAlignment[] {
  const fitted = alignments.slice(0, columns);

  while (fitted.length < columns) fitted.push("left");

  return fitted;
}

/**
 * Renders the table as real table markup and leaves the column widths to the
 * layout engine, which sizes them against the width the panel actually has.
 */
function renderTable(table: TableBlock): string {
  const [header, ...body] = table.rows;
  const headerMarkup = `<thead><tr>${renderTableCells(header, table.alignments, true)}</tr></thead>`;
  const bodyMarkup = body.length > 0
    ? `<tbody>${body.map((row) => `<tr>${renderTableCells(row, table.alignments, false)}</tr>`).join("")}</tbody>`
    : "";

  return `<div class="details-markdown__table"><table class="details-markdown__table-grid">${headerMarkup}${bodyMarkup}</table></div>`;
}

/**
 * Renders one row of cells.
 */
function renderTableCells(cells: string[], alignments: TableAlignment[], isHeader: boolean): string {
  const tag = isHeader ? "th" : "td";
  const role = isHeader ? "head" : "body";

  return cells
    .map((cell, column) => {
      const alignment = alignments[column] ?? "left";
      const classes = `details-markdown__table-cell details-markdown__table-cell--${role} details-markdown__table-cell--${alignment}`;

      return `<${tag} class="${classes}">${renderInlineMarkdown(cell)}</${tag}>`;
    })
    .join("");
}
