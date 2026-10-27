import assert from "node:assert/strict";
import { test } from "node:test";
import { TermDOM } from "@b9g/termdom";
import { ensureModesModalDefined } from "../src/components/Modal/modules/ModesModal/modes-modal.ts";
import { ensureAgentQuestionsModalDefined } from "../src/components/Modal/modules/AgentQuestionsModal/agent-questions-modal.ts";
import { ensureStatusPanelDefined } from "../src/components/StatusPanel/status-panel.ts";

function press(window, element, key) {
  element.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

test("Modes modal navigates, refuses unavailable/busy choices, and saves only on confirmation", async (t) => {
  const term = new TermDOM();
  t.after(() => term.dispose());
  const { window, document } = term;
  ensureModesModalDefined(window);
  const modal = document.createElement("modes-modal");
  document.body.append(modal);
  const chosen = [];
  let closed = 0;
  modal.closeModal = () => { closed++; };
  const payload = { mode: "manual", providerId: "codex", unavailable: { auto: "Unavailable model" }, onSelect: async (mode) => { chosen.push(mode); } };
  modal.payload = payload;
  press(window, modal, "j");
  assert.equal(chosen.length, 0);
  modal.cancelModal();
  assert.equal(chosen.length, 0);
  assert.equal(closed, 1);
  press(window, modal, "ArrowDown");
  modal.confirmModal();
  assert.equal(chosen.length, 0);
  assert.match(modal.textContent, /Unavailable model/);
  press(window, modal, "k");
  modal.confirmModal();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(chosen, ["acceptEdits"]);
  assert.equal(closed, 2);
  modal.payload = { ...payload, blockedReason: "A response is running" };
  modal.confirmModal();
  assert.equal(chosen.length, 1);
  assert.match(modal.textContent, /A response is running/);
});

test("Modes modal keeps failures visible and does not close on failed persistence", async (t) => {
  const term = new TermDOM();
  t.after(() => term.dispose());
  ensureModesModalDefined(term.window);
  const modal = term.document.createElement("modes-modal");
  term.document.body.append(modal);
  let closed = false;
  modal.closeModal = () => { closed = true; };
  modal.payload = { mode: "manual", providerId: "claude-code", unavailable: {}, onSelect: async () => { throw new Error("Disk is full"); } };
  modal.confirmModal();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  assert.match(modal.textContent, /Disk is full/);
});

test("question modal collects choices, multiple selections, and custom text without leaking drafts", async (t) => {
  const term = new TermDOM();
  t.after(() => term.dispose());
  const { window, document } = term;
  ensureAgentQuestionsModalDefined(window);
  const modal = document.createElement("agent-questions-modal");
  document.body.append(modal);
  let decision;
  modal.payload = { request: { questions: [
    { id: "db", header: "Database", question: "Which database?", options: [{ label: "Postgres", description: "Server" }, { label: "SQLite", description: "Local" }], allowOther: true },
    { id: "features", header: "Features", question: "Which features?", options: [{ label: "Search", description: "Find" }, { label: "Export", description: "Save" }], multiSelect: true, allowOther: true },
    { id: "name", header: "Name", question: "Project name?", options: [], allowOther: true },
    { id: "notes", header: "Notes", question: "Any notes?", options: [], allowOther: true },
  ] }, queuedCount: 0, onDecide: (value) => { decision = value; } };
  press(window, modal, "j");
  modal.confirmModal();
  assert.equal(decision, undefined);
  press(window, modal, " ");
  press(window, modal, "j");
  press(window, modal, " ");
  modal.confirmModal();
  modal.querySelector("input").value = "My app";
  modal.confirmModal();
  assert.equal(modal.querySelector("input").value, "");
  modal.confirmModal();
  assert.equal(decision, undefined);
  modal.querySelector("input").value = "Use existing styles";
  press(window, modal.querySelector("input"), "Enter");
  assert.deepEqual(decision, { behavior: "allow", scope: "once", answers: { db: ["SQLite"], features: ["Search", "Export"], name: ["My app"], notes: ["Use existing styles"] } });
});

test("status displays mode before a model is resolved and shows unavailable selections", async (t) => {
  const term = new TermDOM();
  t.after(() => term.dispose());
  ensureStatusPanelDefined(term.window);
  const panel = term.document.createElement("status-panel");
  term.document.body.append(panel);
  panel.activeProviderLabel = "Codex";
  panel.activeModeLabel = "Plan";
  assert.match(panel.textContent, /mode: Plan/);
  panel.activeModelLabel = "test-model";
  panel.activeModeLabel = "Auto (unavailable)";
  assert.match(panel.textContent, /thinking: default · mode: Auto \(unavailable\)/);
});
