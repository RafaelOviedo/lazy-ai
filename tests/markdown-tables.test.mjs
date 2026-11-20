import assert from "node:assert/strict";
import { test } from "node:test";
import { TermDOM } from "@b9g/termdom";
import { ensureDetailsPanelDefined } from "../src/components/DetailsPanel/details-panel.ts";
import { renderMarkdown } from "../src/shared/lib/markdown/index.ts";

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

// `<th` would also match `<thead>`, so the tag counts keep the trailing space.
function countCells(value, tag) {
  return countOccurrences(value, `<${tag} `);
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mounts the real panel, so the shipped stylesheet is what the cells get. */
function createPanel(t, text) {
  const term = new TermDOM();
  t.after(() => term.dispose());
  const { window, document } = term;

  ensureDetailsPanelDefined(window);

  const panel = document.createElement("details-panel");

  document.body.append(panel);
  t.after(() => panel.remove());
  panel.repository = {
    listByProject: async () => [],
    getLatestUsageLimit: async () => null,
    getConversation: async () => ({
      sessionId: "s1",
      messages: [{ id: "m1", role: "assistant", text, timestamp: new Date().toISOString() }],
    }),
  };
  panel.viewedSession = {
    id: "s1",
    title: "Session",
    updatedAt: new Date().toISOString(),
    relativeUpdated: "just now",
    projectPath: "/tmp/project",
    projectName: "project",
    model: "",
    status: "Saved",
  };

  return { panel, window };
}

test("renders a table as a grid instead of folding its rows into a paragraph", () => {
  const html = renderMarkdown([
    "| # | What | Fixed in |",
    "|---|------|----------|",
    "| 1 | no gate on the route | 96c71ae99 |",
    "| 2 | 500 instead of a redirect | 2be33c42b |",
  ].join("\n"));

  assert.ok(html.includes("<table"), "expected table markup");
  assert.ok(!html.includes("details-markdown__paragraph"), "expected no paragraph fallback");
  assert.ok(!html.includes("|---"), "expected the delimiter row to be consumed, not printed");
  assert.equal(countCells(html, "th"), 3);
  assert.equal(countOccurrences(html, "<tr>"), 3);
  assert.equal(countCells(html, "td"), 6);
});

test("reads column alignment from the delimiter row", () => {
  const html = renderMarkdown([
    "| left | middle | right |",
    "| :--- | :----: | ----: |",
    "| a | b | c |",
  ].join("\n"));

  assert.equal(countOccurrences(html, "details-markdown__table-cell--left"), 2);
  assert.equal(countOccurrences(html, "details-markdown__table-cell--center"), 2);
  assert.equal(countOccurrences(html, "details-markdown__table-cell--right"), 2);
});

test("keeps pipes that belong to inline code inside their cell", () => {
  const html = renderMarkdown([
    "| Command | Why |",
    "|---------|-----|",
    "| `ps aux | grep node` | finds the runtime |",
  ].join("\n"));

  assert.equal(countCells(html, "td"), 2);
  assert.ok(html.includes("ps aux | grep node"), "expected the piped command to survive intact");
});

test("reads an escaped pipe as text", () => {
  const html = renderMarkdown([
    "| Pattern | Matches |",
    "|---------|---------|",
    "| a \\| b | either one |",
  ].join("\n"));

  assert.equal(countCells(html, "td"), 2);
  assert.ok(html.includes("a | b"), "expected the escaped pipe to render as a pipe");
});

test("renders inline markdown inside cells", () => {
  const html = renderMarkdown([
    "| What | Where |",
    "|------|-------|",
    "| **bold finding** | `src/app.ts` |",
  ].join("\n"));

  assert.ok(html.includes("details-markdown__strong"), "expected bold to render");
  assert.ok(html.includes("details-markdown__inline-code"), "expected inline code to render");
});

test("escapes cell text", () => {
  const html = renderMarkdown([
    "| Tag |",
    "|-----|",
    "| <script>alert(1)</script> |",
  ].join("\n"));

  assert.ok(!html.includes("<script>"), "expected the tag to be escaped");
  assert.ok(html.includes("&lt;script&gt;"), "expected escaped markup in the cell");
});

test("squares ragged rows off against the header", () => {
  const html = renderMarkdown([
    "| a | b | c |",
    "|---|---|---|",
    "| 1 |",
    "| 1 | 2 | 3 | 4 |",
  ].join("\n"));

  assert.equal(countCells(html, "th"), 3);
  assert.equal(countCells(html, "td"), 6);
});

test("leaves prose that merely contains pipes alone", () => {
  const html = renderMarkdown("Run a | b and then check the output.");

  assert.ok(!html.includes("<table"), "expected no table");
  assert.ok(html.includes("details-markdown__paragraph"), "expected a paragraph");
});

test("needs a delimiter row before it reads a table", () => {
  const html = renderMarkdown([
    "| # | What |",
    "| 1 | no delimiter row above me |",
  ].join("\n"));

  assert.ok(!html.includes("<table"), "expected no table without a delimiter row");
});

test("keeps the paragraphs around a table separate from it", () => {
  const html = renderMarkdown([
    "Here is where it stands:",
    "| # | What |",
    "|---|------|",
    "| 1 | one real finding |",
    "",
    "Bundles are rebuilt from HEAD.",
  ].join("\n"));

  assert.equal(countOccurrences(html, "details-markdown__paragraph"), 2);
  assert.ok(html.includes("Here is where it stands:"), "expected the lead-in paragraph");
  assert.ok(html.includes("Bundles are rebuilt from HEAD."), "expected the trailing paragraph");
  assert.ok(html.indexOf("Here is where it stands:") < html.indexOf("<table"), "expected the lead-in above the table");
  assert.ok(html.indexOf("<table") < html.indexOf("Bundles are rebuilt"), "expected the table above the trailing text");
});

test("ends the table at a block that owns its line", () => {
  const html = renderMarkdown([
    "| # | What |",
    "|---|------|",
    "| 1 | one real finding |",
    "## Next section | still a heading",
  ].join("\n"));

  assert.equal(countCells(html, "td"), 2);
  assert.ok(html.includes("details-markdown__heading"), "expected the heading to stay a heading");
});

test("draws the table as a bordered grid in the terminal", async () => {
  const term = new TermDOM();

  try {
    const html = renderMarkdown([
      "| # | What | Fixed in |",
      "|---|------|----------|",
      "| 1 | no gate on the route | 96c71ae99 |",
    ].join("\n"));
    const output = term.renderANSI(html).replace(/\u001b\[[0-9;]*m/g, "");
    const lines = output.split("\n").filter((line) => line.trim());

    assert.ok(lines[0].startsWith("┌"), `expected a top border, got ${JSON.stringify(lines[0])}`);
    assert.ok(lines.at(-1).startsWith("└"), `expected a bottom border, got ${JSON.stringify(lines.at(-1))}`);
    assert.ok(lines.some((line) => line.includes("│ What")), "expected the header inside the grid");
    assert.ok(lines.some((line) => line.includes("│ no gate on the route │")), "expected the row inside the grid");
    // A row that fits on one line is one line: the cells share a row box.
    assert.equal(lines.length, 5);
  } finally {
    await term.dispose();
  }
});

test("the panel's own styles reach the cells it renders", async (t) => {
  const { panel, window } = createPanel(t, [
    "| # | Count |",
    "|---|------:|",
    "| 1 | 12 |",
  ].join("\n"));

  await wait();

  const cells = panel.querySelectorAll("td");

  assert.equal(cells.length, 2);

  const rightAligned = panel.querySelector("td.details-markdown__table-cell--right");

  assert.ok(rightAligned, "expected the right-aligned cell to carry its class");
  assert.equal(rightAligned.textContent, "12");

  // The class names in the markup and in the panel's stylesheet have to agree,
  // which only the computed style can say.
  const computed = window.getComputedStyle(rightAligned);

  assert.equal(computed.textAlign, "right");
  assert.equal(computed.borderTopColor, "rgb(138, 164, 191)");
});
