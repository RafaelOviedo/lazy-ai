import { escapeHtml } from "../../shared/lib/html/index.js";
import { renderMarkdown } from "../../shared/lib/markdown/index.js";
import { CodexSessionRepository } from "../../repositories/sessions/codex/index.js";

import type { CodexConversationMessage, CodexSessionReader, CodexSessionSummary } from "../../repositories/sessions/codex/types.js";
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
    private sessionReader: CodexSessionReader = new CodexSessionRepository();
    private messages: CodexConversationMessage[] = [];
    private isLoading = false;
    private loadError: string | null = null;
    private loadVersion = 0;

    constructor() {
      super();
      this.onKeyDown = this.onKeyDown.bind(this);
    }

    /**
     * Initializes the panel markup when the element is attached.
     */
    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.render();
      this.addEventListener("keydown", this.onKeyDown);

      if (this.selectedSessionValue) {
        void this.loadConversation();
      }
    }

    /**
     * Cleans up event bindings when the element leaves the document.
     */
    disconnectedCallback(): void {
      this.removeEventListener("keydown", this.onKeyDown);
    }

    /**
     * Allows the page to replace the session reader implementation if needed.
     */
    set repository(value: CodexSessionReader) {
      this.sessionReader = value;

      if (this.isConnected && this.selectedSessionValue) {
        void this.loadConversation();
      }
    }

    /**
     * Returns the session reader used to load selected session details.
     */
    get repository(): CodexSessionReader {
      return this.sessionReader;
    }

    /**
     * Updates the selected session shown in the details panel.
     */
    set selectedSession(value: CodexSessionSummary | null) {
      if (this.selectedSessionValue === value) return;

      this.selectedSessionValue = value;

      if (this.isConnected) {
        void this.loadConversation();
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
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            width: 67%;
            height: 82%;
            border: 1px solid #5fafff;
            border-radius: 5px;
            box-sizing: border-box;
            overflow: hidden;
          }

          details-panel:focus {
            border-color: #fff;
            outline: none;
          }

          details-panel:focus .details-panel__title {
            color: #fff;
          }

          .details-panel__title {
            width: 65%;
            height: 3%;
            display: flex;
            justify-content: flex-start;
            align-items: center;
            color: #5fafff;
          }

          .details-panel__content {
            width: 66%;
            height: 75%;
            overflow: scroll;
            border-top: 1px solid #5fafff;
          }

          .details-panel__session-title {
            color: #d7ecff;
          }

          .details-panel__muted {
            color: #8aa4bf;
          }

          .details-panel__message {
            border-top: 1px solid #595959;
            padding: 1px;
            margin: 0;
          }

          .details-panel__message-header {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            color: #8aa4bf;
          }

          .details-panel__message-role {
            margin-bottom: 1px;
            font-weight: bold;
          }

          .details-panel__message-role--user {
            color: #5fafff;
          }

          .details-panel__message-role--assistant {
            color: #43B53E;
          }

          .details-panel__message-text {
            color: #d7ecff;
          }

          .details-markdown__heading {
            color: #ffffff;
            font-weight: bold;
          }

          .details-markdown__heading--1,
          .details-markdown__heading--2 {
            color: #5fafff;
          }

          .details-markdown__paragraph {
            margin-bottom: 1px;
          }

          .details-markdown__list {
            margin-bottom: 1px;
          }

          .details-markdown__list-item {
            display: flex;
            justify-content: flex-start;
            align-items: flex-start;
          }

          .details-markdown__list-marker {
            color: #8aa4bf;
            width: 3ch;
          }

          .details-markdown__list-text {
            color: #d7ecff;
          }

          .details-markdown__inline-code {
            color: #d7ba7d;
          }

          .details-markdown__code-block {
            border-left: 1px solid #5fafff;
            margin-bottom: 1px;
            padding-left: 1ch;
          }

          .details-markdown__code-language {
            color: #8aa4bf;
          }

          .details-markdown__code {
            color: #d7ba7d;
            white-space: pre-wrap;
          }

          .details-markdown__quote {
            border-left: 1px solid #8aa4bf;
            color: #8aa4bf;
            padding-left: 1ch;
          }

          .details-markdown__strong {
            color: #ffffff;
            font-weight: bold;
          }

          .details-markdown__em {
            color: #d7ecff;
            font-style: italic;
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
          <div style="padding-left: 1ch;">No session selected yet.</div>
          <div class="details-panel__muted" style="margin-top: 0.5rem; padding-left: 1ch;">Select a saved session to inspect its conversation.</div>
        `;
      }

      if (this.isLoading) {
        return `
          <div class="details-panel__muted" style="width: 65%; margin-top: 0.5rem; padding-left: 1ch;">Loading conversation...</div>
        `;
      }

      if (this.loadError) {
        return `
          <div class="details-panel__session-title">${escapeHtml(this.selectedSessionValue.title)}</div>
          <div style="margin-top: 0.5rem;">${escapeHtml(this.loadError)}</div>
        `;
      }

      if (this.messages.length === 0) {
        return `
          <div class="details-panel__session-title">${escapeHtml(this.selectedSessionValue.title)}</div>
          <div class="details-panel__muted" style="margin-top: 0.5rem;">No conversation messages found for this session.</div>
        `;
      }

      return `
        <div class="details-panel__session-title">${escapeHtml(this.selectedSessionValue.title)}</div>
        <div>
          ${this.messages.map((message) => this.renderMessageMarkup(message)).join("")}
        </div>
      `;
    }

    /**
     * Loads the selected session transcript.
     */
    private async loadConversation(): Promise<void> {
      const selectedSession = this.selectedSessionValue;
      const loadVersion = ++this.loadVersion;

      this.messages = [];
      this.loadError = null;

      if (!selectedSession) {
        this.isLoading = false;
        this.render();
        return;
      }

      this.isLoading = true;
      this.render();

      try {
        const conversation = await this.sessionReader.getConversation(selectedSession.id);

        if (loadVersion !== this.loadVersion) return;

        this.messages = conversation.messages;
        this.isLoading = false;
        this.render();
        this.scrollToBottom();
      } catch {
        if (loadVersion !== this.loadVersion) return;

        this.messages = [];
        this.isLoading = false;
        this.loadError = "Failed to load the selected session conversation.";
        this.render();
      }
    }

    /**
     * Builds one transcript row.
     */
    private renderMessageMarkup(message: CodexConversationMessage): string {
      const roleLabel = this.formatRoleLabel(message.role);
      const timestamp = this.formatTimestamp(message.timestamp);

      return `
        <div class="details-panel__message" data-conversation-message="true">
          <div class="details-panel__message-header">
            <span class="details-panel__message-role details-panel__message-role--${message.role}">${roleLabel}</span>${timestamp ? ` · ${escapeHtml(timestamp)}` : ""}
          </div>
          <div class="details-panel__message-text">${this.renderMessageTextMarkup(message)}</div>
        </div>
      `;
    }

    /**
     * Renders user text plainly and assistant output as terminal-friendly Markdown.
     */
    private renderMessageTextMarkup(message: CodexConversationMessage): string {
      if (message.role === "assistant") {
        return renderMarkdown(message.text);
      }

      return escapeHtml(message.text);
    }

    /**
     * Formats a role for display in the transcript.
     */
    private formatRoleLabel(role: CodexConversationMessage["role"]): string {
      if (role === "user") return "You";

      return "Assistant";
    }

    /**
     * Formats timestamps compactly for terminal display.
     */
    private formatTimestamp(timestamp?: string): string {
      if (!timestamp) return "";

      const date = new Date(timestamp);

      if (Number.isNaN(date.getTime())) return "";

      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    /**
     * Keeps the latest message visible when a conversation is loaded.
     */
    private scrollToBottom(): void {
      const lastMessage = [...this.querySelectorAll<HTMLElement>("[data-conversation-message='true']")].at(-1);
      const content = this.querySelector<HTMLElement>(".details-panel__content");

      if (lastMessage) {
        lastMessage.scrollIntoView({ block: "end" });
        return;
      }

      if (content) {
        content.scrollTop = content.scrollHeight;
      }
    }

    /**
     * Supports keyboard scrolling when the details panel is focused.
     */
    private onKeyDown(event: KeyboardEvent): void {
      const content = this.querySelector<HTMLElement>(".details-panel__content");

      if (!content) return;

      const key = event.key.toLowerCase();

      if (key === "j" || key === "arrowdown") {
        content.scrollTop += 4;
        event.preventDefault();
        return;
      }

      if (key === "k" || key === "arrowup") {
        content.scrollTop -= 4;
        event.preventDefault();
        return;
      }

      if (key === "pagedown") {
        content.scrollTop += 20;
        event.preventDefault();
        return;
      }

      if (key === "pageup") {
        content.scrollTop -= 20;
        event.preventDefault();
        return;
      }

      if (key === "end") {
        content.scrollTop = content.scrollHeight;
        event.preventDefault();
        return;
      }

      if (key === "home") {
        content.scrollTop = 0;
        event.preventDefault();
      }
    }
  }

  window.customElements.define("details-panel", DetailsPanel);
}
