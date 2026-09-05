import { CodexSessionRepository } from "../../repositories/sessions/codex/index.js";

import type { CodexSessionReader, CodexSessionSummary } from "../../repositories/sessions/codex/types.js";

import { SessionSelectionChangeDetail, TermWindow } from "./types.js";

/**
 * Registers the Sessions panel custom element against a TermDOM window.
 */
export function ensureSessionsPanelDefined(window: TermWindow): void {
  if (window.customElements.get("sessions-panel")) {
    return;
  }

  /**
   * Renders the Sessions panel and owns its loading and selection state.
   */
  class SessionsPanel extends window.HTMLElement {
    private projectPathValue = "";
    private sessionReader: CodexSessionReader = new CodexSessionRepository();
    private sessions: CodexSessionSummary[] = [];
    private selectedSessionIndex = 0;
    private isLoading = true;
    private hasFocus = false;
    private loadError: string | null = null;

    constructor() {
      super();
      this.onBlur = this.onBlur.bind(this);
      this.onFocus = this.onFocus.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
    }

    /**
     * Initializes the panel markup and loads sessions when the element is attached.
     */
    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.render();
      this.addEventListener("blur", this.onBlur);
      this.addEventListener("focus", this.onFocus);
      this.addEventListener("keydown", this.onKeyDown);

      if (this.projectPathValue) {
        void this.reload();
      }
    }

    /**
     * Cleans up event bindings when the element leaves the document.
     */
    disconnectedCallback(): void {
      this.removeEventListener("blur", this.onBlur);
      this.removeEventListener("focus", this.onFocus);
      this.removeEventListener("keydown", this.onKeyDown);
    }

    /**
     * Updates the active project path and reloads the visible session list.
     */
    set projectPath(value: string) {
      if (this.projectPathValue === value) return;

      this.projectPathValue = value;

      if (this.isConnected) {
        void this.reload();
      }
    }

    /**
     * Returns the current project path used to filter persisted sessions.
     */
    get projectPath(): string {
      return this.projectPathValue;
    }

    /**
     * Allows the page to replace the session reader implementation if needed.
     */
    set repository(value: CodexSessionReader) {
      this.sessionReader = value;

      if (this.isConnected) {
        void this.reload();
      }
    }

    /**
     * Exposes the currently selected session to parent views.
     */
    get selectedSession(): CodexSessionSummary | null {
      return this.sessions[this.selectedSessionIndex] ?? null;
    }

    /**
     * Loads the latest sessions for the active project and refreshes the panel.
     */
    async reload(): Promise<void> {
      this.isLoading = true;
      this.render();

      try {
        this.loadError = null;
        this.sessions = await this.sessionReader.listByProject(this.projectPathValue);
        this.selectedSessionIndex = 0;
      } catch {
        this.loadError = "Failed to load Codex sessions.";
        this.sessions = [];
        this.selectedSessionIndex = 0;
      }

      this.isLoading = false;
      this.render();
      this.revealSelectedSession();
      this.dispatchSelectionChange();
    }

    /**
     * Re-renders the light DOM for the panel.
     */
    private render(): void {
      const titleClass = this.hasFocus ? "sessions-panel__title is-focused" : "sessions-panel__title";

      this.innerHTML = `
        <style>
          sessions-panel {
            display: block;
            width: fit-content;
            height: 37%;
            border: 1px solid #5fafff;
            border-radius: 5px;
            box-sizing: border-box;
            overflow: hidden;
          }

          sessions-panel:focus {
            border-color: #fff;
            outline: none;
          }

          .sessions-panel__title {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            color: #5fafff;
            border: 1px solid transparent;
          }

          .sessions-panel__title.is-focused {
            color: #fff;
          }

          .sessions-panel__content {
            overflow: scroll;
            max-height: 15px;
          }

          .sessions-panel__item {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            height: 3px;
          }

          .sessions-panel__item.is-selected {
            color: #ffffff;
            height: 3px;
            background: #2E668C;
          }

          .sessions-panel__item-title {
            color: #d7ecff;
            font-size: 6px;
          }

          .sessions-panel__meta,
          .sessions-panel__muted {
            color: #8aa4bf;
          }

          .sessions-panel__footer {
            display: flex;
            justify-content: flex-end;
            color: #8aa4bf;
          }
        </style>

        <div>
          <span class="${titleClass}">Sessions <span class="sessions-panel__footer">${this.renderSessionCountMarkup()}</span></span>
        </div>
        <div class="sessions-panel__content">
          ${this.renderContentMarkup()}
        </div>
      `;
    }

    /**
     * Tracks when the panel loses focus so the title returns to its inactive color.
     */
    private onBlur(): void {
      this.hasFocus = false;
      this.render();
    }

    /**
     * Tracks when the panel gains focus so the title uses the active color.
     */
    private onFocus(): void {
      this.hasFocus = true;
      this.render();
    }

    /**
     * Moves the current selection up or down within the session list.
     */
    private moveSelection(direction: 1 | -1): void {
      if (this.sessions.length === 0) return;

      this.selectedSessionIndex =
        (this.selectedSessionIndex + direction + this.sessions.length) % this.sessions.length;

      this.render();
      this.revealSelectedSession();
      this.dispatchSelectionChange();
    }

    /**
     * Keeps the selected session row visible inside the scrollable content area.
     */
    private revealSelectedSession(): void {
      const selectedItem = this.querySelector<HTMLElement>("[data-selected='true']");

      selectedItem?.scrollIntoView({ block: "nearest" });
    }

    /**
     * Handles list navigation keys while the panel itself is focused.
     */
    private onKeyDown(event: KeyboardEvent): void {
      const key = event.key.toLowerCase();

      if (key === "j" || key === "arrowdown") {
        this.moveSelection(1);
        event.preventDefault();
        return;
      }

      if (key === "k" || key === "arrowup") {
        this.moveSelection(-1);
        event.preventDefault();
      }
    }

    /**
     * Emits the selected session so the rest of the layout can stay in sync.
     */
    private dispatchSelectionChange(): void {
      const detail: SessionSelectionChangeDetail = {
        session: this.selectedSession,
        sessionCount: this.sessions.length,
        projectPath: this.projectPathValue,
        error: this.loadError,
      };

      this.dispatchEvent(new window.CustomEvent<SessionSelectionChangeDetail>("session-change", {
        bubbles: true,
        detail,
      }));
    }

    /**
     * Builds the markup for loading, empty, error, and populated session states.
     */
    private renderContentMarkup(): string {
      if (this.isLoading) {
        return `<div>Loading sessions...</div>`;
      }

      if (this.loadError) {
        return `<div>${this.escapeHtml(this.loadError)}</div>`;
      }

      if (this.sessions.length === 0) {
        return `
          <div>No saved Codex sessions for this project yet.</div>
          <div class="sessions-panel__muted" style="margin-top: 0.5rem;">Start one here by pressing n.</div>
        `;
      }

      return this.sessions.map((session, index) => {
        const marker = index === this.selectedSessionIndex ? "◉" : "○";
        const selectedClass = index === this.selectedSessionIndex ? "sessions-panel__item is-selected" : "sessions-panel__item";
        const selectedAttribute = index === this.selectedSessionIndex ? ' data-selected="true"' : "";

        return `
          <div class="${selectedClass}"${selectedAttribute}>
            <div><span>${marker}</span> <span class="sessions-panel__item-title">${this.escapeHtml(session.title)}</span> <span class="sessions-panel__meta">${this.escapeHtml(session.relativeUpdated)} · ${this.escapeHtml(session.status)}</span></div>
          </div>
        `;
      })
        .join("");
    }

    /**
     * Builds the bottom-right session count and selected position label.
     */
    private renderSessionCountMarkup(): string {
      if (this.isLoading) return "Loading";
      if (this.loadError) return "Error";
      if (this.sessions.length === 0) return "(0)";

      return `(${this.selectedSessionIndex + 1}/${this.sessions.length})`;
    }

    /**
     * Escapes display strings before injecting them into the panel markup.
     */
    private escapeHtml(value: string): string {
      return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }
  }

  window.customElements.define("sessions-panel", SessionsPanel);
}
