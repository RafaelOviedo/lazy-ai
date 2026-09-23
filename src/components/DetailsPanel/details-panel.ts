import { escapeHtml } from "../../shared/lib/html/index.js";
import { renderMarkdown } from "../../shared/lib/markdown/index.js";
import type { ConversationMessage, SessionReader, SessionSummary } from "../../entities/session/index.js";
import type { PendingSessionPrompt } from "../../features/run-session/index.js";
import type { TermWindow } from "./types.js";

/**
 * Registers the Details panel custom element against a TermDOM window.
 */
export function ensureDetailsPanelDefined(window: TermWindow): void {
  if (window.customElements.get("details-panel")) {
    return;
  }

  const thinkingSpinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const thinkingSpinnerIntervalMs = 80;

  /**
   * Renders the explicitly opened conversation.
   */
  class DetailsPanel extends window.HTMLElement {
    private viewedSessionValue: SessionSummary | null = null;
    private pendingUserPromptValue: PendingSessionPrompt | null = null;
    private pendingUserPromptInitialMatchCount = 0;
    private thinkingSessionIdValue: string | null = null;
    private interruptedSessionIdValue: string | null = null;
    private sessionReader: SessionReader | null = null;
    private messages: ConversationMessage[] = [];
    private isLoading = false;
    private loadError: string | null = null;
    private loadVersion = 0;
    private renderedMessageFingerprints = new Map<string, string>();
    private renderedSessionId: string | null = null;
    private thinkingSpinnerFrame = 0;
    private thinkingSpinnerTimer: ReturnType<typeof setInterval> | null = null;

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

      if (this.viewedSessionValue) {
        this.startConversationLoad();
      }
    }

    /**
     * Cleans up event bindings when the element leaves the document.
     */
    disconnectedCallback(): void {
      this.loadVersion += 1;
      this.removeEventListener("keydown", this.onKeyDown);
      this.stopThinkingSpinner();
    }

    /**
     * Allows the page to replace the session reader implementation if needed.
     */
    set repository(value: SessionReader) {
      this.sessionReader = value;

      if (this.isConnected && this.viewedSessionValue) {
        this.startConversationLoad();
      }
    }

    /**
     * Returns the session reader used to load selected session details.
     */
    get repository(): SessionReader | null {
      return this.sessionReader;
    }

    /**
     * Updates the opened session; same-session metadata changes preserve the transcript.
     */
    set viewedSession(value: SessionSummary | null) {
      const previousSessionId = this.viewedSessionValue?.id ?? null;
      const nextSessionId = value?.id ?? null;

      if (this.viewedSessionValue === value) return;

      this.viewedSessionValue = value;

      if (!this.isConnected) return;

      if (previousSessionId === nextSessionId) {
        this.syncTitleMarkup();
        return;
      }

      this.startConversationLoad();
    }

    /**
     * Returns the session opened in the details panel, independently of the list highlight.
     */
    get viewedSession(): SessionSummary | null {
      return this.viewedSessionValue;
    }

    /**
     * Opens a conversation, or retries a failed load without reloading a healthy view.
     */
    viewSession(session: SessionSummary): void {
      if (this.viewedSessionValue?.id === session.id && this.loadError && !this.isLoading) {
        this.viewedSessionValue = session;
        this.startConversationLoad();
        return;
      }

      this.viewedSession = session;
    }

    /**
     * Updates the pending user prompt shown before session history has caught up.
     */
    set pendingUserPrompt(value: PendingSessionPrompt | null) {
      if (
        this.pendingUserPromptValue?.sessionId === value?.sessionId
        && this.pendingUserPromptValue?.text === value?.text
        && this.pendingUserPromptValue?.submittedAt === value?.submittedAt
      ) {
        return;
      }

      this.pendingUserPromptValue = value;
      this.pendingUserPromptInitialMatchCount = value
        ? this.countMatchingUserPromptMessages(this.messages, value.text)
        : 0;

      if (this.isConnected) {
        this.syncPendingUserPromptMarkup();
      }
    }

    /**
     * Returns the pending prompt rendered optimistically in the details panel.
     */
    get pendingUserPrompt(): PendingSessionPrompt | null {
      return this.pendingUserPromptValue;
    }

    /**
     * Updates the session currently waiting for model output.
     */
    set thinkingSessionId(value: string | null) {
      if (this.thinkingSessionIdValue === value) return;

      this.thinkingSessionIdValue = value;

      if (this.isConnected) {
        this.syncThinkingMarkup();
      }
    }

    /**
     * Returns the session currently waiting for model output.
     */
    get thinkingSessionId(): string | null {
      return this.thinkingSessionIdValue;
    }

    /**
     * Updates the session currently showing an interrupted response marker.
     */
    set interruptedSessionId(value: string | null) {
      if (this.interruptedSessionIdValue === value) return;

      this.interruptedSessionIdValue = value;

      if (this.isConnected) {
        this.syncInterruptedMarkup();
      }
    }

    /**
     * Returns the session currently showing an interrupted response marker.
     */
    get interruptedSessionId(): string | null {
      return this.interruptedSessionIdValue;
    }

    /**
     * Indicates whether a conversation load is in progress.
     */
    get isConversationLoading(): boolean {
      return this.isLoading;
    }

    /**
     * Refreshes the opened transcript in place without showing the loading state.
     */
    async syncConversation(sessionId: string): Promise<void> {
      if (!this.isConnected || this.viewedSessionValue?.id !== sessionId) return;
      if (this.isLoading) return;

      const loadVersion = ++this.loadVersion;

      const sessionReader = this.sessionReader;

      if (!sessionReader) return;

      try {
        const conversation = await sessionReader.getConversation(sessionId);

        if (loadVersion !== this.loadVersion || this.viewedSessionValue?.id !== sessionId) return;

        this.messages = conversation.messages;
        this.isLoading = false;
        this.loadError = null;

        if (this.canReconcileExistingMarkup() && this.syncConversationMarkup(conversation.messages)) {
          this.scrollToBottom();
          return;
        }

        this.render();
        this.scrollToBottom();
      } catch {
        // Preserve the last transcript when a background refresh fails.
      }
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
            flex-grow: 7;
            flex-shrink: 1;
            flex-basis: 0px;
            min-width: 0;
            min-height: 0;
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
            flex: 0 0 1px;
            display: flex;
            justify-content: flex-start;
            align-items: center;
            color: #5fafff;
          }

          .details-panel__content {
            flex-grow: 1;
            flex-shrink: 1;
            flex-basis: 0px;
            min-height: 0;
            overflow: scroll;
            border-top: 1px solid #5fafff;
          }

          .details-panel__session-title {
            color: #d7ecff;
          }

          .details-panel__muted {
            color: #8aa4bf;
          }

          .details-panel__thinking {
            color: #d7ba7d;
            padding: 1px;
          }

          .details-panel__interrupted {
            color: #B81D1D;
            padding: 1px;
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

          .details-panel__message--pending {
            border-top-color: #5fafff;
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
          <span class="details-panel__title">Details ${this.viewedSessionValue?.title ? `- ${this.viewedSessionValue.title}` : ''}</span>
        </div>
        <div class="details-panel__content">
          ${this.renderContentMarkup()}
        </div>
      `;

      this.renderedSessionId = this.viewedSessionValue?.id ?? null;
      this.syncRenderedMessageFingerprints();
      this.syncThinkingSpinnerAnimation();
    }

    /**
     * Builds the markup for empty and opened conversation states.
     */
    private renderContentMarkup(): string {
      if (!this.viewedSessionValue) {
        return `
          <div style="padding-left: 1ch;">No conversation opened yet.</div>
          <div class="details-panel__muted" style="margin-top: 0.5rem; padding-left: 1ch;">Press w on a session to view its conversation.</div>
        `;
      }

      if (this.isLoading) {
        return `
          <div class="details-panel__muted" style="width: 65%; margin-top: 0.5rem; padding-left: 1ch;">Loading conversation...</div>
        `;
      }

      if (this.loadError) {
        return `
          <div class="details-panel__session-title">${escapeHtml(this.viewedSessionValue.title)}</div>
          <div style="margin-top: 0.5rem;">${escapeHtml(this.loadError)}</div>
        `;
      }

      if (this.messages.length === 0) {
        return `
          <div class="details-panel__session-title">${escapeHtml(this.viewedSessionValue.title)}</div>
          ${this.isViewedSessionPendingPrompt() || this.isViewedSessionThinking() || this.isViewedSessionInterrupted()
            ? ""
            : `<div class="details-panel__muted" data-empty-conversation="true" style="margin-top: 0.5rem;">No conversation messages found for this session.</div>`}
          <div data-conversation-messages="true">
            ${this.isViewedSessionPendingPrompt() ? this.renderPendingUserPromptMarkup() : ""}
            ${this.isViewedSessionThinking() ? this.renderThinkingMarkup() : ""}
            ${this.isViewedSessionInterrupted() ? this.renderInterruptedMarkup() : ""}
          </div>
        `;
      }

      return `
        <div class="details-panel__session-title">${escapeHtml(this.viewedSessionValue.title)}</div>
        <div data-conversation-messages="true">
          ${this.messages.map((message) => this.renderMessageMarkup(message)).join("")}
          ${this.isViewedSessionPendingPrompt() ? this.renderPendingUserPromptMarkup() : ""}
          ${this.isViewedSessionThinking() ? this.renderThinkingMarkup() : ""}
          ${this.isViewedSessionInterrupted() ? this.renderInterruptedMarkup() : ""}
        </div>
      `;
    }

    /**
     * Returns whether the opened session is awaiting its first response.
     */
    private isViewedSessionThinking(): boolean {
      return this.viewedSessionValue?.id === this.thinkingSessionIdValue;
    }

    /**
     * Returns whether the opened session recently had its response interrupted.
     */
    private isViewedSessionInterrupted(): boolean {
      return this.viewedSessionValue?.id === this.interruptedSessionIdValue && !this.isViewedSessionThinking();
    }

    /**
     * Returns whether the opened session has a prompt waiting for persistence.
     */
    private isViewedSessionPendingPrompt(): boolean {
      return this.viewedSessionValue?.id === this.pendingUserPromptValue?.sessionId;
    }

    /**
     * Builds the optimistic user prompt row.
     */
    private renderPendingUserPromptMarkup(): string {
      if (!this.pendingUserPromptValue) return "";

      return `
        <div class="details-panel__message details-panel__message--pending" data-pending-user-prompt="true">
          <div class="details-panel__message-header">
            <span class="details-panel__message-role details-panel__message-role--user">You</span>
          </div>
          <div class="details-panel__message-text">${escapeHtml(this.pendingUserPromptValue.text)}</div>
        </div>
      `;
    }

    /**
     * Builds the pending assistant response row.
     */
    private renderThinkingMarkup(): string {
      return `<div class="details-panel__thinking" data-thinking-row="true"><span data-thinking-spinner="true">${escapeHtml(this.getThinkingSpinnerFrame())}</span> Thinking...</div>`;
    }

    /**
     * Builds the interrupted assistant response row.
     */
    private renderInterruptedMarkup(): string {
      return `<div class="details-panel__interrupted" data-interrupted-row="true">Interrupted</div>`;
    }

    /**
     * Shows the loading state and immediately loads the explicitly opened conversation.
     */
    private startConversationLoad(): void {
      const viewedSession = this.viewedSessionValue;
      const loadVersion = ++this.loadVersion;

      this.loadError = null;

      if (!viewedSession) {
        this.messages = [];
        this.isLoading = false;
        this.renderedMessageFingerprints.clear();
        this.renderedSessionId = null;
        this.render();
        return;
      }

      this.messages = [];
      this.renderedMessageFingerprints.clear();
      this.isLoading = true;
      this.render();
      void this.loadConversation(viewedSession, loadVersion);
    }

    /**
     * Loads the opened session transcript.
     */
    private async loadConversation(
      viewedSession: SessionSummary,
      loadVersion: number,
    ): Promise<void> {
      if (loadVersion !== this.loadVersion) return;

      const sessionReader = this.sessionReader;

      if (!sessionReader) return;

      try {
        const conversation = await sessionReader.getConversation(viewedSession.id);

        if (loadVersion !== this.loadVersion) return;

        this.messages = conversation.messages;
        this.isLoading = false;
        this.loadError = null;

        this.render();
        this.scrollToBottom();
      } catch {
        if (loadVersion !== this.loadVersion) return;

        this.messages = [];
        this.isLoading = false;
        this.loadError = "Failed to load the conversation. Press w on this session to retry.";
        this.render();
      }
    }

    /**
     * Builds one transcript row.
     */
    private renderMessageMarkup(message: ConversationMessage): string {
      return `
        <div class="details-panel__message" data-conversation-message="true" data-message-id="${escapeHtml(message.id)}">
          ${this.renderMessageInnerMarkup(message)}
        </div>
      `;
    }

    /**
     * Builds the content inside one transcript row.
     */
    private renderMessageInnerMarkup(message: ConversationMessage): string {
      const roleLabel = this.formatRoleLabel(message.role);
      const timestamp = this.formatTimestamp(message.timestamp);

      return `
        <div class="details-panel__message-header">
          <span class="details-panel__message-role details-panel__message-role--${message.role}">${roleLabel}</span>${timestamp ? ` · ${escapeHtml(timestamp)}` : ""}
        </div>
        <div class="details-panel__message-text">${this.renderMessageTextMarkup(message)}</div>
      `;
    }

    /**
     * Updates the details title without rebuilding the transcript.
     */
    private syncTitleMarkup(): void {
      const title = this.querySelector<HTMLElement>(".details-panel__title");
      const sessionTitle = this.querySelector<HTMLElement>(".details-panel__session-title");

      if (title) {
        title.textContent = this.viewedSessionValue?.title ? `Details - ${this.viewedSessionValue.title}` : "Details";
      }

      if (sessionTitle && this.viewedSessionValue) {
        sessionTitle.textContent = this.viewedSessionValue.title;
      }
    }

    /**
     * Appends or updates rendered message rows for a same-session refresh.
     */
    private syncConversationMarkup(messages: ConversationMessage[]): boolean {
      if (!this.viewedSessionValue || this.renderedSessionId !== this.viewedSessionValue.id) return false;

      const messagesContainer = this.getMessagesContainer();

      if (!messagesContainer) return false;

      this.syncTitleMarkup();
      this.removeThinkingMarkup();
      this.removePendingUserPromptMarkup();
      this.removeInterruptedMarkup();

      if (this.shouldClearPendingUserPrompt(messages)) {
        this.pendingUserPromptValue = null;
      }

      for (const message of messages) {
        const fingerprint = this.getMessageFingerprint(message);
        const existingMessage = this.getMessageElement(message.id);

        if (existingMessage) {
          if (this.renderedMessageFingerprints.get(message.id) !== fingerprint) {
            existingMessage.innerHTML = this.renderMessageInnerMarkup(message);
          }
        } else {
          messagesContainer.insertAdjacentHTML("beforeend", this.renderMessageMarkup(message));
        }

        this.renderedMessageFingerprints.set(message.id, fingerprint);
      }

      if (messages.length > 0 || this.isViewedSessionPendingPrompt() || this.isViewedSessionThinking()) {
        this.removeEmptyConversationMarkup();
      }

      this.syncPendingUserPromptMarkup();
      this.syncThinkingMarkup();
      this.syncInterruptedMarkup();
      return true;
    }

    /**
     * Adds or removes the pending user prompt row in place.
     */
    private syncPendingUserPromptMarkup(): void {
      if (!this.viewedSessionValue || this.isLoading || this.loadError) {
        this.removePendingUserPromptMarkup();
        return;
      }

      const messagesContainer = this.getMessagesContainer();

      if (!messagesContainer) {
        this.render();
        return;
      }

      const existingPendingPrompt = this.getPendingUserPromptElement();

      if (!this.isViewedSessionPendingPrompt()) {
        this.removePendingUserPromptMarkup();

        if (this.messages.length === 0 && !this.isViewedSessionThinking() && !this.isViewedSessionInterrupted()) {
          this.showEmptyConversationMarkup();
        }

        return;
      }

      if (this.shouldClearPendingUserPrompt(this.messages)) {
        this.pendingUserPromptValue = null;
        this.removePendingUserPromptMarkup();
        return;
      }

      this.removeEmptyConversationMarkup();

      if (!existingPendingPrompt) {
        const thinkingElement = this.getThinkingElement();

        if (thinkingElement) {
          thinkingElement.insertAdjacentHTML("beforebegin", this.renderPendingUserPromptMarkup());
        } else {
          messagesContainer.insertAdjacentHTML("beforeend", this.renderPendingUserPromptMarkup());
        }

        this.scrollToBottom();
      }
    }

    /**
     * Adds or removes the pending assistant row in place.
     */
    private syncThinkingMarkup(): void {
      if (!this.viewedSessionValue || this.isLoading || this.loadError) {
        this.removeThinkingMarkup();
        this.syncThinkingSpinnerAnimation();
        return;
      }

      const messagesContainer = this.getMessagesContainer();

      if (!messagesContainer) {
        this.render();
        return;
      }

      const existingThinkingRow = this.getThinkingElement();

      if (!this.isViewedSessionThinking()) {
        if (existingThinkingRow) {
          this.removeThinkingMarkup();

          if (this.messages.length === 0 && !this.isViewedSessionPendingPrompt() && !this.isViewedSessionInterrupted()) {
            this.showEmptyConversationMarkup();
          }
        }

        this.syncThinkingSpinnerAnimation();
        return;
      }

      this.removeEmptyConversationMarkup();

      if (!existingThinkingRow) {
        messagesContainer.insertAdjacentHTML("beforeend", this.renderThinkingMarkup());
        this.scrollToBottom();
      }

      this.syncThinkingSpinnerAnimation();
    }

    /**
     * Adds or removes the interrupted assistant row in place.
     */
    private syncInterruptedMarkup(): void {
      if (!this.viewedSessionValue || this.isLoading || this.loadError) {
        this.removeInterruptedMarkup();
        return;
      }

      const messagesContainer = this.getMessagesContainer();

      if (!messagesContainer) {
        this.render();
        return;
      }

      const existingInterruptedRow = this.getInterruptedElement();

      if (!this.isViewedSessionInterrupted()) {
        if (existingInterruptedRow) {
          this.removeInterruptedMarkup();

          if (this.messages.length === 0 && !this.isViewedSessionPendingPrompt() && !this.isViewedSessionThinking()) {
            this.showEmptyConversationMarkup();
          }
        }

        return;
      }

      this.removeEmptyConversationMarkup();

      if (!existingInterruptedRow) {
        messagesContainer.insertAdjacentHTML("beforeend", this.renderInterruptedMarkup());
        this.scrollToBottom();
      }
    }

    /**
     * Starts or stops the spinner loop based on the rendered thinking row.
     */
    private syncThinkingSpinnerAnimation(): void {
      if (!this.isConnected || !this.querySelector("[data-thinking-spinner='true']")) {
        this.stopThinkingSpinner();
        return;
      }

      if (this.thinkingSpinnerTimer) return;

      this.updateThinkingSpinnerMarkup();
      this.thinkingSpinnerTimer = setInterval(() => this.updateThinkingSpinnerMarkup(), thinkingSpinnerIntervalMs);
    }

    /**
     * Advances rendered thinking spinner frames.
     */
    private updateThinkingSpinnerMarkup(): void {
      const spinners = this.querySelectorAll<HTMLElement>("[data-thinking-spinner='true']");

      if (spinners.length === 0) {
        this.stopThinkingSpinner();
        return;
      }

      const spinnerFrame = thinkingSpinnerFrames[this.thinkingSpinnerFrame % thinkingSpinnerFrames.length];

      spinners.forEach((spinner) => {
        spinner.textContent = spinnerFrame;
      });
      this.thinkingSpinnerFrame += 1;
    }

    /**
     * Stops the thinking spinner loop.
     */
    private stopThinkingSpinner(): void {
      if (!this.thinkingSpinnerTimer) return;

      clearInterval(this.thinkingSpinnerTimer);
      this.thinkingSpinnerTimer = null;
    }

    /**
     * Returns the current spinner frame without advancing the animation.
     */
    private getThinkingSpinnerFrame(): string {
      return thinkingSpinnerFrames[this.thinkingSpinnerFrame % thinkingSpinnerFrames.length];
    }

    /**
     * Returns whether the current DOM can be reconciled for the opened session.
     */
    private canReconcileExistingMarkup(): boolean {
      return Boolean(
        this.viewedSessionValue
        && this.renderedSessionId === this.viewedSessionValue.id
        && this.getMessagesContainer(),
      );
    }

    /**
     * Tracks which message rows are currently rendered.
     */
    private syncRenderedMessageFingerprints(): void {
      this.renderedMessageFingerprints.clear();

      for (const message of this.messages) {
        this.renderedMessageFingerprints.set(message.id, this.getMessageFingerprint(message));
      }
    }

    /**
     * Builds a compact value for detecting same-id message edits.
     */
    private getMessageFingerprint(message: ConversationMessage): string {
      return `${message.role}\n${message.timestamp ?? ""}\n${message.text}`;
    }

    /**
     * Finds the transcript container used for incremental message updates.
     */
    private getMessagesContainer(): HTMLElement | null {
      return this.querySelector<HTMLElement>("[data-conversation-messages='true']");
    }

    /**
     * Finds one rendered message row by message id.
     */
    private getMessageElement(messageId: string): HTMLElement | null {
      const renderedMessages = this.querySelectorAll<HTMLElement>("[data-conversation-message='true']");

      for (const renderedMessage of renderedMessages) {
        if (renderedMessage.getAttribute("data-message-id") === messageId) {
          return renderedMessage;
        }
      }

      return null;
    }

    /**
     * Finds the pending assistant row.
     */
    private getThinkingElement(): HTMLElement | null {
      return this.querySelector<HTMLElement>("[data-thinking-row='true']");
    }

    /**
     * Finds the interrupted assistant row.
     */
    private getInterruptedElement(): HTMLElement | null {
      return this.querySelector<HTMLElement>("[data-interrupted-row='true']");
    }

    /**
     * Finds the optimistic user prompt row.
     */
    private getPendingUserPromptElement(): HTMLElement | null {
      return this.querySelector<HTMLElement>("[data-pending-user-prompt='true']");
    }

    /**
     * Removes the pending assistant row when it is present.
     */
    private removeThinkingMarkup(): void {
      const thinkingElement = this.getThinkingElement();

      if (thinkingElement?.parentNode) {
        thinkingElement.parentNode.removeChild(thinkingElement);
      }

      this.syncThinkingSpinnerAnimation();
    }

    /**
     * Removes the interrupted assistant row when it is present.
     */
    private removeInterruptedMarkup(): void {
      const interruptedElement = this.getInterruptedElement();

      if (interruptedElement?.parentNode) {
        interruptedElement.parentNode.removeChild(interruptedElement);
      }
    }

    /**
     * Removes the optimistic user prompt row when it is present.
     */
    private removePendingUserPromptMarkup(): void {
      const pendingPromptElement = this.getPendingUserPromptElement();

      if (pendingPromptElement?.parentNode) {
        pendingPromptElement.parentNode.removeChild(pendingPromptElement);
      }
    }

    /**
     * Detects when the persisted transcript has caught up with the optimistic row.
     */
    private shouldClearPendingUserPrompt(messages: ConversationMessage[]): boolean {
      const pendingUserPrompt = this.pendingUserPromptValue;

      if (!pendingUserPrompt) return false;

      const matchingMessages = messages.filter((message) => {
        return message.role === "user" && message.text.trim() === pendingUserPrompt.text;
      });

      const submittedAt = new Date(pendingUserPrompt.submittedAt).getTime();

      if (!Number.isNaN(submittedAt)) {
        const hasNewerMatch = matchingMessages.some((message) => {
          if (!message.timestamp) return false;

          const messageTimestamp = new Date(message.timestamp).getTime();

          return !Number.isNaN(messageTimestamp) && messageTimestamp >= submittedAt - 5000;
        });

        if (hasNewerMatch) return true;
      }

      return matchingMessages.length > this.pendingUserPromptInitialMatchCount;
    }

    /**
     * Counts persisted user messages with the same text as the optimistic prompt.
     */
    private countMatchingUserPromptMessages(messages: ConversationMessage[], promptText: string): number {
      return messages.filter((message) => {
        return message.role === "user" && message.text.trim() === promptText;
      }).length;
    }

    /**
     * Removes the empty transcript placeholder.
     */
    private removeEmptyConversationMarkup(): void {
      const emptyElement = this.querySelector<HTMLElement>("[data-empty-conversation='true']");

      if (emptyElement?.parentNode) {
        emptyElement.parentNode.removeChild(emptyElement);
      }
    }

    /**
     * Restores the empty transcript placeholder after the thinking row clears.
     */
    private showEmptyConversationMarkup(): void {
      const content = this.querySelector<HTMLElement>(".details-panel__content");

      if (!content || this.querySelector("[data-empty-conversation='true']")) return;

      const messagesContainer = this.getMessagesContainer();

      if (!messagesContainer) return;

      messagesContainer.insertAdjacentHTML(
        "beforebegin",
        `<div class="details-panel__muted" data-empty-conversation="true" style="margin-top: 0.5rem;">No conversation messages found for this session.</div>`,
      );
    }

    /**
     * Renders user text plainly and assistant output as terminal-friendly Markdown.
     */
    private renderMessageTextMarkup(message: ConversationMessage): string {
      if (message.role === "assistant") {
        return renderMarkdown(message.text);
      }

      return escapeHtml(message.text);
    }

    /**
     * Formats a role for display in the transcript.
     */
    private formatRoleLabel(role: ConversationMessage["role"]): string {
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
      const pendingUserPrompt = this.getPendingUserPromptElement();
      const thinkingElement = this.getThinkingElement();
      const interruptedElement = this.getInterruptedElement();
      const content = this.querySelector<HTMLElement>(".details-panel__content");

      if (thinkingElement) {
        thinkingElement.scrollIntoView({ block: "end" });
        return;
      }

      if (interruptedElement) {
        interruptedElement.scrollIntoView({ block: "end" });
        return;
      }

      if (pendingUserPrompt) {
        pendingUserPrompt.scrollIntoView({ block: "end" });
        return;
      }

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
