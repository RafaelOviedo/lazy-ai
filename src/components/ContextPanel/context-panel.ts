import type { CodexSessionSummary } from "../../repositories/sessions/codex/types.js";
import type { TermWindow } from "./types.js";
import { escapeHtml } from "../../shared/lib/html/index.js";
import { useFocusable } from "../../composables/useFocusable.js";

/**
 * Registers the Context panel custom element against a TermDOM window.
 */
export function ensureContextPanelDefined(window: TermWindow): void {
  if (window.customElements.get("context-panel")) {
    return;
  }

  /**
   * Renders the Context panel and owns the current project/session context state.
   */
  class ContextPanel extends window.HTMLElement {
    private projectNameValue = "";
    private projectPathValue = "";
    private selectedSessionValue: CodexSessionSummary | null = null;
    private readonly focusable = useFocusable(() => this.render());

    /**
     * Initializes the panel markup when the element is attached.
     */
    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.render();
      this.addEventListener("blur", this.focusable.onBlur);
      this.addEventListener("focus", this.focusable.onFocus);
    }

    /**
     * Cleans up event bindings when the element leaves the document.
     */
    disconnectedCallback(): void {
      this.removeEventListener("blur", this.focusable.onBlur);
      this.removeEventListener("focus", this.focusable.onFocus);
    }

    /**
     * Updates the selected project name shown when no session is selected.
     */
    set projectName(value: string) {
      if (this.projectNameValue === value) return;

      this.projectNameValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the selected project name.
     */
    get projectName(): string {
      return this.projectNameValue;
    }

    /**
     * Updates the selected project path shown when no session is selected.
     */
    set projectPath(value: string) {
      if (this.projectPathValue === value) return;

      this.projectPathValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the selected project path.
     */
    get projectPath(): string {
      return this.projectPathValue;
    }

    /**
     * Updates the selected session context.
     */
    set selectedSession(value: CodexSessionSummary | null) {
      if (this.selectedSessionValue === value) return;

      this.selectedSessionValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the selected session context.
     */
    get selectedSession(): CodexSessionSummary | null {
      return this.selectedSessionValue;
    }

    /**
     * Re-renders the light DOM for the panel.
     */
    private render(): void {
      const titleClass = this.focusable.hasFocus ? "context-panel__title is-focused" : "context-panel__title";

      this.innerHTML = `
        <style>
          context-panel {
            display: block;
            width: fit-content;
            height: 29%;
            border: 1px solid #5fafff;
            border-radius: 5px;
            box-sizing: border-box;
            overflow: hidden;
          }

          context-panel:focus {
            border-color: #fff;
            outline: none;
          }

          .context-panel__title {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            color: #5fafff;
            border: 1px solid transparent;
          }

          .context-panel__title.is-focused {
            color: #fff;
          }

          .context-panel__content {
            overflow: scroll;
            max-height: 15px;
          }

          .context-panel__muted {
            color: #8aa4bf;
          }
        </style>

        <div>
          <span class="${titleClass}">Context</span>
        </div>
        <div class="context-panel__content">
          ${this.renderContentMarkup()}
        </div>
      `;
    }

    /**
     * Builds the markup for the project and session context states.
     */
    private renderContentMarkup(): string {
      if (!this.selectedSessionValue) {
        return `
          <div class="context-panel__muted">Source</div>
          <div>~/.codex session history</div>
          <div class="context-panel__muted" style="margin-top: 0.5rem;">Project</div>
          <div>${escapeHtml(this.projectNameValue)}</div>
          <div class="context-panel__muted" style="margin-top: 0.5rem;">Path</div>
          <div>${escapeHtml(this.projectPathValue)}</div>
        `;
      }

      return `
        <div>
          <div class="context-panel__muted">Session ID</div> · <div>${escapeHtml(this.shortSessionId(this.selectedSessionValue.id))}</div> · <div class="context-panel__muted">Model</div><div>${escapeHtml(this.selectedSessionValue.model)}</div><div class="context-panel__muted">Updated</div><div>${escapeHtml(this.selectedSessionValue.relativeUpdated)}</div>
        </div>
      `;
    }

    /**
     * Returns the compact session id used in panel summaries.
     */
    private shortSessionId(sessionId: string): string {
      return sessionId.slice(0, 8);
    }

  }

  window.customElements.define("context-panel", ContextPanel);
}
