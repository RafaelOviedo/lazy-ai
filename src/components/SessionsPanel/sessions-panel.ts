import { CodexSessionRepository } from "../../repositories/sessions/codex/index.js";
import { escapeHtml } from "../../shared/lib/html/index.js";
import { Keybindings } from "../../app/keybindings.types.js";

import type { CodexSessionReader, CodexSessionSummary } from "../../repositories/sessions/codex/types.js";

import { SessionDeleteRequestDetail, SessionResumeRequestDetail, SessionSelectionChangeDetail, TermWindow } from "./types.js";

type SessionStatusPresentation = {
  className: string | null;
  text: string;
};

const fallbackSessionTitleLength = 10;
const minSessionTitleLength = 10;
const maxSessionTitleLength = 40;
const sessionsPanelViewportRatio = 0.3 * 0.98;
const sessionRowPaddingWidth = 3;
const sessionPanelBorderWidth = 2;

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
    private deletingSessionIdValue: string | null = null;
    private thinkingSessionIdValue: string | null = null;
    private alreadyRunningSessionIdValue: string | null = null;
    private resumeFailedSessionIdValue: string | null = null;
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
      this.onResize = this.onResize.bind(this);
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
      window.addEventListener("resize", this.onResize);

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
      window.removeEventListener("resize", this.onResize);
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

      const previousActiveSessionId = this.activeSessionIdValue;
      const previousSelectedSessionIndex = this.selectedSessionIndex;
      this.activeSessionIdValue = value;

      if (this.isConnected) {
        if (value) {
          const activeSessionIndex = this.sessions.findIndex((session) => session.id === value);

          if (activeSessionIndex !== -1) {
            if (activeSessionIndex > 0) {
              const activeSession = this.sessions[activeSessionIndex];

              this.sessions.splice(activeSessionIndex, 1);
              this.sessions.unshift(activeSession);
            }

            this.selectedSessionIndex = 0;
            this.syncSessionListMarkup(value);
            this.updateSessionStatusMarkup(previousActiveSessionId);
            this.updateSessionStatusMarkup(value);
            this.updateSelectedSessionMarkup(previousSelectedSessionIndex, this.selectedSessionIndex);
            this.updateSessionCountMarkup();
            this.revealSelectedSession();
            this.dispatchSelectionChange();
            return;
          }
        }

        this.updateSessionStatusMarkup(previousActiveSessionId);
        this.updateSessionStatusMarkup(value);
        this.updateSessionCountMarkup();
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
     * Updates the session id currently shown as deleting.
     */
    setSessionDeleting(sessionId: string | null): void {
      if (this.deletingSessionIdValue === sessionId) return;

      const previousDeletingSessionId = this.deletingSessionIdValue;

      this.deletingSessionIdValue = sessionId;

      if (!this.isConnected) return;

      this.updateSessionStatusMarkup(previousDeletingSessionId);
      this.updateSessionStatusMarkup(sessionId);
    }

    /**
     * Updates the session id currently waiting on an initial model response.
     */
    setSessionThinking(sessionId: string | null): void {
      if (this.thinkingSessionIdValue === sessionId) return;

      const previousThinkingSessionId = this.thinkingSessionIdValue;

      this.thinkingSessionIdValue = sessionId;

      if (!this.isConnected) return;

      this.updateSessionStatusMarkup(previousThinkingSessionId);
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
     * Updates the session id currently shown as failed to resume.
     */
    setSessionResumeFailed(sessionId: string | null): void {
      if (this.resumeFailedSessionIdValue === sessionId) return;

      const previousResumeFailedSessionId = this.resumeFailedSessionIdValue;

      this.resumeFailedSessionIdValue = sessionId;

      if (!this.isConnected) return;

      this.updateSessionStatusMarkup(previousResumeFailedSessionId);
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
     * Returns one loaded session by id when it is present in the current list.
     */
    getSession(sessionId: string): CodexSessionSummary | null {
      return this.sessions.find((session) => session.id === sessionId) ?? null;
    }

    /**
     * Selects one loaded session by id.
     */
    selectSession(sessionId: string): boolean {
      const nextSessionIndex = this.sessions.findIndex((session) => session.id === sessionId);

      if (nextSessionIndex === -1) return false;

      const previousSessionIndex = this.selectedSessionIndex;
      this.selectedSessionIndex = nextSessionIndex;

      if (this.isConnected) {
        this.updateSelectedSessionMarkup(previousSessionIndex, this.selectedSessionIndex);
        this.updateSessionCountMarkup();
        this.revealSelectedSession();
        this.dispatchSelectionChange();
      }

      return true;
    }

    /**
     * Reports whether the current rendered session list contains one session id.
     */
    hasSession(sessionId: string): boolean {
      return this.sessions.some((session) => session.id === sessionId);
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
     * Refreshes one session from storage and reconciles its row without entering full-panel loading.
     */
    async syncSession(sessionId: string): Promise<CodexSessionSummary | null> {
      try {
        const sessions = await this.sessionReader.listByProject(this.projectPathValue);
        const session = sessions.find((candidateSession) => candidateSession.id === sessionId) ?? null;

        if (!session) return null;

        this.loadError = null;
        this.upsertSession(session);

        return session;
      } catch {
        this.loadError = "Failed to load Codex sessions.";
        this.dispatchSelectionChange();

        return null;
      }
    }

    /**
     * Re-renders the light DOM for the panel.
     */
    private render(): void {
      this.innerHTML = `
        <style>
          sessions-panel {
            display: flex;
            flex-direction: column;
            width: fit-content;
            height: 30%;
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
            flex: 0 0 auto;
            color: #5fafff;
            border: 1px solid transparent;
          }

          .sessions-panel__content {
            flex: 1 1 auto;
            min-height: 0;
            overflow: scroll;
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

          .sessions-panel__status-deleting {
            color: #d7ba7d;
          }

          .sessions-panel__status-thinking {
            color: #d7ba7d;
          }

          .sessions-panel__status-already-running {
            color: #B81D1D;
          }

          .sessions-panel__status-failed {
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
      if (previousSessionIndex === nextSessionIndex) {
        const item = this.getSessionItemElement(nextSessionIndex);

        if (item) {
          this.setSessionItemSelected(item, true);
        }

        return;
      }

      const previousItem = this.getSessionItemElement(previousSessionIndex);
      const nextItem = this.getSessionItemElement(nextSessionIndex);

      if (!previousItem || !nextItem) {
        this.render();
        return;
      }

      this.setSessionItemSelected(previousItem, false);
      this.setSessionItemSelected(nextItem, true);
      this.updateSessionCountMarkup();
    }

    /**
     * Finds one rendered session row by index.
     */
    private getSessionItemElement(index: number): HTMLElement | null {
      return this.querySelector<HTMLElement>(`[data-session-index="${index}"]`);
    }

    /**
     * Finds one rendered session row by session id.
     */
    private getSessionItemElementById(sessionId: string): HTMLElement | null {
      const items = this.querySelectorAll<HTMLElement>("[data-session-id]");

      for (const item of items) {
        if (item.getAttribute("data-session-id") === sessionId) {
          return item;
        }
      }

      return null;
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
      const title = item?.querySelector<HTMLElement>("[data-session-title='true']");

      if (!status || index === -1) return;

      status.innerHTML = this.renderSessionStatusMarkup(this.sessions[index]);

      if (title) {
        title.textContent = this.truncateSessionTitle(this.sessions[index]);
      }
    }

    /**
     * Updates the session count label in place.
     */
    private updateSessionCountMarkup(): void {
      const counter = this.querySelector<HTMLElement>(".sessions-panel__counter");

      if (counter) {
        counter.textContent = this.renderSessionCountMarkup();
      }
    }

    /**
     * Inserts or updates one session in the rendered list.
     */
    private upsertSession(session: CodexSessionSummary): void {
      if (this.projectPathValue && session.projectPath !== this.projectPathValue) return;

      const selectedSessionId = this.selectedSession?.id ?? null;
      const existingSessionIndex = this.sessions.findIndex((candidateSession) => candidateSession.id === session.id);

      if (existingSessionIndex === -1) {
        this.sessions.unshift(session);
      } else {
        this.sessions[existingSessionIndex] = session;

        if (existingSessionIndex > 0) {
          this.sessions.splice(existingSessionIndex, 1);
          this.sessions.unshift(session);
        }
      }

      if (this.activeSessionIdValue === session.id) {
        this.selectedSessionIndex = 0;
      } else if (selectedSessionId) {
        this.selectedSessionIndex = Math.max(0, this.sessions.findIndex((candidateSession) => candidateSession.id === selectedSessionId));
      } else {
        this.selectedSessionIndex = 0;
      }

      if (!this.isConnected) return;

      this.isLoading = false;

      if (!this.syncSessionListMarkup(session.id)) {
        this.render();
      }

      this.updateSessionCountMarkup();
      this.revealSelectedSession();
      this.dispatchSelectionChange();
    }

    /**
     * Reconciles the DOM around one changed session row.
     */
    private syncSessionListMarkup(changedSessionId: string): boolean {
      const content = this.querySelector<HTMLElement>(".sessions-panel__content");

      if (!content) return false;

      const changedSessionIndex = this.sessions.findIndex((session) => session.id === changedSessionId);

      if (changedSessionIndex === -1) return false;

      const changedSession = this.sessions[changedSessionIndex];
      const hasRenderedRows = this.querySelector("[data-session-id]") !== null;
      const existingItem = this.getSessionItemElementById(changedSessionId);

      if (!hasRenderedRows) {
        content.innerHTML = this.renderSessionItemMarkup(changedSession, changedSessionIndex);
      } else if (!existingItem) {
        content.insertAdjacentHTML("afterbegin", this.renderSessionItemMarkup(changedSession, changedSessionIndex));
      } else {
        existingItem.outerHTML = this.renderSessionItemMarkup(changedSession, changedSessionIndex);

        const updatedItem = this.getSessionItemElementById(changedSessionId);

        if (updatedItem && changedSessionIndex === 0 && content.firstElementChild !== updatedItem) {
          content.insertBefore(updatedItem, content.firstElementChild);
        }
      }

      this.syncSessionItemIndexes();

      return true;
    }

    /**
     * Keeps rendered row indexes and selection markers aligned with the session array.
     */
    private syncSessionItemIndexes(): void {
      const items = this.querySelectorAll<HTMLElement>("[data-session-id]");

      items.forEach((item, index) => {
        item.setAttribute("data-session-index", String(index));
        this.setSessionItemSelected(item, index === this.selectedSessionIndex);
      });
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
        return;
      }

      if (key === Keybindings.D) {
        this.dispatchDeleteRequest();
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
     * Recomputes adaptive title truncation when the terminal width changes.
     */
    private onResize(): void {
      const content = this.querySelector<HTMLElement>(".sessions-panel__content");

      if (!content || this.isLoading || this.loadError || this.sessions.length === 0) return;

      content.innerHTML = this.renderContentMarkup();
      this.revealSelectedSession();
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
     * Emits the selected session as the requested deletion target.
     */
    private dispatchDeleteRequest(): void {
      const selectedSession = this.selectedSession;

      if (!selectedSession) return;

      const detail: SessionDeleteRequestDetail = {
        session: selectedSession,
        projectPath: this.projectPathValue,
      };

      this.dispatchEvent(new window.CustomEvent<SessionDeleteRequestDetail>("session-delete-request", {
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

      return this.sessions.map((session, index) => this.renderSessionItemMarkup(session, index))
        .join("");
    }

    /**
     * Builds one saved-session row.
     */
    private renderSessionItemMarkup(session: CodexSessionSummary, index: number): string {
      const marker = index === this.selectedSessionIndex ? "◉" : "○";
      const selectedClass = index === this.selectedSessionIndex ? "sessions-panel__item is-selected" : "sessions-panel__item";
      const selectedAttribute = index === this.selectedSessionIndex ? ' data-selected="true"' : "";
      const itemTitle = this.truncateSessionTitle(session);

      return `
        <div class="${selectedClass}" data-session-id="${escapeHtml(session.id)}" data-session-index="${index}"${selectedAttribute}>
          <div>
            <span data-selection-marker="true">${marker}</span> 
            <span class="sessions-panel__item-title" data-session-title="true">${escapeHtml(itemTitle)}</span> 
            <span class="sessions-panel__meta">
              ${escapeHtml(session.relativeUpdated)} · 
              <span data-session-status="true">${this.renderSessionStatusMarkup(session)}</span>
            </span>
          </div>
        </div>
      `;
    }

    private truncateSessionTitle(session: CodexSessionSummary): string {
      const titleLength = this.getSessionTitleLength(session);

      if (session.title.length <= titleLength) return session.title;

      return `${session.title.slice(0, titleLength - 3)}...`;
    }

    private getSessionTitleLength(session: CodexSessionSummary): number {
      const rowWidth = this.getSessionRowWidth();
      const metaText = `${session.relativeUpdated}`;
      const availableTitleWidth = rowWidth - metaText.length - sessionRowPaddingWidth;

      return Math.min(
        maxSessionTitleLength,
        Math.max(minSessionTitleLength, availableTitleWidth),
      );
    }

    private getSessionRowWidth(): number {
      const parentWidth = this.parentElement?.clientWidth ?? 0;
      const viewportPanelWidth = Math.floor(window.innerWidth * sessionsPanelViewportRatio);
      const panelWidth = parentWidth > 0 ? parentWidth : viewportPanelWidth;

      return Math.max(fallbackSessionTitleLength, panelWidth - sessionPanelBorderWidth);
    }

    /**
     * Builds the saved/running status label.
     */
    private renderSessionStatusMarkup(session: CodexSessionSummary): string {
      const status = this.resolveSessionStatus(session);
      const statusText = escapeHtml(status.text);

      return status.className
        ? `<span class="${status.className}">${statusText}</span>`
        : statusText;
    }

    private resolveSessionStatus(session: CodexSessionSummary): SessionStatusPresentation {
      if (session.id === this.resumeFailedSessionIdValue) {
        return { className: "sessions-panel__status-failed", text: "Resume failed" };
      }

      if (session.id === this.alreadyRunningSessionIdValue) {
        return { className: "sessions-panel__status-already-running", text: "Already running" };
      }

      if (session.id === this.resumingSessionIdValue) {
        return { className: "sessions-panel__status-resuming", text: "Resuming..." };
      }

      if (session.id === this.deletingSessionIdValue) {
        return { className: "sessions-panel__status-deleting", text: "Deleting..." };
      }

      if (session.id === this.thinkingSessionIdValue) {
        return { className: "sessions-panel__status-thinking", text: "Thinking..." };
      }

      if (session.id === this.activeSessionIdValue) {
        return { className: "sessions-panel__status-running", text: "Active" };
      }

      return { className: null, text: session.status };
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
