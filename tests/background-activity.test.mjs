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

test("Claude forwards its own idle and running states", async () => {
  const client = claudeBackgroundHarness([
    { type: "system", subtype: "session_state_changed", state: "running" },
    { type: "system", subtype: "session_state_changed", state: "requires_action" },
  ]);

  const states = [];
  client.setSessionStateHandler((event) => states.push(event.state));

  const { threadId } = await client.startThread();
  const { turnId } = await client.startTurn(threadId, "hi");
  await client.waitForTurnCompletion(threadId, turnId);

  // The result has arrived, yet the session never said it went idle.
  assert.deepEqual(states, ["running", "requiresAction"]);

  client.dispose();
});

test("run activity lists every strand of work at once", () => {
  const state = ({ kinds = [], ...overrides }) => ({
    busy: false,
    status: "thinking",
    providerState: null,
    ...overrides,
    backgroundTasks: kinds.map((kind, index) => ({ description: "", id: String(index), kind })),
  });

  assert.deepEqual(describeRunActivity(null), []);
  assert.deepEqual(describeRunActivity(state({})), []);
  assert.deepEqual(describeRunActivity(state({ busy: true })), ["Thinking..."]);
  assert.deepEqual(describeRunActivity(state({ busy: true, status: "starting" })), ["Starting..."]);

  // A settled turn still reads as busy while its work carries on.
  assert.deepEqual(describeRunActivity(state({ kinds: ["subAgent"] })), ["Sub-agents are working..."]);
  assert.deepEqual(describeRunActivity(state({ kinds: ["terminal"] })), ["Terminal tasks in process..."]);
  assert.deepEqual(describeRunActivity(state({ kinds: ["other"] })), ["Background tasks are working..."]);

  // The model and its background work run at the same time, so both are named.
  assert.deepEqual(describeRunActivity(state({ busy: true, kinds: ["terminal", "subAgent"] })), [
    "Thinking...",
    "Sub-agents are working...",
    "Terminal tasks in process...",
  ]);
});

test("run activity trusts a provider that is still running past the turn's result", () => {
  const settled = { busy: false, status: "completed", backgroundTasks: [] };

  // The case the spinner used to vanish on: Claude Code held the result back,
  // or its background-agent loop has not exited, so the session is not idle.
  assert.deepEqual(describeRunActivity({ ...settled, providerState: "running" }), ["Thinking..."]);
  assert.deepEqual(describeRunActivity({ ...settled, providerState: "requiresAction" }), ["Thinking..."]);
  assert.deepEqual(describeRunActivity({ ...settled, providerState: "idle" }), []);
  // A provider that reports nothing leaves the turn's own result in charge.
  assert.deepEqual(describeRunActivity({ ...settled, providerState: null }), []);
});
