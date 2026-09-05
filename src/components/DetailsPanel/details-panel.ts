import { escapeHtml } from "../../shared/lib/html/index.js";

import type { CodexSessionSummary } from "../../repositories/sessions/codex/types.js";
import type { TermWindow } from "./types.js";

/**
 * Registers the Details panel custom element against a TermDOM window.
 */
export function ensureDetailsPanelDefined(window: TermWindow): void {
  if (window.customElements.get("details-panel")) {
    return;
  }

  /**
   * Renders selected-session detail content.
   */
  class DetailsPanel extends window.HTMLElement {
    private selectedSessionValue: CodexSessionSummary | null = null;

    /**
     * Initializes the panel markup when the element is attached.
     */
    connectedCallback(): void {
      this.render();
    }

    /**
     * Updates the selected session shown in the details panel.
     */
    set selectedSession(value: CodexSessionSummary | null) {
      if (this.selectedSessionValue === value) return;

      this.selectedSessionValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the selected session shown in the details panel.
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
          details-panel {
            display: block;
            width: 67%;
            height: 87%;
            border: 1px solid #5fafff;
            border-radius: 5px;
            box-sizing: border-box;
            overflow: hidden;
          }

          .details-panel__title {
            color: #5fafff;
          }

          .details-panel__content {
            padding: 0.5rem 1ch;
            white-space: pre-wrap;
          }

          .details-panel__session-title {
            color: #d7ecff;
          }

          .details-panel__muted {
            color: #8aa4bf;
          }
        </style>

        <div>
          <span class="details-panel__title">Details</span>
        </div>
        <div class="details-panel__content">
          ${this.renderContentMarkup()}
        </div>
      `;
    }

    /**
     * Builds the markup for empty and selected session states.
     */
    private renderContentMarkup(): string {
      if (!this.selectedSessionValue) {
        return `
          <div>No session selected yet.</div>
          <div class="details-panel__muted" style="margin-top: 0.5rem;">This panel will show transcript and tool activity once session interaction is wired in.</div>
        `;
      }

      return `
        <div class="details-panel__session-title">${escapeHtml(this.selectedSessionValue.title)}</div>
      `;
    }
  }

  window.customElements.define("details-panel", DetailsPanel);
}
