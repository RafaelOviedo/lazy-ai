import { escapeHtml } from "../../shared/lib/html/index.js";

import type { CodexSessionSummary } from "../../repositories/sessions/codex/types.js";
import type { TermWindow } from "./types.js";

/**
 * Registers the Status panel custom element against a TermDOM window.
 */
export function ensureStatusPanelDefined(window: TermWindow): void {
  if (window.customElements.get("status-panel")) {
    return;
  }

  /**
   * Renders the current project/session status.
   */
  class StatusPanel extends window.HTMLElement {
    private loadErrorValue: string | null = null;
    private projectLoadErrorValue: string | null = null;
    private selectedSessionValue: CodexSessionSummary | null = null;

    /**
     * Initializes the panel markup when the element is attached.
     */
    connectedCallback(): void {
      this.render();
    }

    /**
     * Updates the session loading error.
     */
    set loadError(value: string | null) {
      if (this.loadErrorValue === value) return;

      this.loadErrorValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the session loading error.
     */
    get loadError(): string | null {
      return this.loadErrorValue;
    }

    /**
     * Updates the project loading error.
     */
    set projectLoadError(value: string | null) {
      if (this.projectLoadErrorValue === value) return;

      this.projectLoadErrorValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the project loading error.
     */
    get projectLoadError(): string | null {
      return this.projectLoadErrorValue;
    }

    /**
     * Updates the selected session shown in the status panel.
     */
    set selectedSession(value: CodexSessionSummary | null) {
      if (this.selectedSessionValue === value) return;

      this.selectedSessionValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the selected session shown in the status panel.
     */
    get selectedSession(): CodexSessionSummary | null {
      return this.selectedSessionValue;
    }

    /**
     * Re-renders the light DOM for the panel.
     */
    private render(): void {
      this.innerHTML = `
        <style>
          status-panel {
            display: block;
            width: 97.5%;
            height: 5%;
            border: 1px solid #5fafff;
            border-radius: 5px;
            box-sizing: border-box;
          }

          .status-panel__title {
            color: #5fafff;
          }

          .status-panel__content {
            padding: 0.5rem 1ch;
          }
        </style>

        <legend class="status-panel__title">Current status</legend>
        <div class="status-panel__content">${this.renderContentMarkup()}</div>
      `;
    }

    /**
     * Builds the markup for error, empty, and selected session states.
     */
    private renderContentMarkup(): string {
      if (this.projectLoadErrorValue) {
        return escapeHtml(this.projectLoadErrorValue);
      }

      if (this.loadErrorValue) {
        return escapeHtml(this.loadErrorValue);
      }

      if (!this.selectedSessionValue) {
        return "Sessions panel ready. No saved session selected.";
      }

      return `Codex · ${escapeHtml(this.selectedSessionValue.status)} · ${escapeHtml(this.selectedSessionValue.relativeUpdated)} · ${escapeHtml(this.shortSessionId(this.selectedSessionValue.id))}`;
    }

    /**
     * Returns the compact session id used in status summaries.
     */
    private shortSessionId(sessionId: string): string {
      return sessionId.slice(0, 8);
    }
  }

  window.customElements.define("status-panel", StatusPanel);
}
