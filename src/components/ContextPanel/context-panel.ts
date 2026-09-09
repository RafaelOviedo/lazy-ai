import type { CodexSessionSummary } from "../../repositories/sessions/codex/types.js";
import type { TermWindow } from "./types.js";
import { escapeHtml } from "../../shared/lib/html/index.js";
import { formatTokenCount, getTokenBarSegments } from "../../shared/lib/tokens/index.js";

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

    /**
     * Initializes the panel markup when the element is attached.
     */
    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.render();
    }

    /**
     * Cleans up event bindings when the element leaves the document.
     */
    disconnectedCallback(): void {
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
      this.innerHTML = `
        <style>
          context-panel {
            display: block;
            width: fit-content;
            min-height: 30%;
            border: 1px solid #5fafff;
            border-radius: 5px;
            box-sizing: border-box;
            overflow: hidden;
          }

          context-panel:focus {
            border-color: #fff;
            outline: none;
          }

          context-panel:focus .context-panel__title {
            color: #fff;
          }

          .context-panel__title {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            color: #5fafff;
            border: 1px solid transparent;
          }

          .context-panel__content {
            overflow: scroll;
            min-height: 14px;
          }

          .context-panel__muted {
            color: #8aa4bf;
          }

          .context-panel__usage {
            margin-top: 0.5rem;
          }

          .context-panel__done {
            color: #43B53E;
          }

          .context-panel__rest {
            color: #444;
          }

          .context-panel__pct {
            color: #888;
          }
        </style>

        <div>
          <span class="context-panel__title">Context</span>
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
          <div class="context-panel__muted">Model</div><div>${escapeHtml(this.selectedSessionValue.model)}</div> · <div class="context-panel__muted">Updated</div>
          <div>${escapeHtml(this.selectedSessionValue.relativeUpdated)}</div>
          ${this.renderContextUsageMarkup()}
        </div>
      `;
    }

    /**
     * Builds the selected session's context usage display.
     */
    private renderContextUsageMarkup(): string {
      if (!this.selectedSessionValue?.contextUsage) {
        return `
          <div class="context-panel__usage">
            <div class="context-panel__muted">Context usage</div>
            <div>usage unavailable</div>
          </div>
        `;
      }

      const { maxTokens, percent, usedTokens } = this.selectedSessionValue.contextUsage;
      const tokenBar = getTokenBarSegments(percent);

      return `
        <div class="context-panel__usage">
          <div class="context-panel__muted">Context usage</div>
          <div>
            <span class="context-panel__done">${tokenBar.done}</span><span class="context-panel__rest">${tokenBar.rest}</span>
            <span class="context-panel__pct">${percent}%/100%</span>
          </div>
          <div>${formatTokenCount(usedTokens)} / ${formatTokenCount(maxTokens)} tokens</div>
        </div>
      `;
    }
  }

  window.customElements.define("context-panel", ContextPanel);
}
