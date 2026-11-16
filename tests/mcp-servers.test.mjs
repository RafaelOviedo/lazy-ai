import assert from "node:assert/strict";
import { test } from "node:test";
import { TermDOM } from "@b9g/termdom";

import { mapClaudeMcpServers } from "../src/providers/claude/claude-mcp-status.ts";
import { mapCodexMcpServers } from "../src/providers/codex/codex-mcp-status.ts";
import { createMcpServerController } from "../src/features/manage-mcp-servers/manage-mcp-servers.ts";
import {
  detailChromeRows,
  ensureMcpServersModalDefined,
  listChromeRows,
  resolveRowsPerPage,
} from "../src/components/Modal/modules/McpServersModal/mcp-servers-modal.ts";

function press(window, element, key) {
  element.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function mountModal(t) {
  const term = new TermDOM();
  t.after(() => term.dispose());
  const { window, document } = term;
  ensureMcpServersModalDefined(window);
  const modal = document.createElement("mcp-servers-modal");
  document.body.append(modal);
  // The page size follows the terminal, so the expectations have to as well.
  const listRows = resolveRowsPerPage(window.innerHeight, listChromeRows);
  const detailRows = resolveRowsPerPage(window.innerHeight, detailChromeRows);
  return { detailRows, document, listRows, modal, window };
}

/** Reads the drawn rows as [label, meta] pairs. */
function rowPairs(modal) {
  return [...modal.querySelectorAll(".mcp-servers-modal__row")]
    .map((row) => [...row.children].map((cell) => cell.textContent.trim()));
}

function listState(servers, overrides = {}) {
  return {
    servers, error: null, isLoading: false, isSettling: false, reconnecting: null, notice: null, ...overrides,
  };
}

function staticPayload(servers, overrides = {}) {
  const state = listState(servers, overrides);
  return {
    providerId: "claude-code",
    providerLabel: "Claude Code",
    getState: () => state,
    subscribe: () => () => { },
    onRefresh: () => { },
    onReconnect: () => { },
    onClearNotice: () => { },
    onNotice: () => { },
  };
}

function server(name, extra = {}) {
  return { name, state: "connected", tools: [], ...extra };
}

test("Claude MCP status maps states, transports and origins", () => {
  const mapped = mapClaudeMcpServers([
    {
      name: "playwright",
      status: "connected",
      scope: "local",
      config: { command: "npx", args: ["@playwright/mcp"] },
      serverInfo: { name: "playwright", version: "1.66.0" },
      tools: [
        { name: "browser_click", description: "Click it", annotations: { destructive: true, openWorld: true } },
        { name: "browser_snapshot", annotations: { readOnly: true } },
      ],
    },
    { name: "booting", status: "pending", scope: "user", config: { type: "http", url: "https://mcp.example.com/x?k=secret" } },
    { name: "broken", status: "failed", error: "spawn failed", config: { type: "sse", url: "not a url" } },
    { name: "locked", status: "needs-auth", scope: "claudeai" },
    { name: "off", status: "disabled" },
    { name: "future", status: "something-new" },
  ]);

  // A stdio config may omit `type`, so a bare command still reads as stdio.
  assert.equal(mapped[0].transport, "stdio");
  assert.equal(mapped[0].state, "connected");
  assert.equal(mapped[0].version, "1.66.0");
  assert.deepEqual(mapped[0].tools[0], {
    name: "browser_click",
    description: "Click it",
    destructive: true,
    readOnly: undefined,
  });
  assert.equal(mapped[0].tools[1].readOnly, true);

  // `pending` is transient, so it must not read as a failure.
  assert.equal(mapped[1].state, "connecting");
  // The host identifies a remote server; the query string must not survive.
  assert.equal(mapped[1].origin, "mcp.example.com");

  assert.equal(mapped[2].state, "failed");
  assert.equal(mapped[2].error, "spawn failed");
  assert.equal(mapped[2].origin, "not a url");

  assert.equal(mapped[3].state, "needs-auth");
  assert.equal(mapped[4].state, "disabled");
  // An unrecognised status must degrade rather than throw or claim success.
  assert.equal(mapped[5].state, "unknown");
  assert.deepEqual(mapped[5].tools, []);
});

test("Codex MCP status infers a state when no thread scopes the read", () => {
  const mapped = mapCodexMcpServers([
    {
      name: "codex_apps",
      authStatus: "bearerToken",
      runtimeStatus: null,
      httpOrigin: "https://chatgpt.com",
      serverInfo: { name: "plugin-runtime", version: "0.1.0" },
      tools: {
        "sites.save": { description: "Save a site", annotations: { destructiveHint: true } },
        "sites.read": { annotations: { readOnlyHint: true } },
      },
    },
    { name: "needs-login", authStatus: "notLoggedIn", runtimeStatus: null, tools: {} },
    { name: "silent", authStatus: "unknown", runtimeStatus: null, tools: {} },
    { name: "angry", authStatus: "unknown", runtimeStatus: null, tools: {}, toolsError: "no catalog" },
    { name: "live", authStatus: "oAuth", runtimeStatus: "connected", tools: {} },
    { name: "waiting", authStatus: "oAuth", runtimeStatus: "starting", tools: {} },
    { name: "blocked", authStatus: "oAuth", runtimeStatus: "authenticationRequired", tools: {} },
    { name: "plugin-owned", authStatus: "unknown", runtimeStatus: "connected", pluginId: "abc", tools: {} },
  ]);

  // A returned tool catalog is proof the server answered.
  assert.equal(mapped[0].state, "connected");
  assert.equal(mapped[0].transport, "http");
  assert.equal(mapped[0].origin, "chatgpt.com");
  // Codex forwards raw MCP annotations, which use the spec's `*Hint` names.
  assert.deepEqual(mapped[0].tools[0], {
    name: "sites.save",
    description: "Save a site",
    destructive: true,
    readOnly: undefined,
  });
  assert.equal(mapped[0].tools[1].readOnly, true);

  assert.equal(mapped[1].state, "needs-auth");
  assert.equal(mapped[2].state, "unknown");
  assert.equal(mapped[3].state, "failed");
  assert.equal(mapped[4].state, "connected");
  assert.equal(mapped[5].state, "connecting");
  assert.equal(mapped[6].state, "needs-auth");

  assert.equal(mapped[7].scope, "plugin:abc");
  assert.equal(mapped[1].transport, "stdio");
});

test("the controller re-reads while servers start and stops once they settle", async () => {
  const reads = [];
  const pages = [
    [server("a", { state: "connecting" })],
    [server("a", { state: "connecting" })],
    [server("a", { state: "connected", tools: [{ name: "t" }] })],
  ];
  const controller = createMcpServerController({
    providerLabel: "Claude Code",
    cwd: "C:/projects/lazy-ai",
    getActiveThreadId: () => "thread-1",
    client: {
      listMcpServers: async (options) => {
        reads.push(options);
        return pages[Math.min(reads.length - 1, pages.length - 1)];
      },
      releaseMcpResources: () => { reads.push("released"); },
    },
  });

  const seen = [];
  controller.subscribe((state) => seen.push(state));
  controller.open();

  assert.equal(seen[0].isLoading, true);
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // The live session is named on every read, so the state describes it.
  assert.equal(reads[0].threadId, "thread-1");
  assert.equal(reads[0].cwd, "C:/projects/lazy-ai");

  const settled = controller.getState();
  assert.equal(settled.isSettling, false);
  assert.equal(settled.servers[0].state, "connected");

  // Polling must stop once nothing is starting, rather than run forever.
  const readsAtSettle = reads.length;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(reads.length, readsAtSettle);

  controller.close();
  assert.equal(reads.at(-1), "released");
});

test("the controller reports a provider that cannot answer, and drops late reads after close", async () => {
  const silent = createMcpServerController({ providerLabel: "Codex", client: {} });
  silent.subscribe(() => { });
  silent.open();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(silent.getState().error, /Codex does not report MCP servers/);
  assert.equal(silent.getState().isLoading, false);

  let release = () => { };
  const slow = createMcpServerController({
    providerLabel: "Claude Code",
    client: { listMcpServers: () => new Promise((resolve) => { release = () => resolve([server("late")]); }) },
  });
  slow.open();
  slow.close();
  release();
  await new Promise((resolve) => setImmediate(resolve));

  // A read that lands after the viewer closed must not repopulate it.
  assert.deepEqual(slow.getState().servers, []);
});

test("the modal lists servers, filters by name, and opens tools", (t) => {
  const { modal, window } = mountModal(t);
  modal.closeModal = () => { };
  modal.payload = staticPayload([
    server("playwright", {
      scope: "local",
      transport: "stdio",
      tools: [{ name: "browser_click", destructive: true }],
    }),
    server("azure-devops", { state: "failed", error: "spawn failed" }),
    server("linear", { state: "needs-auth" }),
  ]);

  assert.match(modal.textContent, /playwright/);
  assert.match(modal.textContent, /needs auth/);
  // The tally summarises the whole list, not just what is on screen.
  assert.match(modal.textContent, /3 total/);

  press(window, modal, "/");
  for (const char of "lin") press(window, modal, char);
  assert.match(modal.textContent, /1 of 3/);
  assert.doesNotMatch(modal.textContent, /playwright/);

  // While filtering, j must type rather than move the cursor.
  press(window, modal, "j");
  assert.match(modal.textContent, /Filter: linj/);
  press(window, modal, "Backspace");

  press(window, modal, "Escape");
  // Escape clears the filter instead of leaving rows hidden.
  assert.match(modal.textContent, /playwright/);

  modal.confirmModal();
  assert.match(modal.textContent, /browser_click/);
  assert.match(modal.textContent, /1 tool/);
  // A destructive tool must be called out even when the server sent no
  // description, which is what Claude Code does.
  assert.match(modal.textContent, /destructive/);

  // Escape steps back to the list before it closes the modal.
  let closed = 0;
  modal.closeModal = () => { closed++; };
  modal.cancelModal();
  assert.equal(closed, 0);
  assert.match(modal.textContent, /azure-devops/);
  modal.cancelModal();
  assert.equal(closed, 1);
});

test("the modal explains an empty tool list and survives a list that shrinks under the cursor", (t) => {
  const { modal, window } = mountModal(t);
  modal.closeModal = () => { };

  let state = listState([server("a"), server("b"), server("c", { state: "needs-auth" })]);
  let notify = () => { };
  modal.payload = {
    providerLabel: "Claude Code",
    getState: () => state,
    subscribe: (listener) => { notify = listener; return () => { }; },
    onRefresh: () => { },
  };

  press(window, modal, "j");
  press(window, modal, "j");
  modal.confirmModal();
  // A server awaiting auth has no tools for a reason worth naming.
  assert.match(modal.textContent, /Sign in to this server/);
  modal.cancelModal();

  // The cursor was on the third row; a shorter list must not strand it.
  state = listState([server("a")]);
  notify(state);
  assert.doesNotMatch(modal.textContent, /no longer listed/);
  modal.confirmModal();
  assert.match(modal.textContent, /reported no tools/);
});

test("the modal refreshes on f and reports a read failure", (t) => {
  const { modal, window } = mountModal(t);
  modal.closeModal = () => { };
  let refreshes = 0;
  modal.payload = {
    ...staticPayload([], { error: "Claude Code client disposed." }),
    onRefresh: () => { refreshes++; },
  };

  assert.match(modal.textContent, /Claude Code client disposed/);
  press(window, modal, "f");
  assert.equal(refreshes, 1);
});

test("the modal draws only one page of servers and slides the window with the cursor", (t) => {
  const { listRows, modal, window } = mountModal(t);
  modal.closeModal = () => { };
  const many = Array.from({ length: 76 }, (_, i) => server(`server-${String(i + 1).padStart(2, "0")}`));
  modal.payload = staticPayload(many);

  const rendered = () => many.filter((s) => modal.textContent.includes(s.name)).length;

  // Drawing all 76 rows is what made cursor movement lag.
  assert.ok(listRows > 0 && listRows < 76);
  assert.equal(rendered(), listRows);
  assert.match(modal.textContent, new RegExp(`showing 1–${listRows}`));
  assert.match(modal.textContent, /76 total/);

  // Moving inside the window must not scroll it.
  for (let i = 0; i < listRows - 1; i++) press(window, modal, "j");
  assert.match(modal.textContent, new RegExp(`showing 1–${listRows}`));

  // Stepping past the edge slides by one row, not a whole page.
  press(window, modal, "j");
  assert.match(modal.textContent, new RegExp(`showing 2–${listRows + 1}`));
  assert.equal(rendered(), listRows);

  press(window, modal, "PageDown");
  assert.match(modal.textContent, new RegExp(`showing ${listRows + 2}–${listRows * 2 + 1}`));
  // Paging back must land on the range it paged forward from.
  press(window, modal, "PageUp");
  assert.match(modal.textContent, new RegExp(`showing 2–${listRows + 1}`));

  // The window must stop at the end rather than running off it.
  for (let i = 0; i < 200; i++) press(window, modal, "j");
  assert.match(modal.textContent, new RegExp(`showing ${76 - listRows + 1}–76`));
  assert.match(modal.textContent, /server-76/);
  assert.equal(rendered(), listRows);
});

test("filtering searches every server, not just the drawn page", (t) => {
  const { modal, window } = mountModal(t);
  modal.closeModal = () => { };
  const many = Array.from({ length: 76 }, (_, i) => server(`server-${String(i + 1).padStart(2, "0")}`));
  modal.payload = staticPayload(many);

  press(window, modal, "/");
  for (const char of "server-73") press(window, modal, char);

  // server-73 is far outside the first page, so a filter that only searched
  // the drawn rows would find nothing.
  assert.match(modal.textContent, /1 of 76/);
  assert.match(modal.textContent, /server-73/);
  // One result fits on a page, so the range indicator is pure noise here.
  assert.doesNotMatch(modal.textContent, /showing /);

  press(window, modal, "Enter");
  // Filtering rewrites the list, so the cursor belongs at the top of it.
  modal.confirmModal();
  assert.match(modal.textContent, /server-73/);
});

test("a long tool list is windowed too", (t) => {
  const { detailRows, modal, window } = mountModal(t);
  modal.closeModal = () => { };
  const tools = Array.from({ length: 78 }, (_, i) => ({ name: `tool_${String(i + 1).padStart(2, "0")}` }));
  modal.payload = staticPayload([server("linear", { tools })]);

  modal.confirmModal();
  assert.match(modal.textContent, /78 tools/);
  assert.match(modal.textContent, new RegExp(`showing 1–${detailRows}`));

  for (let i = 0; i < detailRows; i++) press(window, modal, "j");
  assert.match(modal.textContent, new RegExp(`showing 2–${detailRows + 1}`));

  // Leaving and re-entering a server starts its tools from the top again.
  modal.cancelModal();
  modal.confirmModal();
  assert.match(modal.textContent, new RegExp(`showing 1–${detailRows}`));
});

test("the page size follows the terminal, with a floor and a ceiling", () => {
  // A taller terminal shows more rows rather than leaving the modal short.
  assert.ok(resolveRowsPerPage(50, listChromeRows) > resolveRowsPerPage(25, listChromeRows));

  // The tool view carries more chrome, so it fits fewer rows than the list.
  assert.ok(resolveRowsPerPage(40, detailChromeRows) < resolveRowsPerPage(40, listChromeRows));

  // A terminal too short for the chrome still draws a row rather than none.
  assert.equal(resolveRowsPerPage(4, listChromeRows), 1);
  assert.equal(resolveRowsPerPage(1, detailChromeRows), 1);

  // Every keystroke redraws the modal, so a huge terminal is capped.
  assert.equal(resolveRowsPerPage(1000, listChromeRows), 40);

  // The rows plus the chrome must never exceed the terminal, or the cursor
  // could be pushed off the visible area.
  for (let height = 1; height <= 120; height++) {
    for (const chrome of [listChromeRows, detailChromeRows]) {
      const rows = resolveRowsPerPage(height, chrome);

      // Below this the modal's own frame already exceeds the terminal and no
      // row count can fit; everywhere else the rows must leave room for it.
      if (height <= chrome) assert.equal(rows, 1);
      else assert.ok(rows + chrome <= height, `rows overflow a ${height}-row terminal`);
    }
  }
});

test("a row keeps its name and its state, dropping lesser detail to fit one line", (t) => {
  const { modal } = mountModal(t);
  modal.closeModal = () => { };
  const longName = "claude.ai Codex-DBX-Sourcing-Procurement-Transformation-Analytics";
  modal.payload = staticPayload([
    server("playwright", { scope: "local", transport: "stdio", tools: [{ name: "a" }] }),
    server(longName, { state: "needs-auth", scope: "claudeai", transport: "claudeai-proxy" }),
  ]);

  const rows = rowPairs(modal);
  const columns = modal.querySelector(".mcp-servers-modal__row").clientWidth;

  for (const [label, meta] of rows) {
    // One line per row is what lets the row count stand in for height.
    assert.ok(label.length + meta.length + 1 <= columns, `row too wide: ${label} | ${meta}`);
    // The state must survive however little room is left.
    assert.notEqual(meta, "");
  }

  // A name that fits is never shortened to make room for lesser detail.
  assert.equal(rows[0][0], "› ● playwright");
  assert.match(rows[0][1], /^connected/);

  // A name that cannot fit is shortened, and says so.
  assert.notEqual(rows[1][0], `● ${longName}`);
  assert.match(rows[1][0], /…$/);
  assert.ok(longName.startsWith(rows[1][0].replace("● ", "").replace("…", "")));
  assert.equal(rows[1][1], "needs auth");
});

test("a reconnect reports what the server actually did, not that the request was taken", async () => {
  // The provider accepts the request while the server is still coming up, so
  // the first read after it still says "connecting".
  const reads = [
    [server("flaky", { state: "failed", error: "spawn failed" })],
    [server("flaky", { state: "connecting" })],
    [server("flaky", { state: "connected", tools: [{ name: "t" }] })],
  ];
  let readCount = 0;
  const asked = [];
  const controller = createMcpServerController({
    providerLabel: "Claude Code",
    client: {
      listMcpServers: async () => reads[Math.min(readCount++, reads.length - 1)],
      reconnectMcpServer: async (name) => { asked.push(name); return { scope: "server" }; },
    },
  });

  controller.open();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(controller.getState().servers[0].state, "failed");

  await controller.reconnect("flaky");
  assert.deepEqual(asked, ["flaky"]);
  // Progress must stay up while the reads settle, or the viewer would flicker
  // back to its hints and look finished before it is.
  assert.equal(controller.getState().reconnecting, "flaky");
  assert.equal(controller.getState().notice, null);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  assert.equal(controller.getState().reconnecting, null);
  assert.equal(controller.getState().notice, "flaky reconnected.");

  controller.clearNotice();
  assert.equal(controller.getState().notice, null);
  controller.close();
});

test("a reconnect that leaves the server broken says so, and a refused one surfaces the reason", async () => {
  const stillBroken = createMcpServerController({
    providerLabel: "Claude Code",
    client: {
      listMcpServers: async () => [server("flaky", { state: "failed", error: "spawn failed" })],
      reconnectMcpServer: async () => ({ scope: "server" }),
    },
  });
  stillBroken.open();
  await stillBroken.reconnect("flaky");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(stillBroken.getState().notice, "flaky failed to reconnect: spawn failed");
  stillBroken.close();

  const refused = createMcpServerController({
    providerLabel: "Claude Code",
    client: {
      listMcpServers: async () => [server("locked", { state: "needs-auth" })],
      reconnectMcpServer: async () => { throw new Error("Server status: needs-auth"); },
    },
  });
  refused.open();
  await refused.reconnect("locked");
  assert.equal(refused.getState().reconnecting, null);
  assert.match(refused.getState().notice, /Could not reconnect locked: Server status: needs-auth/);
  refused.close();

  // Codex can only reload every server, and the message must not pretend
  // otherwise.
  const sweeping = createMcpServerController({
    providerLabel: "Codex",
    client: {
      listMcpServers: async () => [server("codex_apps")],
      reconnectMcpServer: async () => ({ scope: "all" }),
    },
  });
  sweeping.open();
  await sweeping.reconnect("codex_apps");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(sweeping.getState().notice, /codex_apps reconnected\. Every server was reloaded\./);
  sweeping.close();

  const cannot = createMcpServerController({
    providerLabel: "Codex",
    client: { listMcpServers: async () => [server("a")] },
  });
  cannot.open();
  await cannot.reconnect("a");
  assert.match(cannot.getState().notice, /Codex cannot reconnect MCP servers/);
  cannot.close();
});

test("the modal reconnects the highlighted server, but offers sign-in where reconnect cannot help", (t) => {
  const { modal, window } = mountModal(t);
  modal.closeModal = () => { };
  const asked = [];
  const notices = [];
  let cleared = 0;
  modal.payload = {
    ...staticPayload([
      server("broken", { state: "failed", error: "spawn failed" }),
      server("claude.ai Linear", { state: "needs-auth" }),
    ]),
    onReconnect: (name) => asked.push(name),
    onNotice: (message) => notices.push(message),
    onClearNotice: () => { cleared++; },
  };

  press(window, modal, "r");
  assert.deepEqual(asked, ["broken"]);
  assert.equal(notices.length, 0);

  press(window, modal, "j");
  press(window, modal, "r");
  // Reconnect is refused for a server awaiting sign-in, so nothing is tried
  // and the command that does fix it is named instead.
  assert.deepEqual(asked, ["broken"]);
  assert.deepEqual(notices, ['Sign in first: claude mcp login "claude.ai Linear"']);

  // A message is dismissed by moving on from it.
  modal.payload = {
    ...staticPayload([server("broken", { state: "failed" })], { notice: "broken reconnected." }),
    onClearNotice: () => { cleared++; },
  };
  assert.match(modal.textContent, /broken reconnected\./);
  press(window, modal, "j");
  assert.equal(cleared, 1);
});

test("the modal shows reconnect progress in place of its hints", (t) => {
  const { modal } = mountModal(t);
  modal.closeModal = () => { };
  modal.payload = staticPayload([server("slow")], { reconnecting: "slow" });

  const actions = () => modal.querySelector(".mcp-servers-modal__actions").textContent.trim();
  assert.equal(actions(), "Reconnecting slow…");

  modal.payload = staticPayload([server("slow")], { notice: "slow reconnected." });
  assert.equal(actions(), "slow reconnected.");

  modal.payload = staticPayload([server("slow")]);
  assert.match(actions(), /r reconnect/);
});
