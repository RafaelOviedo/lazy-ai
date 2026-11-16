import { escapeHtml, renderWithStableStyle } from "../../../../shared/lib/html/index.js";
import { Keybindings } from "../../../../app/types.js";

import type { McpServerInfo, McpServerState, McpServerTool, ProviderId } from "../../../../entities/provider/index.js";
import type { McpServerListState } from "../../../../features/manage-mcp-servers/index.js";
import type { TermWindow } from "../../types.js";
import type { McpServersModalPayload } from "./types.js";

/** Short labels for each state, shown on the row rather than only as colour. */
const stateLabels: Record<McpServerState, string> = {
  connected: "connected",
  connecting: "starting",
  failed: "failed",
  "needs-auth": "needs auth",
  disabled: "disabled",
  unknown: "unknown",
};

/**
 * Only three glyphs, so the list stays readable on a narrow terminal font: the
 * colour carries the rest of the distinction.
 */
const stateGlyphs: Record<McpServerState, string> = {
  connected: "●",
  connecting: "◐",
  failed: "●",
  "needs-auth": "●",
  disabled: "○",
  unknown: "○",
};

/** Share of the terminal the modal fills. */
const modalHeightRatio = 0.85;
/** Must track the `width` in the stylesheet below, which cannot interpolate. */
const modalWidthRatio = 0.6;
/**
 * Rows the modal spends on itself rather than on the list: its border and
 * padding, then the title, summary and actions hint, each with a margin. The
 * tool view also carries a header line and the blank line under it.
 */
export const listChromeRows = 10;
export const detailChromeRows = 12;
/** Columns a name keeps however long the meta beside it is. */
const minNameColumns = 16;
/**
 * Floor on drawn rows. Deliberately 1 rather than a comfortable minimum:
 * nothing scrolls the cursor back into view any more, so a window taller than
 * the terminal would hide it. A cramped list beats an invisible cursor.
 */
const minRowsPerPage = 1;
/**
 * Ceiling on drawn rows. Every keystroke re-renders the whole modal, so a very
 * tall terminal would otherwise put the lag back that windowing removed.
 */
const maxRowsPerPage = 40;

/**
 * Rows to draw so the list fills the modal without overflowing it.
 *
 * Exported for tests: the row count depends on the terminal size, which a test
 * cannot set without standing up a whole fake transport.
 */
export function resolveRowsPerPage(viewportRows: number, chromeRows: number): number {
  const available = Math.floor(viewportRows * modalHeightRatio) - chromeRows;

  return Math.max(minRowsPerPage, Math.min(available, maxRowsPerPage));
}

const emptyListState: McpServerListState = {
  servers: [], error: null, isLoading: false, isSettling: false, reconnecting: null, notice: null,
};

/** The shell command that signs a provider in to a server it cannot reach. */
function loginCommand(providerId: ProviderId, serverName: string): string {
  return providerId === "claude-code" ? `claude mcp login "${serverName}"` : `codex mcp login ${serverName}`;
}

/**
 * Registers the MCP servers modal custom element against a TermDOM window.
 */
export function ensureMcpServersModalDefined(window: TermWindow): void {
  if (window.customElements.get("mcp-servers-modal")) {
    return;
  }

  /**
   * Lists the active provider's MCP servers and drills into one server's tools.
   */
  class McpServersModal extends window.HTMLElement {
    private closeModalValue: () => void = () => { };
    private payloadValue: McpServersModalPayload | undefined;
    private unsubscribe: (() => void) | null = null;
    private listState: McpServerListState = emptyListState;
    private view: "list" | "detail" = "list";
    private selectedIndex = 0;
    private detailIndex = 0;
    /** First row of the drawn window, for the list and the tool view. */
    private listWindowStart = 0;
    private detailWindowStart = 0;
    private filter = "";
    private isFiltering = false;

    private readonly onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      if (this.isFiltering && this.handleFilterKey(event)) return;

      const key = event.key.toLowerCase();

      if (key === "pagedown" || key === "pageup") {
        event.preventDefault();
        this.moveSelection(key === "pagedown" ? this.rowsPerPage : -this.rowsPerPage, true);
        return;
      }

      if (key === Keybindings.J || key === "arrowdown") {
        event.preventDefault();
        this.moveSelection(1);
        return;
      }

      if (key === Keybindings.K || key === "arrowup") {
        event.preventDefault();
        this.moveSelection(-1);
        return;
      }

      if (this.view === "list" && event.key === "/") {
        event.preventDefault();
        this.isFiltering = true;
        this.render();
        return;
      }

      if (key === "r") {
        event.preventDefault();
        this.reconnectSelected();
        return;
      }

      if (key === "f") {
        event.preventDefault();
        this.payloadValue?.onRefresh();
      }
    };

    /**
     * Edits the filter while it holds the keyboard, so navigation keys can
     * double as text. Returns whether the key was consumed.
     */
    private handleFilterKey(event: KeyboardEvent): boolean {
      if (event.key === Keybindings.ESCAPE) {
        event.preventDefault();
        // Escape leaves the filter and clears it in one step: a stale filter
        // left behind would silently hide servers.
        this.isFiltering = false;
        this.filter = "";
        this.resetListCursor();
        this.render();
        return true;
      }

      if (event.key === Keybindings.ENTER) {
        event.preventDefault();
        this.isFiltering = false;
        this.render();
        return true;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        this.filter = this.filter.slice(0, -1);
        this.resetListCursor();
        this.render();
        return true;
      }

      if (event.key.length !== 1) return false;

      event.preventDefault();
      this.filter += event.key;
      this.resetListCursor();
      this.render();
      return true;
    }

    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.addEventListener("keydown", this.onKeyDown);
      this.render();
    }

    disconnectedCallback(): void {
      this.removeEventListener("keydown", this.onKeyDown);
      this.unsubscribe?.();
      this.unsubscribe = null;
    }

    set payload(value: McpServersModalPayload | undefined) {
      if (this.payloadValue === value) return;

      this.unsubscribe?.();
      this.payloadValue = value;
      this.view = "list";
      this.selectedIndex = 0;
      this.detailIndex = 0;
      this.filter = "";
      this.isFiltering = false;
      this.listState = value?.getState() ?? emptyListState;

      this.unsubscribe = value?.subscribe((state) => {
        this.listState = state;
        this.clampSelection();

        if (this.isConnected) this.render();
      }) ?? null;

      if (this.isConnected) this.render();
    }

    get payload(): McpServersModalPayload | undefined {
      return this.payloadValue;
    }

    set closeModal(value: () => void) {
      this.closeModalValue = value;
    }

    get closeModal(): () => void {
      return this.closeModalValue;
    }

    /** Enter opens the highlighted server's tools. */
    confirmModal(): void {
      if (this.view !== "list") return;
      if (!this.getVisibleServers()[this.selectedIndex]) return;

      this.view = "detail";
      this.detailIndex = 0;
      this.detailWindowStart = 0;
      this.render();
    }

    /**
     * Escape steps back out of the detail view before it closes the modal, so
     * one key walks the whole way out.
     */
    cancelModal(): void {
      if (this.view === "detail") {
        this.view = "list";
        this.render();
        return;
      }

      this.closeModalValue();
    }

    focusInitialElement(): void {
      this.focus();
    }

    /**
     * The servers the list is currently showing. Matching on name alone keeps
     * the filter predictable; matching tool names too would make a row appear
     * for text the user cannot see.
     */
    private getVisibleServers(): McpServerInfo[] {
      const needle = this.filter.trim().toLowerCase();

      if (!needle) return this.listState.servers;

      return this.listState.servers.filter((server) => server.name.toLowerCase().includes(needle));
    }

    private getSelectedServer(): McpServerInfo | undefined {
      return this.getVisibleServers()[this.selectedIndex];
    }

    /**
     * Sends the cursor back to the first row. Filtering rewrites the list, so
     * holding the old position would land the user somewhere arbitrary.
     */
    private resetListCursor(): void {
      this.selectedIndex = 0;
      this.listWindowStart = 0;
      this.detailIndex = 0;
      this.detailWindowStart = 0;
    }

    /** Keeps the cursor on a real row after the list shrinks underneath it. */
    private clampSelection(): void {
      const count = this.getVisibleServers().length;

      this.selectedIndex = count === 0 ? 0 : Math.min(this.selectedIndex, count - 1);

      const toolCount = this.getSelectedServer()?.tools.length ?? 0;

      this.detailIndex = toolCount === 0 ? 0 : Math.min(this.detailIndex, toolCount - 1);
      this.syncWindows();
    }

    /**
     * Moves the cursor, and on a page move carries the window with it so the
     * cursor keeps its screen row. Without that, paging back would park the
     * cursor on the top row and show a different range than paging forward
     * came from.
     */
    private moveSelection(offset: number, byPage = false): void {
      // Reaching for a movement key dismisses the last message, even at the
      // end of a list where the cursor has nowhere left to go.
      if (this.listState.notice) this.payloadValue?.onClearNotice();

      const count = this.view === "detail"
        ? this.getSelectedServer()?.tools.length ?? 0
        : this.getVisibleServers().length;

      if (count === 0) return;

      const current = this.view === "detail" ? this.detailIndex : this.selectedIndex;
      const next = Math.min(Math.max(current + offset, 0), count - 1);

      if (next === current) return;

      if (this.view === "detail") this.detailIndex = next;
      else this.selectedIndex = next;

      if (byPage) {
        if (this.view === "detail") this.detailWindowStart = Math.max(0, this.detailWindowStart + offset);
        else this.listWindowStart = Math.max(0, this.listWindowStart + offset);
      }

      this.syncWindows();
      this.render();
    }

    /**
     * Reconnects the highlighted server.
     *
     * A server waiting on sign-in is refused by the provider, so rather than
     * relay that failure the viewer names the command that does fix it.
     */
    private reconnectSelected(): void {
      const server = this.getSelectedServer();
      const payload = this.payloadValue;

      if (!server || !payload) return;

      if (server.state === "needs-auth") {
        payload.onNotice(`Sign in first: ${loginCommand(payload.providerId, server.name)}`);
        return;
      }

      payload.onReconnect(server.name);
    }

    /**
     * Columns inside the modal frame, for deciding what has to be truncated.
     * Read per render so a resized terminal re-fits.
     */
    private get contentColumns(): number {
      return Math.max(20, Math.floor(window.innerWidth * modalWidthRatio) - 4);
    }

    /**
     * Fits one row onto one line, which is what lets the row count stand in for
     * height.
     *
     * The name identifies the row, so it is defended first: trailing meta
     * details are dropped until the name fits, and only then is the name itself
     * shortened. `metaParts` must be ordered most important first, since the
     * leading entry is the one that always survives.
     */
    private fitRow(label: string, metaParts: string[], prefixLength: number): { label: string; meta: string } {
      const columns = this.contentColumns;
      const parts = metaParts.filter(Boolean);
      const tooWide = () => prefixLength + label.length + 1 + parts.join(" · ").length > columns;

      while (parts.length > 1 && tooWide()) parts.pop();

      const meta = parts.join(" · ");
      const room = Math.max(minNameColumns, columns - prefixLength - 1 - meta.length);

      return {
        label: label.length <= room ? label : `${label.slice(0, Math.max(1, room - 1))}…`,
        meta,
      };
    }

    /**
     * How many rows this view can draw right now. Read per render rather than
     * cached so the list re-fits itself when the terminal is resized.
     */
    private get rowsPerPage(): number {
      return resolveRowsPerPage(
        window.innerHeight,
        this.view === "detail" ? detailChromeRows : listChromeRows,
      );
    }

    /**
     * Slides the window just far enough to contain the cursor, so moving by one
     * row scrolls by one row instead of jumping a whole page.
     */
    private alignWindow(start: number, index: number, count: number): number {
      const size = this.rowsPerPage;
      const maxStart = Math.max(0, count - size);
      let next = Math.min(start, maxStart);

      if (index < next) next = index;
      else if (index >= next + size) next = index - size + 1;

      return Math.max(0, Math.min(next, maxStart));
    }

    /** Re-aligns both windows against the current cursors and list lengths. */
    private syncWindows(): void {
      this.listWindowStart = this.alignWindow(
        this.listWindowStart,
        this.selectedIndex,
        this.getVisibleServers().length,
      );
      this.detailWindowStart = this.alignWindow(
        this.detailWindowStart,
        this.detailIndex,
        this.getSelectedServer()?.tools.length ?? 0,
      );
    }

    private render(): void {
      renderWithStableStyle(this, `
        <style>
          mcp-servers-modal {
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            width: 60%;
            border: 1px solid #fff;
            background: #000;
            border-radius: 5px;
            box-sizing: border-box;
            padding: 1px;
          }

          .mcp-servers-modal__title {
            color: #d7ecff;
            font-weight: bold;
            text-align: center;
            margin-bottom: 1px;
          }

          .mcp-servers-modal__content {
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            min-height: 0;
            flex-shrink: 1;
          }

          .mcp-servers-modal__row {
            display: flex;
            justify-content: space-between;
            width: 100%;
            color: #8aa4bf;
            white-space: nowrap;
            overflow: hidden;
          }

          .mcp-servers-modal__row.is-selected {
            color: #fff;
            font-weight: bold;
          }

          .mcp-servers-modal__meta {
            color: #444;
          }

          .mcp-servers-modal__empty {
            color: #8aa4bf;
          }

          .mcp-servers-modal__error {
            color: #BA0606;
          }

          .mcp-servers-modal__summary {
            color: #8aa4bf;
            margin-top: 1px;
            flex-shrink: 0;
          }

          .mcp-servers-modal__actions {
            color: #d7ba7d;
            margin-top: 1px;
            flex-shrink: 0;
          }

          .mcp-servers-modal__filter {
            color: #fff;
            font-weight: bold;
          }

          .mcp-servers-modal__detail-head {
            color: #5fafff;
            flex-shrink: 0;
          }

          .mcp-servers-modal__tool-name {
            color: #d7ecff;
          }

          .is-connected {
            color: #5faf87;
          }

          .is-connecting {
            color: #d7ba7d;
          }

          .is-failed {
            color: #BA0606;
          }

          .is-needs-auth {
            color: #d78700;
          }

          .is-disabled {
            color: #444;
          }

          .is-unknown {
            color: #8aa4bf;
          }
        </style>

        <legend class="mcp-servers-modal__title">${escapeHtml(this.renderTitle())}</legend>
        <div class="mcp-servers-modal__content">${this.renderBody()}</div>
        <div class="mcp-servers-modal__summary">${this.renderSummary()}</div>
        <div class="mcp-servers-modal__actions">${escapeHtml(this.renderActions())}</div>
      `);
    }

    private renderTitle(): string {
      if (this.view === "detail") return this.getSelectedServer()?.name ?? "MCP server";

      return `MCP servers — ${this.payloadValue?.providerLabel ?? ""}`;
    }

    private renderBody(): string {
      if (this.listState.error) {
        return `<div class="mcp-servers-modal__error">${escapeHtml(this.listState.error)}</div>`;
      }

      if (this.view === "detail") return this.renderDetailMarkup();

      if (this.listState.isLoading && this.listState.servers.length === 0) {
        return `<div class="mcp-servers-modal__empty">Reading MCP servers…</div>`;
      }

      const servers = this.getVisibleServers();

      if (servers.length === 0) {
        return `<div class="mcp-servers-modal__empty">${escapeHtml(
          this.listState.servers.length === 0
            ? "No MCP servers are configured for this provider."
            : `No server matches "${this.filter}".`,
        )}</div>`;
      }

      return servers
        .slice(this.listWindowStart, this.listWindowStart + this.rowsPerPage)
        .map((server, offset) => this.renderServerMarkup(server, this.listWindowStart + offset))
        .join("");
    }

    private renderServerMarkup(server: McpServerInfo, index: number): string {
      const isSelected = index === this.selectedIndex;
      const rowClass = isSelected ? "mcp-servers-modal__row is-selected" : "mcp-servers-modal__row";
      const cursor = isSelected ? "›" : " ";
      const glyph = `<span class="is-${server.state}">${stateGlyphs[server.state]}</span>`;
      // Cursor, space, glyph, space.
      const { label, meta } = this.fitRow(server.name, this.renderServerMetaParts(server), 4);

      return `
        <div class="${rowClass}" data-selected="${isSelected}">
          <span>${cursor} ${glyph} ${escapeHtml(label)}</span>
          <span class="mcp-servers-modal__meta">${escapeHtml(meta)}</span>
        </div>
      `;
    }

    /**
     * The secondary details, most important first. A narrow terminal drops
     * them from the end, so the state is the one that always survives.
     */
    private renderServerMetaParts(server: McpServerInfo): string[] {
      const toolCount = server.tools.length;

      return [
        stateLabels[server.state],
        toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : "",
        server.scope ?? "",
        server.transport ?? "",
      ].filter(Boolean);
    }

    private renderDetailMarkup(): string {
      const server = this.getSelectedServer();

      if (!server) return `<div class="mcp-servers-modal__empty">That server is no longer listed.</div>`;

      const head = [
        stateLabels[server.state],
        server.scope,
        server.transport,
        server.origin,
        server.version ? `v${server.version}` : "",
      ].filter(Boolean).join(" · ");

      const error = server.error
        ? `<div class="mcp-servers-modal__error">${escapeHtml(server.error)}</div>`
        : "";

      const tools = server.tools.length === 0
        ? `<div class="mcp-servers-modal__empty">${escapeHtml(this.renderNoToolsReason(server))}</div>`
        : server.tools
          .slice(this.detailWindowStart, this.detailWindowStart + this.rowsPerPage)
          .map((tool, offset) => this.renderToolMarkup(tool, this.detailWindowStart + offset))
          .join("");

      return `
        <div class="mcp-servers-modal__detail-head">${escapeHtml(head)}</div>
        ${error}
        <br>
        ${tools}
      `;
    }

    private renderToolMarkup(tool: McpServerTool, index: number): string {
      const isSelected = index === this.detailIndex;
      const rowClass = isSelected ? "mcp-servers-modal__row is-selected" : "mcp-servers-modal__row";
      const cursor = isSelected ? "›" : " ";
      // Claude Code reports annotations but no descriptions, and Codex the
      // other way round, so the row shows whichever the server gave.
      const dangerLabel = tool.destructive ? "destructive" : tool.readOnly ? "read-only" : "";
      const danger = tool.destructive
        ? `<span class="is-failed">destructive</span> `
        : tool.readOnly ? `<span class="mcp-servers-modal__meta">read-only</span> ` : "";
      const summary = this.renderToolSummary(tool.description);
      const { label, meta } = this.fitRow(tool.name, [dangerLabel, summary], 2);
      // The danger word keeps its colour, so it is re-attached rather than
      // printed as part of the plain meta text.
      const rest = dangerLabel && meta.startsWith(dangerLabel) ? meta.slice(dangerLabel.length + 3) : meta;
      const metaMarkup = dangerLabel && meta.startsWith(dangerLabel)
        ? `${danger}${escapeHtml(rest)}`
        : escapeHtml(meta);

      return `
        <div class="${rowClass}" data-selected="${isSelected}">
          <span class="mcp-servers-modal__tool-name">${cursor} ${escapeHtml(label)}</span>
          <span class="mcp-servers-modal__meta">${metaMarkup}</span>
        </div>
      `;
    }

    /**
     * An empty tool list means different things per state, and saying which
     * saves the user from chasing a server that was never going to answer.
     */
    private renderNoToolsReason(server: McpServerInfo): string {
      if (server.state === "needs-auth") {
        const providerId = this.payloadValue?.providerId;

        // Reconnecting will not help here, so name the command that does.
        return providerId
          ? `Sign in to see its tools: ${loginCommand(providerId, server.name)}`
          : "Sign in to this server to see its tools.";
      }
      if (server.state === "connecting") return "Still starting…";
      if (server.state === "disabled") return "This server is disabled.";
      if (server.state === "failed") return "This server failed to start, so it reported no tools.";

      return "This server reported no tools.";
    }

    /** Tool descriptions are prose; only the first line fits beside the name. */
    private renderToolSummary(description: string | undefined): string {
      if (!description) return "";

      const firstLine = description.split("\n")[0]?.trim() ?? "";

      return firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;
    }

    /**
     * Names the drawn window, since only part of the list is on screen. Omitted
     * when everything fits, where it would only be noise.
     */
    private renderRangeMarkup(start: number, count: number): string {
      const size = this.rowsPerPage;

      if (count <= size) return "";

      const last = Math.min(start + size, count);

      return `<span class="mcp-servers-modal__meta"> · showing ${start + 1}–${last}</span>`;
    }

    private renderSummary(): string {
      if (this.view === "detail") {
        const count = this.getSelectedServer()?.tools.length ?? 0;

        return escapeHtml(`${count} tool${count === 1 ? "" : "s"}`)
          + this.renderRangeMarkup(this.detailWindowStart, count);
      }

      if (this.isFiltering || this.filter) {
        const shown = this.getVisibleServers().length;
        const caret = this.isFiltering ? "█" : "";

        return `<span class="mcp-servers-modal__filter">Filter: ${escapeHtml(this.filter)}${caret}</span>`
          + `<span class="mcp-servers-modal__meta"> — ${shown} of ${this.listState.servers.length}</span>`
          + this.renderRangeMarkup(this.listWindowStart, shown);
      }

      const servers = this.listState.servers;

      if (servers.length === 0) return "";

      const byState = servers.reduce<Partial<Record<McpServerState, number>>>((tally, server) => {
        tally[server.state] = (tally[server.state] ?? 0) + 1;
        return tally;
      }, {});

      const parts = (Object.keys(stateLabels) as McpServerState[])
        .filter((state) => byState[state])
        .map((state) => `<span class="is-${state}">${byState[state]} ${escapeHtml(stateLabels[state])}</span>`);

      const settling = this.listState.isSettling ? " · still starting…" : "";

      return `${parts.join(" · ")}<span class="mcp-servers-modal__meta"> · ${servers.length} total${escapeHtml(settling)}</span>`
        + this.renderRangeMarkup(this.listWindowStart, servers.length);
    }

    private renderActions(): string {
      // A reconnect takes seconds, and its outcome is the whole point of the
      // viewer, so both take the hint row rather than being left unsaid.
      if (this.listState.reconnecting) return `Reconnecting ${this.listState.reconnecting}…`;
      if (this.listState.notice) return this.listState.notice;
      if (this.isFiltering) return "type to filter · Enter keep · Esc clear";
      if (this.view === "detail") {
        const paged = (this.getSelectedServer()?.tools.length ?? 0) > this.rowsPerPage ? " · PgUp/PgDn page" : "";

        return `j/k ↑/↓ scroll${paged} · r reconnect · Esc back`;
      }

      const paged = this.getVisibleServers().length > this.rowsPerPage ? " · PgUp/PgDn page" : "";

      return `j/k ↑/↓ move${paged} · Enter tools · r reconnect · / filter · f refresh · Esc close`;
    }
  }

  window.customElements.define("mcp-servers-modal", McpServersModal);
}
