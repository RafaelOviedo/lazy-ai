import { escapeHtml } from "../../shared/lib/html/index.js";
import { getTokenBarSegments } from "../../shared/lib/tokens/index.js";

import type { SessionSummary, UsageLimitSnapshot, UsageLimitWindow } from "../../app/types/index.js";
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
    private selectedSessionValue: SessionSummary | null = null;
    private usageLimitSnapshotValue: UsageLimitSnapshot | null = null;

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
    set selectedSession(value: SessionSummary | null) {
      if (this.selectedSessionValue === value) return;

      this.selectedSessionValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the selected session shown in the status panel.
     */
    get selectedSession(): SessionSummary | null {
      return this.selectedSessionValue;
    }

    /**
     * Updates the global Codex usage-limit snapshot shown in the status panel.
     */
    set usageLimitSnapshot(value: UsageLimitSnapshot | null) {
      if (this.usageLimitSnapshotValue === value) return;

      this.usageLimitSnapshotValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the global Codex usage-limit snapshot shown in the status panel.
     */
    get usageLimitSnapshot(): UsageLimitSnapshot | null {
      return this.usageLimitSnapshotValue;
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
            height: 10%;
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

          .status-panel__limit-done {
            color: #d7ba7d;
          }

          .status-panel__limit-done.is-reached {
            color: #ff5f5f;
          }

          .status-panel__limit-rest {
            color: #444;
          }

          .status-panel__muted {
            color: #8aa4bf;
          }
        </style>

        <legend class="status-panel__title">Global status</legend>
        <div class="status-panel__content">${this.renderContentMarkup()}</div>
      `;
    }

    /**
     * Builds the markup for error, empty, and selected session states.
     */
    private renderContentMarkup(): string {
      if (this.projectLoadErrorValue) {
        return `${escapeHtml(this.projectLoadErrorValue)}${this.renderUsageLimitSuffix()}`;
      }

      if (this.loadErrorValue) {
        return `${escapeHtml(this.loadErrorValue)}${this.renderUsageLimitSuffix()}`;
      }

      if (!this.selectedSessionValue) {
        return `Sessions panel ready. No saved session selected. ${this.renderUsageLimitSuffix()}`;
      }

      return `Codex · ${this.renderUsageLimitSuffix()}`;
    }

    /**
     * Builds the global usage-limit summary.
     */
    private renderUsageLimitSuffix(): string {
      const snapshot = this.usageLimitSnapshotValue;

      if (!snapshot) return " · Usage unavailable";

      const limitWindow = this.selectUsageLimitWindow(snapshot);
      const observedAt = this.formatObservedAt(snapshot.observedAt);
      const reachedLabel = this.formatRateLimitReachedType(snapshot.usageLimit.rateLimitReachedType);

      if (!limitWindow) {
        const creditsLabel = this.formatCredits(snapshot.usageLimit.credits, Boolean(reachedLabel));
        const details = [reachedLabel, creditsLabel, observedAt].filter(Boolean).join(" · ");

        return `Limit usage ${details ? escapeHtml(details) : "unavailable"}`;
      }

      const remainingPercent = this.formatPercent(limitWindow.remainingPercent);
      const tokenBar = getTokenBarSegments(limitWindow.usedPercent, 12);
      const limitDoneClass = limitWindow.usedPercent >= 100 ? "status-panel__limit-done is-reached" : "status-panel__limit-done";
      const creditsLabel = this.formatCredits(snapshot.usageLimit.credits, limitWindow.usedPercent >= 100 || Boolean(reachedLabel));
      const details = [
        `${remainingPercent}% left`,
        this.formatResetTime(limitWindow.resetsAt),
        this.formatLimitWindow(limitWindow.windowMinutes),
        reachedLabel,
        creditsLabel,
        observedAt,
      ].filter(Boolean);

      return `Limit usage <span class="${limitDoneClass}">${tokenBar.done}</span><span class="status-panel__limit-rest">${tokenBar.rest}</span> ${escapeHtml(details.join(" · "))}`;
    }

    /**
     * Selects the newest snapshot's most constrained available usage window.
     */
    private selectUsageLimitWindow(snapshot: UsageLimitSnapshot): UsageLimitWindow | undefined {
      const windows = [snapshot.usageLimit.primary, snapshot.usageLimit.secondary].filter(
        (limitWindow): limitWindow is UsageLimitWindow => Boolean(limitWindow),
      );

      return windows.sort((left, right) => right.usedPercent - left.usedPercent)[0];
    }

    /**
     * Formats a Codex percentage without noisy trailing decimals.
     */
    private formatPercent(percent: number): string {
      return Number.isInteger(percent) ? String(percent) : percent.toFixed(1).replace(/\.0$/, "");
    }

    /**
     * Formats a rolling usage-limit window.
     */
    private formatLimitWindow(minutes?: number): string {
      if (!minutes) return "";

      if (minutes % 1440 === 0) return `${minutes / 1440}d window`;
      if (minutes % 60 === 0) return `${minutes / 60}h window`;

      return `${minutes}m window`;
    }

    /**
     * Formats a reset timestamp from Codex rate-limit telemetry.
     */
    private formatResetTime(resetsAt?: number): string {
      if (!resetsAt) return "";

      const diffMs = resetsAt * 1000 - Date.now();

      if (diffMs <= 0) return "reset time passed";

      const diffMinutes = Math.ceil(diffMs / 60000);

      if (diffMinutes < 60) return `resets in ${diffMinutes}m`;

      const diffHours = Math.ceil(diffMinutes / 60);

      if (diffHours < 48) return `resets in ${diffHours}h`;

      return `resets in ${Math.ceil(diffHours / 24)}d`;
    }

    /**
     * Converts backend reached types into compact user-facing labels.
     */
    private formatRateLimitReachedType(reachedType?: string | null): string {
      if (!reachedType) return "";

      if (reachedType === "workspace_member_credits_depleted") return "workspace credits depleted";

      return reachedType.replaceAll("_", " ");
    }

    /**
     * Formats available credit information when Codex exposes it.
     */
    private formatCredits(credits: UsageLimitSnapshot["usageLimit"]["credits"], showEmptyBalance: boolean): string {
      if (!credits) return "";
      if (credits.unlimited) return "credits unlimited";
      if (typeof credits.balance === "number") return `${credits.balance} credits available`;
      if (showEmptyBalance && credits.hasCredits === false) return "no extra credits";

      return "";
    }

    /**
     * Formats when the global usage snapshot was observed.
     */
    private formatObservedAt(timestamp: string): string {
      const observedAt = new Date(timestamp);

      if (Number.isNaN(observedAt.getTime())) return "";

      return `as of ${observedAt.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })}`;
    }
  }

  window.customElements.define("status-panel", StatusPanel);
}
