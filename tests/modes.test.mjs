import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModePreference } from "../src/features/select-mode/mode-preference.ts";
import { CodexAppServerClient } from "../src/providers/codex/codex-app-server-client.ts";
import { ClaudeSdkClient } from "../src/providers/claude/claude-sdk-client.ts";
import { createToolApprovalController } from "../src/features/approve-tool-use/approve-tool-use.ts";

test("mode preference defaults to Manual, persists, and preserves unrelated settings", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lazy-ai-modes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "settings.json");
  const preference = createModePreference(path);
  await preference.load();
  assert.equal(preference.get(), "manual");
  await writeFile(path, JSON.stringify({ mode: "plan", theme: "dark" }));
  await preference.load();
  assert.equal(preference.get(), "plan");
  await preference.save("auto");
  const restarted = createModePreference(path);
  await restarted.load();
  assert.equal(restarted.get(), "auto");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { mode: "auto", theme: "dark" });
  await writeFile(path, '{"mode":"bypassPermissions"}');
  const invalid = createModePreference(path);
  await assert.rejects(invalid.load(), /Unknown saved mode/);
  assert.equal(invalid.get(), "manual");
  const unwritable = createModePreference(join(path, "settings.json"));
  await assert.rejects(unwritable.save("auto"));
  assert.equal(unwritable.get(), "manual");
});

function codexHarness() {
  const client = new CodexAppServerClient();
  const calls = [];
  const responses = [];
  client.initialize = async () => {};
  client.send = (response) => responses.push(response);
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start" || method === "thread/resume") return {
      thread: { id: "thread-1" }, model: "test-model", reasoningEffort: "medium",
      approvalPolicy: params.approvalPolicy, approvalsReviewer: params.approvalsReviewer,
      sandbox: { type: params.sandbox === "read-only" ? "readOnly" : "workspaceWrite" },
    };
    if (method === "turn/start") return { turn: { id: `turn-${calls.length}` } };
    if (method === "config/read") return { config: { approvals_reviewer: "user" } };
    if (method === "collaborationMode/list") return { data: [{ mode: "default" }, { mode: "plan" }] };
    if (method === "configRequirements/read") return { requirements: null };
    throw new Error(`Unexpected ${method}`);
  };
  const complete = () => client.handleNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { status: "completed" } } });
  return { client, calls, responses, complete };
}

test("Codex applies all modes to new/resumed work and resets Plan on the next turn", async () => {
  const { client, calls, complete } = codexHarness();
  const expected = [
    ["manual", "untrusted", "user", "readOnly", "default"],
    ["acceptEdits", "untrusted", "user", "workspaceWrite", "default"],
    ["auto", "on-request", "auto_review", "workspaceWrite", "default"],
    ["plan", "never", "user", "readOnly", "plan"],
    ["manual", "untrusted", "user", "readOnly", "default"],
  ];
  for (const [mode, approvalPolicy, approvalsReviewer, sandboxType, collaboration] of expected) {
    await client.setMode(mode);
    if (!calls.length) await client.startThread("/workspace");
    await client.startTurn("thread-1", "Do the work", "/workspace");
    const turn = calls.at(-1).params;
    assert.equal(turn.approvalPolicy, approvalPolicy);
    assert.equal(turn.approvalsReviewer, approvalsReviewer);
    assert.equal(turn.sandboxPolicy.type, sandboxType);
    assert.equal(turn.sandboxPolicy.networkAccess, false);
    assert.equal(turn.collaborationMode.mode, collaboration);
    assert.equal(turn.collaborationMode.settings.model, "test-model");
    assert.equal(turn.collaborationMode.settings.reasoning_effort, "medium");
    assert.equal(turn.collaborationMode.settings.developer_instructions, null);
    if (sandboxType === "workspaceWrite") assert.deepEqual(turn.sandboxPolicy.writableRoots, ["/workspace"]);
    await assert.rejects(client.setMode(mode === "plan" ? "manual" : "plan"), /Wait for all responses/);
    complete();
  }
  assert.equal(calls.filter((call) => call.method === "thread/resume").length, 4);
  client.dispose();
});

test("Codex refuses silently downgraded policy before sending a prompt", async () => {
  const { client, calls } = codexHarness();
  await client.setMode("auto");
  const request = client.request;
  client.request = async (method, params) => {
    const result = await request(method, params);
    if (method === "thread/resume") result.approvalsReviewer = "user";
    return result;
  };
  await assert.rejects(client.startTurn("thread-1", "change files", "/workspace"), /did not accept auto/);
  assert.ok(!calls.some((call) => call.method === "turn/start"));
  client.dispose();
});

test("Codex availability detects missing APIs and organization restrictions", async () => {
  const { client } = codexHarness();
  assert.deepEqual(await client.getModeAvailability(), {});
  client.request = async (method) => {
    if (method === "config/read") return { config: {} };
    if (method === "collaborationMode/list") throw new Error("Unsupported");
    return { requirements: { allowedSandboxModes: ["read-only"], allowedApprovalPolicies: ["never"] } };
  };
  const unavailable = await client.getModeAvailability();
  assert.match(unavailable.auto, /organization policy|Update Codex/);
  assert.match(unavailable.plan, /does not expose Plan/);
  assert.match(unavailable.manual, /organization policy/);
  assert.match(unavailable.acceptEdits, /organization policy/);
  client.dispose();
});

test("Codex Plan refuses write and command escalations even if a handler would approve", async () => {
  const { client, responses } = codexHarness();
  await client.setMode("plan");
  await client.startThread("/workspace");
  let asked = 0;
  client.setToolPermissionHandler(async () => { asked++; return { behavior: "allow", scope: "session" }; });
  await client.resolveCommandApproval(1, { threadId: "thread-1", command: "touch file" });
  await client.resolveFileChangeApproval(2, { threadId: "thread-1" });
  assert.equal(asked, 0);
  assert.deepEqual(responses.map((response) => response.result), [{ decision: "decline" }, { decision: "decline" }]);
  client.dispose();
});

test("Codex questions return answers with original IDs and cancel when resolved elsewhere", async () => {
  const { client, responses } = codexHarness();
  client.setToolPermissionHandler(async (request) => {
    assert.equal(request.questions[0].id, "database");
    return { behavior: "allow", scope: "once", answers: { database: ["SQLite"] } };
  });
  const params = { threadId: "thread-1", questions: [{ id: "database", header: "Database", question: "Which?", options: [{ label: "SQLite", description: "Local" }], isOther: true }] };
  await client.resolveUserInput(3, params);
  assert.deepEqual(responses[0], { id: 3, result: { answers: { database: { answers: ["SQLite"] } } } });
  let signal;
  client.setToolPermissionHandler((request) => new Promise((resolve) => {
    signal = request.signal;
    signal.addEventListener("abort", () => resolve({ behavior: "deny" }));
  }));
  const pending = client.resolveUserInput(4, params);
  client.handleNotification({ method: "serverRequest/resolved", params: { requestId: 4 } });
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(responses.length, 1);
  client.dispose();
});

function claudeHarness({ rejectAuto = false } = {}) {
  const queries = [];
  const client = new ClaudeSdkClient({}, ({ prompt, options }) => {
    const record = { options, modes: [], prompts: [] };
    const stream = (async function* () {
      for await (const message of prompt) {
        record.prompts.push(message);
        yield { type: "result", subtype: "success", is_error: false };
      }
    })();
    stream.setPermissionMode = async (mode) => {
      if (rejectAuto && mode === "auto") throw new Error("Auto unavailable for this model");
      record.modes.push(mode);
    };
    stream.interrupt = async () => {};
    queries.push(record);
    return stream;
  });
  return { client, queries };
}

test("Claude uses native modes and resumes the same conversation after mode changes", async () => {
  const { client, queries } = claudeHarness();
  const { threadId } = await client.startThread("/workspace");
  for (const mode of ["manual", "acceptEdits", "auto", "plan", "manual"]) {
    await client.setMode(mode);
    const { turnId } = await client.startTurn(threadId, "work");
    await client.waitForTurnCompletion(threadId, turnId);
    const expected = mode === "manual" ? "default" : mode;
    assert.equal(queries.at(-1).options.permissionMode, expected);
    assert.deepEqual(queries.at(-1).modes, [expected]);
  }
  assert.equal(queries[0].options.sessionId, threadId);
  for (const query of queries.slice(1)) assert.equal(query.options.resume, threadId);
  client.dispose();
});

test("Claude rejects unavailable Auto without submitting the prompt", async () => {
  const { client, queries } = claudeHarness({ rejectAuto: true });
  await client.setMode("auto");
  const { threadId } = await client.startThread("/workspace");
  await assert.rejects(client.startTurn(threadId, "must not run"), /could not activate auto/);
  assert.equal(queries[0].prompts.length, 0);
  assert.match((await client.getModeAvailability()).auto, /unavailable/);
  client.dispose();
});

test("Claude Plan blocks stale tool grants and ExitPlanMode; questions preserve native answer format", async () => {
  const { client, queries } = claudeHarness();
  await client.setMode("plan");
  const { threadId } = await client.startThread("/workspace");
  const { turnId } = await client.startTurn(threadId, "plan");
  await client.waitForTurnCompletion(threadId, turnId);
  const session = client.sessions.get(threadId);
  session.allowedToolsForSession.add("Write");
  const options = { signal: new AbortController().signal };
  assert.equal((await client.resolveToolPermission(session, "Write", {}, options)).behavior, "deny");
  assert.equal((await client.resolveToolPermission(session, "ExitPlanMode", {}, options)).behavior, "deny");
  const hook = queries[0].options.hooks.PreToolUse[0].hooks[0];
  assert.equal((await hook({ hook_event_name: "PreToolUse", tool_name: "ExitPlanMode" })).hookSpecificOutput.permissionDecision, "deny");
  client.setToolPermissionHandler(async (request) => ({ behavior: "allow", scope: "once", answers: { [request.questions[0].id]: ["SQLite", "Postgres"] } }));
  const result = await client.resolveToolPermission(session, "AskUserQuestion", {
    questions: [{ question: "Which databases?", header: "Storage", multiSelect: true, options: [{ label: "SQLite" }, { label: "Postgres" }] }],
  }, options);
  assert.deepEqual(result.updatedInput.answers, { "Which databases?": "SQLite, Postgres" });
  await client.setMode("manual");
  assert.equal(session.allowedToolsForSession.size, 0);
  client.dispose();
});

test("aborted active and queued questions settle once without stranding the approval queue", async () => {
  const shown = [];
  let modal = false;
  const controller = createToolApprovalController({
    isModalActive: () => modal,
    closeModal: () => { modal = false; },
    openPermissionModal: (request, count, decide) => { modal = true; shown.push({ request, decide }); },
  });
  const first = new AbortController();
  const second = new AbortController();
  const one = controller.requestToolPermission({ sessionId: "a", signal: first.signal });
  const two = controller.requestToolPermission({ sessionId: "b", signal: second.signal });
  second.abort();
  assert.deepEqual(await two, { behavior: "deny" });
  assert.equal(shown.length, 1);
  first.abort();
  assert.deepEqual(await one, { behavior: "deny" });
  assert.equal(controller.hasPendingRequests(), false);
  shown[0].decide({ behavior: "allow", scope: "once" });
  assert.equal(modal, false);
  controller.dispose();
});
