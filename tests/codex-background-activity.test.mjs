import assert from "node:assert/strict";
import { test } from "node:test";

import { CodexAppServerClient } from "../src/providers/codex/codex-app-server-client.ts";

const threadId = "thread-1";

/**
 * A client wired for notifications only: no process is spawned, and
 * `thread/backgroundTerminals/list` answers from `terminals`.
 */
function codexActivityHarness({ terminals = [], listFails = false } = {}) {
  const client = new CodexAppServerClient();
  const events = [];

  client.setBackgroundActivityHandler((event) => events.push(event));
  // Stands in for a live app-server: only its presence is checked before a read.
  client.process = { kill: () => {}, killed: false };
  client.request = async (method) => {
    assert.equal(method, "thread/backgroundTerminals/list");
    if (listFails) throw new Error("app-server went away");
    return { data: terminals };
  };

  return { client, events };
}

function subAgentActivity(agentThreadId, kind) {
  return {
    method: "item/started",
    params: { threadId, item: { type: "subAgentActivity", agentThreadId, kind } },
  };
}

test("Codex tracks sub-agents through their activity items", () => {
  const { client, events } = codexActivityHarness();

  client.handleNotification(subAgentActivity("agent-1", "started"));
  assert.deepEqual(events.at(-1), {
    sessionId: threadId,
    tasks: [{ description: "Sub-agent", id: "agent-1", kind: "subAgent" }],
  });

  client.handleNotification(subAgentActivity("agent-2", "started"));
  assert.equal(events.at(-1).tasks.length, 2);

  client.handleNotification(subAgentActivity("agent-1", "completed"));
  assert.deepEqual(events.at(-1).tasks.map((task) => task.id), ["agent-2"]);

  client.handleNotification(subAgentActivity("agent-2", "interrupted"));
  assert.deepEqual(events.at(-1).tasks, []);
});

test("Codex clears a sub-agent when its own thread reports idle", () => {
  const { client, events } = codexActivityHarness();

  client.handleNotification(subAgentActivity("agent-1", "started"));
  assert.equal(events.at(-1).tasks.length, 1);

  // The closing item never arrives; the agent's own thread going idle is proof
  // enough, so a missed edge cannot wedge the indicator on forever.
  client.handleNotification({
    method: "thread/status/changed",
    params: { threadId: "agent-1", status: { type: "idle" } },
  });

  assert.equal(events.at(-1).sessionId, threadId);
  assert.deepEqual(events.at(-1).tasks, []);
});

test("Codex reads absolute sub-agent states from a collab tool call", () => {
  const { client, events } = codexActivityHarness();

  client.handleNotification({
    method: "item/completed",
    params: {
      threadId,
      item: {
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        agentsStates: {
          "agent-1": { status: "running" },
          "agent-2": { status: "pendingInit" },
          "agent-3": { status: "completed" },
        },
      },
    },
  });

  assert.deepEqual(events.at(-1).tasks.map((task) => task.id), ["agent-1", "agent-2"]);
});

test("Codex reports background terminals it only learns by asking", async () => {
  const { client, events } = codexActivityHarness({
    terminals: [{ itemId: "item-1", processId: "pid-1", command: "npm run dev" }],
  });

  await client.readBackgroundTerminals(threadId);

  assert.deepEqual(events.at(-1), {
    sessionId: threadId,
    tasks: [{ description: "npm run dev", id: "pid-1", kind: "terminal" }],
  });

  const reportCount = events.length;

  // An unchanged set is not worth re-reporting on every poll.
  await client.readBackgroundTerminals(threadId);
  assert.equal(events.length, reportCount);

  client.request = async () => ({ data: [] });
  await client.readBackgroundTerminals(threadId);
  assert.deepEqual(events.at(-1).tasks, []);
});

test("Codex treats a failed terminals read as nothing running", async () => {
  const { client, events } = codexActivityHarness({
    terminals: [{ processId: "pid-1", command: "npm run dev" }],
  });

  await client.readBackgroundTerminals(threadId);
  assert.equal(events.at(-1).tasks.length, 1);

  client.request = async () => {
    throw new Error("app-server went away");
  };
  await client.readBackgroundTerminals(threadId);

  assert.deepEqual(events.at(-1).tasks, []);
});

test("Codex re-reads terminals after a command execution and after a turn ends", async () => {
  const { client, events } = codexActivityHarness({
    terminals: [{ processId: "pid-1", command: "sleep 300" }],
  });

  client.handleNotification({
    method: "item/completed",
    params: { threadId, item: { type: "commandExecution", id: "item-1", status: "completed" } },
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));

  // The turn is over, yet the shell it started is still alive and now reported.
  assert.deepEqual(events.at(-1), {
    sessionId: threadId,
    tasks: [{ description: "sleep 300", id: "pid-1", kind: "terminal" }],
  });

  client.dispose();
});

test("Codex drops tracked work when the app-server exits", () => {
  const { client, events } = codexActivityHarness();

  client.handleNotification(subAgentActivity("agent-1", "started"));
  assert.equal(events.at(-1).tasks.length, 1);

  client.handleProcessExit(1, null);

  assert.deepEqual(events.at(-1).tasks, []);
});
