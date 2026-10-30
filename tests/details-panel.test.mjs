import assert from "node:assert/strict";
import { test } from "node:test";
import { TermDOM } from "@b9g/termdom";
import { ensureDetailsPanelDefined } from "../src/components/DetailsPanel/details-panel.ts";

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRowIds(panel) {
  return [...panel.querySelectorAll("[data-conversation-message='true']")].map((row) =>
    row.getAttribute("data-message-id"),
  );
}

function createPanel(t, messages) {
  const term = new TermDOM();
  t.after(() => term.dispose());
  const { window, document } = term;
  ensureDetailsPanelDefined(window);
  const panel = document.createElement("details-panel");
  document.body.append(panel);
  // Detaching stops the spinner and stream timers, so a failed assertion ends
  // the run instead of holding the event loop open.
  t.after(() => panel.remove());
  panel.repository = {
    listByProject: async () => [],
    getLatestUsageLimit: async () => null,
    getConversation: async () => ({ sessionId: "s1", messages: messages.slice() }),
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

  return { panel, term };
}

test("a prompt and the reply streaming back keep their order while the transcript catches up", async (t) => {
  const transcript = [
    { id: "m1", role: "user", text: "first question", timestamp: new Date(Date.now() - 60000).toISOString() },
    { id: "m2", role: "assistant", text: "first answer", timestamp: new Date(Date.now() - 59000).toISOString() },
  ];
  const { panel } = createPanel(t, transcript);
  await wait();

  assert.deepEqual(readRowIds(panel), ["m1", "m2"]);

  // The prompt is shown optimistically, before any provider output.
  const pendingUserPrompt = { sessionId: "s1", submittedAt: new Date().toISOString(), text: "second question" };

  panel.thinkingSessionId = "s1";
  panel.pendingUserPrompt = pendingUserPrompt;

  const pendingRowId = readRowIds(panel).at(-1);

  assert.deepEqual(readRowIds(panel), ["m1", "m2", pendingRowId]);
  assert.match(pendingRowId, /^pending-prompt:s1:/);

  // The reply streams in under it, never above it.
  panel.applyLiveEvent({ sessionId: "s1", type: "stream", text: "second ans" });
  await wait(250);

  assert.deepEqual(readRowIds(panel), ["m1", "m2", pendingRowId, "live-stream:s1"]);

  // The transcript records the prompt mid-turn: its row replaces the optimistic
  // one in place, rather than being appended under the reply.
  transcript.push({ id: "m3", role: "user", text: "second question", timestamp: new Date().toISOString() });
  await panel.syncConversation("s1");

  assert.deepEqual(readRowIds(panel), ["m1", "m2", "m3", "live-stream:s1"]);

  // The page keeps reporting the prompt until the turn ends; its row stays retired.
  panel.pendingUserPrompt = { ...pendingUserPrompt };

  assert.deepEqual(readRowIds(panel), ["m1", "m2", "m3", "live-stream:s1"]);

  // The finished reply lands last once the turn settles.
  transcript.push({ id: "m4", role: "assistant", text: "second answer", timestamp: new Date().toISOString() });
  await panel.syncConversation("s1");
  panel.settleLiveEvents("s1");
  panel.thinkingSessionId = null;

  assert.deepEqual(readRowIds(panel), ["m1", "m2", "m3", "m4"]);
  assert.match(panel.textContent, /second answer/);
});

test("a reply taller than the panel settles at the end instead of jumping between its ends", async (t) => {
  const transcript = [{ id: "m1", role: "user", text: "question", timestamp: new Date().toISOString() }];
  const { panel } = createPanel(t, transcript);

  // A panel shorter than the reply is what makes the scroll box move at all.
  panel.style.height = "12px";
  await wait();

  const content = panel.querySelector(".details-panel__content");
  const positions = [];
  let answer = "";

  // Every update must leave the view at the end of the reply. Revealing the
  // row instead pulled the view to the first line of a reply taller than the
  // panel, then to its last line, flickering between them as text arrived.
  for (let update = 0; update < 4; update += 1) {
    answer += `${Array.from({ length: 20 }, (_, line) => `answer line ${update}.${line}`).join("\n\n")}\n\n`;
    panel.applyLiveEvent({ sessionId: "s1", type: "stream", text: answer });
    await wait(250);
    positions.push({ top: content.scrollTop, end: content.scrollHeight - content.clientHeight });
  }

  assert.ok(positions.at(-1).end > 0, "a reply taller than the panel should scroll");

  for (const [update, position] of positions.entries()) {
    assert.equal(position.top, position.end, `update ${update} left the view away from the end`);
  }
});
