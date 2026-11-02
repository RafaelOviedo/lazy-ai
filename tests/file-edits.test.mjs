import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TermDOM } from "@b9g/termdom";
import { ClaudeSessionRepository } from "../src/providers/claude/claude-session-repository.ts";
import { CodexSessionRepository } from "../src/providers/codex/codex-session-repository.ts";
import { extractApplyPatch, parseApplyPatch } from "../src/providers/codex/codex-patch.ts";
import { ensureDetailsPanelDefined } from "../src/components/DetailsPanel/details-panel.ts";

const sessionId = "11111111-2222-3333-4444-555555555555";

async function createTempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "lazyai-edits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("Claude edits and new files become edit rows on the assistant side", async (t) => {
  const root = await createTempRoot(t);
  const projectDirectory = join(root, "projects", "-tmp-project");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(join(projectDirectory, `${sessionId}.jsonl`), jsonl([
    { type: "user", uuid: "u1", cwd: "/tmp/project", message: { role: "user", content: "rename it" } },
    {
      type: "user",
      uuid: "edit-1",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1" }] },
      toolUseResult: {
        filePath: "/tmp/project/a.php",
        structuredPatch: [{ oldStart: 37, oldLines: 1, newStart: 37, newLines: 1, lines: ["-travelTo()", "+readAsOf()"] }],
      },
    },
    {
      type: "user",
      uuid: "create-1",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2" }] },
      toolUseResult: { type: "create", filePath: "/tmp/project/b.txt", content: "one\ntwo\n", structuredPatch: [] },
    },
    // A declined edit comes back as an error string and changed nothing.
    { type: "user", uuid: "denied-1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t3" }] }, toolUseResult: "Error: denied" },
  ]));

  const repository = new ClaudeSessionRepository({ claudeRootPath: root });
  const { messages } = await repository.getConversation(sessionId);

  assert.deepEqual(messages.map((message) => message.id), ["u1", "edit-1", "create-1"]);
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].text, "Updated /tmp/project/a.php (+1 -1)");
  assert.deepEqual(messages[1].fileEdits[0].hunks[0], { oldStart: 37, newStart: 37, lines: ["-travelTo()", "+readAsOf()"] });
  assert.deepEqual(messages[2].fileEdits[0], {
    path: "/tmp/project/b.txt",
    kind: "create",
    hunks: [{ oldStart: 0, newStart: 1, lines: ["+one", "+two"] }],
  });
});

test("apply_patch text is read into per-file edits", () => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: src/a.ts",
    "@@ function a",
    " keep",
    "-old",
    "+new",
    "@@",
    "-gone",
    "*** Add File: src/b.ts",
    "+hello",
    "*** Delete File: src/c.ts",
    "*** Update File: src/d.ts",
    "*** Move to: src/e.ts",
    "@@",
    "-x",
    "+y",
    "*** End Patch",
  ].join("\n");

  assert.deepEqual(parseApplyPatch(patch), [
    { path: "src/a.ts", kind: "update", hunks: [{ lines: [" keep", "-old", "+new"] }, { lines: ["-gone"] }] },
    { path: "src/b.ts", kind: "create", hunks: [{ lines: ["+hello"] }] },
    { path: "src/c.ts", kind: "delete", hunks: [] },
    { path: "src/d.ts → src/e.ts", kind: "update", hunks: [{ lines: ["-x", "+y"] }] },
  ]);
  // Quoted inside a shell command or script, the newlines are still escaped.
  assert.equal(extractApplyPatch(JSON.stringify({ command: ["apply_patch", patch] })), patch);
});

test("a Codex patch shows once its output proves it applied", async (t) => {
  const root = await createTempRoot(t);
  const sessionsDirectory = join(root, "sessions", "2026", "11", "02");
  await mkdir(sessionsDirectory, { recursive: true });
  const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch\n";
  const failedPatch = "*** Begin Patch\n*** Update File: src/b.ts\n@@\n-x\n+y\n*** End Patch\n";
  await writeFile(join(sessionsDirectory, `rollout-2026-11-02T00-00-00-${sessionId}.jsonl`), jsonl([
    { type: "session_meta", payload: { id: sessionId, cwd: "/tmp/project" } },
    { type: "response_item", timestamp: "2026-11-02T00:00:01Z", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "call-ok", input: patch } },
    { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "call-ok", output: "Success. Updated the following files:\nM src/a.ts\n" } },
    { type: "response_item", payload: { type: "function_call", name: "apply_patch", call_id: "call-bad", arguments: JSON.stringify({ input: failedPatch }) } },
    { type: "response_item", payload: { type: "function_call_output", call_id: "call-bad", output: "apply_patch verification failed: Failed to find expected lines" } },
  ]));

  const repository = new CodexSessionRepository({ codexRootPath: root });
  const { messages } = await repository.getConversation(sessionId);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, "call-ok");
  assert.equal(messages[0].text, "Updated src/a.ts (+1 -1)");
  assert.equal(messages[0].timestamp, "2026-11-02T00:00:01Z");
});

test("the details panel shows only the latest 100 rows and says how many it left out", async (t) => {
  const term = new TermDOM();
  t.after(() => term.dispose());
  const { window, document } = term;
  ensureDetailsPanelDefined(window);
  const panel = document.createElement("details-panel");
  document.body.append(panel);
  t.after(() => panel.remove());

  const messages = Array.from({ length: 150 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? "assistant" : "user", text: `message ${index}` }));
  panel.repository = {
    listByProject: async () => [],
    getLatestUsageLimit: async () => null,
    getConversation: async () => ({ sessionId: "s1", messages: messages.slice() }),
  };
  panel.viewedSession = { id: "s1", title: "Session", updatedAt: "", relativeUpdated: "", projectPath: "/tmp/project", projectName: "project", model: "", status: "Saved" };
  await wait();

  const readIds = () => [...panel.querySelectorAll("[data-conversation-message='true']")].map((row) => row.getAttribute("data-message-id"));
  const readNote = () => panel.querySelector("[data-earlier-messages='true']").textContent;

  assert.equal(readIds().length, 100);
  assert.equal(readIds()[0], "m50");
  assert.equal(readNote(), "… 50 earlier messages not shown");

  // A new message pushes the oldest shown one out.
  messages.push({ id: "m150", role: "assistant", text: "message 150" });
  await panel.syncConversation("s1");

  assert.equal(readIds().length, 100);
  assert.deepEqual([readIds()[0], readIds().at(-1)], ["m51", "m150"]);
  assert.equal(readNote(), "… 51 earlier messages not shown");
});

test("the details panel draws an edit as a diff and cuts long ones short", async (t) => {
  const term = new TermDOM();
  t.after(() => term.dispose());
  const { window, document } = term;
  ensureDetailsPanelDefined(window);
  const panel = document.createElement("details-panel");
  document.body.append(panel);
  t.after(() => panel.remove());

  const manyLines = Array.from({ length: 50 }, (_, index) => `+line ${index}`);
  const messages = [
    {
      id: "e1",
      role: "assistant",
      text: "Updated /tmp/project/src/a.ts (+1 -1)",
      fileEdits: [{ path: "/tmp/project/src/a.ts", kind: "update", hunks: [{ oldStart: 9, newStart: 9, lines: [" same", "-old", "+new"] }] }],
    },
    {
      id: "e2",
      role: "assistant",
      text: "Created /tmp/project/big.txt (+50 -0)",
      fileEdits: [{ path: "/tmp/project/big.txt", kind: "create", hunks: [{ oldStart: 0, newStart: 1, lines: manyLines }] }],
    },
  ];

  panel.repository = {
    listByProject: async () => [],
    getLatestUsageLimit: async () => null,
    getConversation: async () => ({ sessionId: "s1", messages }),
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
  await wait();

  const [first, second] = panel.querySelectorAll("[data-conversation-message='true']");
  const firstLines = [...first.querySelectorAll(".details-diff__line")];

  assert.match(first.querySelector(".details-diff__file").textContent, /Updated src\/a\.ts \+1 -1/);
  assert.deepEqual(firstLines.map((line) => line.textContent), [" 9   same", "10 - old", "10 + new"]);
  assert.deepEqual(firstLines.map((line) => line.className), [
    "details-diff__line",
    "details-diff__line details-diff__line--removed",
    "details-diff__line details-diff__line--added",
  ]);
  assert.equal(second.querySelectorAll(".details-diff__line").length, 40);
  assert.match(second.textContent, /… 10 more lines/);
});
