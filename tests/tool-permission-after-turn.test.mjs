import assert from "node:assert/strict";
import { test } from "node:test";

import { ClaudeSdkClient } from "../src/providers/claude/claude-sdk-client.ts";
import { createSessionRunController } from "../src/features/run-session/run-session.ts";
import { createToolApprovalController } from "../src/features/approve-tool-use/approve-tool-use.ts";

function deferred() {
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  return { promise, settle };
}

/**
 * Drives one turn whose session keeps running after handing back its result,
 * then asks to use a tool the way a sub-agent or background shell would.
 *
 * Mirrors how `home.ts` wires the client, the run controller and the approval
 * queue together, since the bug lives in how those three agree a session is
 * over rather than in any one of them.
 */
function backgroundToolCallHarness() {
  const askToolPermission = deferred();
  const toolPermissionAnswer = deferred();
  const shownRequests = [];

  const client = new ClaudeSdkClient({}, ({ prompt, options }) => {
    const stream = (async function* () {
      for await (const _prompt of prompt) {
        yield { type: "system", subtype: "session_state_changed", state: "running" };
        yield { type: "result", subtype: "success", is_error: false };

        // The turn is over for the host; the session is not.
        await askToolPermission.promise;
        toolPermissionAnswer.settle(
          await options.canUseTool(
            "Bash",
            { command: "docker ps --format '{{.Names}}'" },
            { signal: new AbortController().signal },
          ),
        );
      }
    })();

    stream.setPermissionMode = async () => {};
    stream.interrupt = async () => {};
    return stream;
  });

  const approvalController = createToolApprovalController({
    closeModal: () => {},
    isModalActive: () => false,
    openPermissionModal: (request, _queuedCount, onDecide) => {
      shownRequests.push(request);
      onDecide({ behavior: "allow" });
    },
  });

  const runController = createSessionRunController({
    client,
    providerLabel: "Claude Code",
    onChange: () => {},
    onTurnFinished: (sessionId, threadId) => {
      approvalController.cancelSessionRequests(threadId);
      if (sessionId !== threadId) approvalController.cancelSessionRequests(sessionId);
    },
    refreshUsageLimit: () => {},
    reportActionError: () => {},
    syncConversation: async () => {},
    syncSession: async () => null,
  });

  client.setToolPermissionHandler((request) =>
    runController.requestToolPermission(request, approvalController.requestToolPermission),
  );
  client.setSessionStateHandler((event) => runController.setProviderState(event.sessionId, event.state));

  return { approvalController, askToolPermission, client, runController, shownRequests, toolPermissionAnswer };
}

test("a tool call from work outliving its turn is still put to the user", async () => {
  const harness = backgroundToolCallHarness();
  const { threadId, sessionId } = await harness.client.startThread("/tmp/project");
  const session = {
    id: sessionId,
    title: "Session",
    updatedAt: new Date().toISOString(),
    relativeUpdated: "just now",
    projectPath: "/tmp/project",
    projectName: "project",
    model: "",
    status: "Saved",
  };

  await harness.runController.promptSession(session, threadId, "look around");

  const state = harness.runController.getState(sessionId);

  // The premise: the turn is settled while the provider reports itself running.
  assert.equal(state.busy, false);
  assert.equal(state.providerState, "running");

  harness.askToolPermission.settle();

  const decision = await harness.toolPermissionAnswer.promise;

  assert.deepEqual(
    harness.shownRequests.map((request) => request.toolName),
    ["Bash"],
    "the call never reached the approval modal",
  );
  assert.equal(decision.behavior, "allow");

  harness.approvalController.dispose();
  harness.runController.dispose();
  harness.client.dispose();
});

test("a tool call from a session the provider reports as idle is still declined", async () => {
  const harness = backgroundToolCallHarness();
  const { threadId, sessionId } = await harness.client.startThread("/tmp/project");
  const session = {
    id: sessionId,
    title: "Session",
    updatedAt: new Date().toISOString(),
    relativeUpdated: "just now",
    projectPath: "/tmp/project",
    projectName: "project",
    model: "",
    status: "Saved",
  };

  await harness.runController.promptSession(session, threadId, "look around");
  harness.runController.setProviderState(threadId, "idle");
  harness.askToolPermission.settle();

  const decision = await harness.toolPermissionAnswer.promise;

  assert.deepEqual(harness.shownRequests, []);
  assert.equal(decision.behavior, "deny");

  harness.approvalController.dispose();
  harness.runController.dispose();
  harness.client.dispose();
});
