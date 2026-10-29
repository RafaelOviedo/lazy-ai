import assert from "node:assert/strict";
import { test } from "node:test";

import { ClaudeSdkClient } from "../src/providers/claude/claude-sdk-client.ts";
import { describeRunActivity } from "../src/features/run-session/run-session.ts";

/**
 * Drives one Claude turn that emits `extraMessages` before its result.
 */
function claudeBackgroundHarness(extraMessages) {
  const client = new ClaudeSdkClient({}, ({ prompt }) => {
    const stream = (async function* () {
      for await (const _message of prompt) {
        for (const message of extraMessages) yield message;
        yield { type: "result", subtype: "success", is_error: false };
      }
    })();
    stream.setPermissionMode = async () => {};
    stream.interrupt = async () => {};
    return stream;
  });
  return client;
}

function backgroundTasksChanged(tasks) {
  return { type: "system", subtype: "background_tasks_changed", tasks };
}

test("Claude background tasks are reported, classified, and stripped of ambient entries", async () => {
  const client = claudeBackgroundHarness([
    backgroundTasksChanged([
      { task_id: "a", task_type: "local_agent", description: "Review the diff" },
      { task_id: "b", task_type: "local_bash", description: "npm test" },
      { task_id: "c", task_type: "local_workflow", description: "spec" },
      { task_id: "d", task_type: "local_agent", description: "watcher", ambient: true },
    ]),
  ]);

  const events = [];
  client.setBackgroundActivityHandler((event) => events.push(event));

  const { threadId } = await client.startThread();
  const { turnId } = await client.startTurn(threadId, "hi");
  await client.waitForTurnCompletion(threadId, turnId);

  // Nothing is emitted at startup, so the client resets the set itself.
  assert.deepEqual(events[0].tasks, []);

  const reported = events.at(-1);
  assert.equal(reported.sessionId, threadId);
  assert.deepEqual(reported.tasks, [
    { description: "Review the diff", id: "a", kind: "subAgent" },
    { description: "npm test", id: "b", kind: "terminal" },
    // An unmapped task type still counts as activity rather than vanishing.
    { description: "spec", id: "c", kind: "other" },
  ]);

  client.dispose();
});

test("Claude reports an emptied set when the provider drops its last background task", async () => {
  const client = claudeBackgroundHarness([
    backgroundTasksChanged([{ task_id: "a", task_type: "local_bash", description: "npm test" }]),
    backgroundTasksChanged([]),
  ]);

  const events = [];
  client.setBackgroundActivityHandler((event) => events.push(event));

  const { threadId } = await client.startThread();
  const { turnId } = await client.startTurn(threadId, "hi");
  await client.waitForTurnCompletion(threadId, turnId);

  assert.deepEqual(events.at(-1).tasks, []);

  client.dispose();
});

test("run activity names background work ahead of the turn's own state", () => {
  const state = (busy, kinds) => ({
    busy,
    backgroundTasks: kinds.map((kind, index) => ({ description: "", id: String(index), kind })),
  });

  assert.equal(describeRunActivity(null), null);
  assert.equal(describeRunActivity(state(false, [])), null);
  assert.equal(describeRunActivity(state(true, [])), "Thinking...");

  // The point of the feature: a settled turn still reads as busy.
  assert.equal(describeRunActivity(state(false, ["subAgent"])), "Sub-agents are working...");
  assert.equal(describeRunActivity(state(false, ["terminal"])), "Terminal tasks in process...");
  assert.equal(describeRunActivity(state(false, ["other"])), "Background tasks are working...");
  assert.equal(
    describeRunActivity(state(true, ["terminal", "subAgent"])),
    "Sub-agents and terminal tasks are working...",
  );
});
