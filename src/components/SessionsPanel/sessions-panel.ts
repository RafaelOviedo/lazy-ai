import { CodexSessionRepository } from "../../repositories/sessions/codex/index.js";
import { escapeHtml } from "../../shared/lib/html/index.js";
import { Keybindings } from "../../app/keybindings.types.js";

import type { CodexSessionReader, CodexSessionSummary } from "../../repositories/sessions/codex/types.js";

import { SessionResumeRequestDetail, SessionSelectionChangeDetail, TermWindow } from "./types.js";

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
    private activeSessionIdValue: string | null = null;
    private resumingSessionIdValue: string | null = null;
    private alreadyRunningSessionIdValue: string | null = null;
    private sessionReader: CodexSessionReader = new CodexSessionRepository();
    private sessions: CodexSessionSummary[] = [];
    private selectedSessionIndex = 0;
    private isLoading = true;
    private loadError: string | null = null;

    constructor() {
      super();
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onFocus = this.onFocus.bind(this);
      this.onBlur = this.onBlur.bind(this);
    }

    /**
     * Initializes the panel markup and loads sessions when the element is attached.
     */
    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.render();
      this.addEventListener("focus", this.onFocus);
      this.addEventListener("blur", this.onBlur);
      this.addEventListener("keydown", this.onKeyDown);

      if (this.projectPathValue) {
        void this.reload();
      }
    }

    /**
     * Cleans up event bindings when the element leaves the document.
     */
    disconnectedCallback(): void {
      this.removeEventListener("focus", this.onFocus);
      this.removeEventListener("blur", this.onBlur);
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
     * Updates the active session id shown as running.
     */
    set activeSessionId(value: string | null) {
      if (this.activeSessionIdValue === value) return;

      const shouldSelectActiveSession = value !== null;
      this.activeSessionIdValue = value;

      if (this.isConnected) {
        this.promoteActiveSession(shouldSelectActiveSession);
        this.render();
        this.revealSelectedSession();
        this.dispatchSelectionChange();
      }
    }

    /**
     * Returns the session id currently marked as running.
     */
    get activeSessionId(): string | null {
      return this.activeSessionIdValue;
    }

    /**
     * Updates the session id currently shown as resuming.
     */
    setSessionResuming(sessionId: string | null): void {
      if (this.resumingSessionIdValue === sessionId) return;

      const previousResumingSessionId = this.resumingSessionIdValue;

      this.resumingSessionIdValue = sessionId;

      if (!this.isConnected) return;

      this.updateSessionStatusMarkup(previousResumingSessionId);
      this.updateSessionStatusMarkup(sessionId);
    }

    /**
     * Updates the session id currently shown as already running.
     */
    setSessionAlreadyRunning(sessionId: string | null): void {
      if (this.alreadyRunningSessionIdValue === sessionId) return;

      const previousAlreadyRunningSessionId = this.alreadyRunningSessionIdValue;

      this.alreadyRunningSessionIdValue = sessionId;

      if (!this.isConnected) return;

      this.updateSessionStatusMarkup(previousAlreadyRunningSessionId);
      this.updateSessionStatusMarkup(sessionId);
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
        this.promoteActiveSession(false);
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
      this.innerHTML = `
        <style>
          sessions-panel {
            display: block;
            width: fit-content;
            min-height: 30%;
            border: 1px solid #5fafff;
            border-radius: 5px;
            box-sizing: border-box;
            overflow: hidden;
          }

          sessions-panel:focus {
            border-color: #fff;
            outline: none;
          }

          sessions-panel.is-focused .sessions-panel__title,
          sessions-panel.is-focused .sessions-panel__counter {
            color: #fff;
          }

          sessions-panel.is-focused .sessions-panel__item.is-selected {
            color: #ffffff;
            background: #2E668C;
          }

          .sessions-panel__title {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            color: #5fafff;
            border: 1px solid transparent;
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
            height: 3px;
          }

          .sessions-panel__item-title {
            color: #d7ecff;
            font-size: 6px;
          }

          .sessions-panel__meta,
          .sessions-panel__muted {
            color: #8aa4bf;
          }

          .sessions-panel__status-running {
            color: #43B53E;
          }

          .sessions-panel__status-resuming {
            color: #d7ba7d;
          }

          .sessions-panel__status-already-running {
            color: #B81D1D;
          }

          .sessions-panel__counter {
            display: flex;
            justify-content: flex-end;
            color: #5fafff;
          }
        </style>

        <div>
          <span class="sessions-panel__title">Sessions <span class="sessions-panel__counter">${this.renderSessionCountMarkup()}</span></span>
        </div>
        <div class="sessions-panel__content">
          ${this.renderContentMarkup()}
        </div>
      `;
    }

    /**
     * Moves the current selection up or down within the session list.
     */
    private moveSelection(direction: 1 | -1): void {
      if (this.sessions.length === 0) return;

      const previousSessionIndex = this.selectedSessionIndex;
      this.selectedSessionIndex =
        (this.selectedSessionIndex + direction + this.sessions.length) % this.sessions.length;

      this.updateSelectedSessionMarkup(previousSessionIndex, this.selectedSessionIndex);
      this.revealSelectedSession();
      this.dispatchSelectionChange();
    }

    /**
     * Updates only the affected session rows instead of rebuilding the panel.
     */
    private updateSelectedSessionMarkup(previousSessionIndex: number, nextSessionIndex: number): void {
      const previousItem = this.getSessionItemElement(previousSessionIndex);
      const nextItem = this.getSessionItemElement(nextSessionIndex);

      if (!previousItem || !nextItem) {
        this.render();
        return;
      }

      this.setSessionItemSelected(previousItem, false);
      this.setSessionItemSelected(nextItem, true);

      const counter = this.querySelector<HTMLElement>(".sessions-panel__counter");

      if (counter) {
        counter.textContent = this.renderSessionCountMarkup();
      }
    }

    /**
     * Finds one rendered session row by index.
     */
    private getSessionItemElement(index: number): HTMLElement | null {
      return this.querySelector<HTMLElement>(`[data-session-index="${index}"]`);
    }

    /**
     * Applies selected state to one session row.
     */
    private setSessionItemSelected(item: HTMLElement, isSelected: boolean): void {
      const marker = item.querySelector<HTMLElement>("[data-selection-marker='true']");

      item.classList.toggle("is-selected", isSelected);

      if (isSelected) {
        item.setAttribute("data-selected", "true");
      } else {
        item.removeAttribute("data-selected");
      }

      if (marker) {
        marker.textContent = isSelected ? "◉" : "○";
      }
    }

    /**
     * Updates only one rendered status label.
     */
    private updateSessionStatusMarkup(sessionId: string | null): void {
      if (!sessionId) return;

      const index = this.sessions.findIndex((session) => session.id === sessionId);
      const item = index === -1 ? null : this.getSessionItemElement(index);
      const status = item?.querySelector<HTMLElement>("[data-session-status='true']");

      if (!status || index === -1) return;

      status.innerHTML = this.renderSessionStatusMarkup(this.sessions[index]);
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

      if (key === Keybindings.J || key === "arrowdown") {
        this.moveSelection(1);
        event.preventDefault();
        return;
      }

      if (key === Keybindings.K || key === "arrowup") {
        this.moveSelection(-1);
        event.preventDefault();
        return;
      }

      if (event.key === Keybindings.SPACE) {
        this.dispatchResumeRequest();
        event.preventDefault();
      }
    }

    /**
     * Marks the host as focused without rebuilding the panel DOM.
     */
    private onFocus(): void {
      this.classList.add("is-focused");
    }

    /**
     * Clears focused host styling without rebuilding the panel DOM.
     */
    private onBlur(): void {
      this.classList.remove("is-focused");
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
     * Emits the selected session as the requested running session.
     */
    private dispatchResumeRequest(): void {
      const selectedSession = this.selectedSession;

      if (!selectedSession) return;

      const detail: SessionResumeRequestDetail = {
        session: selectedSession,
        projectPath: this.projectPathValue,
      };

      this.dispatchEvent(new window.CustomEvent<SessionResumeRequestDetail>("session-resume-request", {
        bubbles: true,
        detail,
      }));
    }

    /**
     * Moves the active session to the top while preserving selected session identity.
     */
    private promoteActiveSession(selectActiveSession: boolean): void {
      if (!this.activeSessionIdValue || this.sessions.length === 0) return;

      const activeSessionIndex = this.sessions.findIndex((session) => session.id === this.activeSessionIdValue);

      if (activeSessionIndex === -1) return;

      const selectedSessionId = this.selectedSession?.id;
      const activeSession = this.sessions[activeSessionIndex];

      if (activeSessionIndex > 0) {
        this.sessions.splice(activeSessionIndex, 1);
        this.sessions.unshift(activeSession);
      }

      if (selectActiveSession) {
        this.selectedSessionIndex = 0;
        return;
      }

      this.selectedSessionIndex = selectedSessionId
        ? Math.max(0, this.sessions.findIndex((session) => session.id === selectedSessionId))
        : 0;
    }

    /**
     * Builds the markup for loading, empty, error, and populated session states.
     */
    private renderContentMarkup(): string {
      if (this.isLoading) {
        return `<div>Loading sessions...</div>`;
      }

      if (this.loadError) {
        return `<div>${escapeHtml(this.loadError)}</div>`;
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
          <div class="${selectedClass}" data-session-index="${index}"${selectedAttribute}>
            <div><span data-selection-marker="true">${marker}</span> <span class="sessions-panel__item-title">${escapeHtml(session.title)}</span> <span class="sessions-panel__meta">${escapeHtml(session.relativeUpdated)} · <span data-session-status="true">${this.renderSessionStatusMarkup(session)}</span></span></div>
          </div>
        `;
      })
        .join("");
    }

    /**
     * Builds the saved/running status label.
     */
    private renderSessionStatusMarkup(session: CodexSessionSummary): string {
      if (session.id === this.alreadyRunningSessionIdValue) {
        return `<span class="sessions-panel__status-already-running">Already running</span>`;
      }

      if (session.id === this.resumingSessionIdValue) {
        return `<span class="sessions-panel__status-resuming">Resuming...</span>`;
      }

      if (session.id === this.activeSessionIdValue) {
        return `<span class="sessions-panel__status-running">Running</span>`;
      }

      return escapeHtml(session.status);
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

  }

  window.customElements.define("sessions-panel", SessionsPanel);
}
