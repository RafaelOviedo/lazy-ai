import assert from "node:assert/strict";
import { test } from "node:test";

import { ClaudeSdkClient } from "../src/providers/claude/claude-sdk-client.ts";

const pendingTimeoutMs = 150;

/**
 * A Claude Code stand-in whose messages are pushed from the test, so a result
 * can be emitted at a chosen moment rather than one per prompt.
 */
function pushableClaudeHarness() {
  let emit = () => {};
  const sentUuids = [];
  const client = new ClaudeSdkClient({}, ({ prompt }) => {
    const queued = [];
    let deliver = null;

    // Reads the prompts as the client pushes them, so the uuid it stamps on
    // each one is the uuid the test echoes back.
    void (async () => {
      for await (const message of prompt) sentUuids.push(message.uuid);
    })();

    emit = (message) => {
      if (!deliver) return queued.push(message);

      const resolve = deliver;
      deliver = null;
      resolve({ done: false, value: message });
    };

    return {
      [Symbol.asyncIterator]: () => ({
        next: () => (queued.length
          ? Promise.resolve({ done: false, value: queued.shift() })
          : new Promise((resolve) => { deliver = resolve; })),
      }),
      setPermissionMode: async () => {},
      interrupt: async () => {},
      return: async () => ({ done: true, value: undefined }),
    };
  });

  return { client, sentUuids, emit: (message) => emit(message) };
}

function result(userMessageUuids) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    ...(userMessageUuids
      ? { user_message_uuid: userMessageUuids.at(-1), user_message_uuids: userMessageUuids }
      : {}),
  };
}

/** Waits for the client to have pushed `count` prompts into the SDK. */
async function waitForSends(sentUuids, count) {
  for (let attempt = 0; attempt < 100 && sentUuids.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(sentUuids.length, count);
  assert.ok(sentUuids.every((uuid) => typeof uuid === "string" && uuid), "every prompt carries a client uuid");
}

async function settle(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve("pending"), pendingTimeoutMs)),
  ]);
}

test("a turn Claude Code runs for its own background work does not answer a waiting prompt", async () => {
  const { client, emit, sentUuids } = pushableClaudeHarness();
  const { threadId } = await client.startThread();

  const first = await client.startTurn(threadId, "first prompt");
  await waitForSends(sentUuids, 1);
  emit(result([sentUuids[0]]));
  assert.equal((await client.waitForTurnCompletion(threadId, first.turnId)).status, "completed");

  // The user prompts again while sub-agents from the first turn are still at work.
  const second = await client.startTurn(threadId, "second prompt");
  await waitForSends(sentUuids, 2);
  const waiting = client.waitForTurnCompletion(threadId, second.turnId);

  // A sub-agent reporting back drives a turn of Claude Code's own, which
  // answers no prompt at all. It used to be shifted onto the waiting turn,
  // settling it early and taking its prompt off screen before the transcript
  // had recorded it.
  emit(result([]));
  assert.equal(await settle(waiting), "pending");

  emit(result([sentUuids[1]]));
  assert.equal((await waiting).status, "completed");

  client.dispose();
});

test("one result for prompts Claude Code merged into a single turn settles both", async () => {
  const { client, emit, sentUuids } = pushableClaudeHarness();
  const { threadId } = await client.startThread();

  // Sends close together, or one folded into a running turn between tool
  // rounds, are answered by a single result naming every prompt it consumed.
  const first = await client.startTurn(threadId, "first prompt");
  const second = await client.startTurn(threadId, "second prompt");
  await waitForSends(sentUuids, 2);

  const waitingFirst = client.waitForTurnCompletion(threadId, first.turnId);
  const waitingSecond = client.waitForTurnCompletion(threadId, second.turnId);

  emit(result([...sentUuids]));

  assert.equal((await settle(waitingFirst)).status, "completed");
  // Matching oldest-first left this one waiting for a second result that was
  // never coming, so the session stayed busy for the rest of its life.
  assert.equal((await settle(waitingSecond)).status, "completed");

  client.dispose();
});

test("a Claude Code build that echoes no prompt uuid is still answered in order", async () => {
  const { client, emit } = pushableClaudeHarness();
  const { threadId } = await client.startThread();

  const turn = await client.startTurn(threadId, "first prompt");
  const waiting = client.waitForTurnCompletion(threadId, turn.turnId);

  emit(result(null));

  assert.equal((await settle(waiting)).status, "completed");

  client.dispose();
});
