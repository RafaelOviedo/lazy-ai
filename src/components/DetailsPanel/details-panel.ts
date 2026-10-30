import { escapeHtml, renderWithStableStyle } from "../../shared/lib/html/index.js";
import { renderMarkdown } from "../../shared/lib/markdown/index.js";
import type { ConversationMessage, SessionReader, SessionSummary } from "../../entities/session/index.js";
import type { LiveConversationEvent } from "../../entities/provider/index.js";
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
  // Every screen change re-lays out the whole transcript, so animation and
  // stream updates are paced to leave the event loop room for key handling.
  const thinkingSpinnerIntervalMs = 100;
  const defaultThinkingLabel = "Thinking...";
  const liveStreamRefreshIntervalMs = 200;
  // TermDOM restyles a parent's whole subtree when a child is added or removed.
  // Rows therefore go into small groups, each nested as the last child of the
  // one before, so appending only ever touches the short tail group.
  const messageGroupSize = 25;

  /**
   * Renders the explicitly opened conversation.
   */
  class DetailsPanel extends window.HTMLElement {
    private viewedSessionValue: SessionSummary | null = null;
    private pendingUserPromptValue: PendingSessionPrompt | null = null;
    private pendingUserPromptInitialMatchCount = 0;
    /** The last optimistic prompt row the transcript took over, never shown again. */
    private retiredUserPromptId: string | null = null;
    private thinkingSessionIdValue: string | null = null;
    private thinkingLabelValue = defaultThinkingLabel;
    private interruptedSessionIdValue: string | null = null;
    private sessionReader: SessionReader | null = null;
    private messages: ConversationMessage[] = [];
    /** Last transcript read; `messages` is this plus whatever is still only live. */
    private transcriptMessages: ConversationMessage[] = [];
    private liveMessages: ConversationMessage[] = [];
    private liveStreamText = "";
    private liveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
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
      this.cancelLiveRefresh();
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

      // The page re-reports the prompt for the rest of the turn, long after the
      // transcript has taken it over; re-adding the stand-in row then would
      // show the prompt twice.
      if (value && this.getPendingUserPromptMessageId(value) === this.retiredUserPromptId) return;

      this.pendingUserPromptValue = value;
      // Counted against the transcript alone: the merged list carries the
      // optimistic row itself, which would otherwise look like a match.
      this.pendingUserPromptInitialMatchCount = value
        ? this.countMatchingUserPromptMessages(this.transcriptMessages, value.text)
        : 0;

      if (this.isConnected) {
        this.refreshLive();
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
     * Names what the opened session is doing, shown beside the spinner. A turn
     * can settle while sub-agents or shells it started keep running, so this
     * says which of those is happening rather than always claiming "Thinking".
     */
    set thinkingLabel(value: string) {
      const label = value.trim() || defaultThinkingLabel;

      if (this.thinkingLabelValue === label) return;

      this.thinkingLabelValue = label;

      if (this.isConnected) {
        this.syncThinkingLabelMarkup();
      }
    }

    get thinkingLabel(): string {
      return this.thinkingLabelValue;
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

        // Polls mostly find nothing new. Touching the rows or scrolling would
        // still make the terminal re-lay out the whole transcript, which starves
        // the spinner and key handling on long sessions.
        if (!this.loadError && this.renderedSessionId === sessionId && this.isSameTranscript(conversation.messages)) return;

        this.transcriptMessages = conversation.messages;
        this.updateMessages();
        this.isLoading = false;
        this.loadError = null;

        if (this.canReconcileExistingMarkup() && this.syncConversationMarkup()) {
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
     * Shows assistant output the provider has produced but not yet persisted.
     */
    applyLiveEvent(event: LiveConversationEvent): void {
      if (this.viewedSessionValue?.id !== event.sessionId) return;

      if (event.type === "stream") {
        this.liveStreamText = event.text;
      } else {
        this.liveStreamText = "";

        if (event.message && !this.liveMessages.some((message) => message.id === event.message!.id)) {
          this.liveMessages.push(event.message);
        }
      }

      // A finished message is rare and should land at once; deltas are coalesced.
      if (event.type === "message") {
        this.refreshLive();
      } else {
        this.scheduleLiveRefresh();
      }
    }

    /**
     * Drops live rows once the turn is over, leaving the transcript as the only source.
     */
    settleLiveEvents(sessionId: string): void {
      if (this.viewedSessionValue?.id !== sessionId) return;
      if (!this.liveMessages.length && !this.liveStreamText) return;

      this.resetLiveState();
      this.refreshLive();
    }

    private resetLiveState(): void {
      this.cancelLiveRefresh();
      this.liveMessages = [];
      this.liveStreamText = "";
    }

    private cancelLiveRefresh(): void {
      if (!this.liveRefreshTimer) return;

      clearTimeout(this.liveRefreshTimer);
      this.liveRefreshTimer = null;
    }

    private scheduleLiveRefresh(): void {
      if (this.liveRefreshTimer) return;

      this.liveRefreshTimer = setTimeout(() => {
        this.liveRefreshTimer = null;
        this.refreshLiveStream();
      }, liveStreamRefreshIntervalMs);
    }

    /**
     * Applies streamed text by rewriting only the streaming row. Everything else
     * that changes rows goes through `refreshLive` or a transcript sync, so the
     * other rows are already current.
     */
    private refreshLiveStream(): void {
      const viewedSessionId = this.viewedSessionValue?.id;
      const canPatch = viewedSessionId && this.liveStreamText && !this.isLoading && !this.loadError
        && this.isConnected && this.canReconcileExistingMarkup();
      const streamId = viewedSessionId ? this.getLiveStreamMessageId(viewedSessionId) : "";
      const streamElement = canPatch ? this.getMessageElementsById().get(streamId) : undefined;

      // The first delta has no row yet, and an empty stream means the row goes away.
      if (!streamElement) {
        this.refreshLive();
        return;
      }

      const pendingUserPrompt = this.pendingUserPromptValue;

      this.updateMessages();

      // Retiring the optimistic row moves rows around, which this patch cannot do.
      if (this.pendingUserPromptValue !== pendingUserPrompt) {
        this.refreshLive();
        return;
      }

      const streamMessage = this.messages.find((message) => message.id === streamId);

      if (!streamMessage) return;

      const fingerprint = this.getMessageFingerprint(streamMessage);

      if (this.renderedMessageFingerprints.get(streamId) === fingerprint) return;

      streamElement.innerHTML = this.renderMessageInnerMarkup(streamMessage);
      this.renderedMessageFingerprints.set(streamId, fingerprint);
      this.scrollToBottom();
    }

    private getLiveStreamMessageId(sessionId: string): string {
      return `live-stream:${sessionId}`;
    }

    /**
     * Appends the transcript with anything still only live, skipping rows the
     * transcript has caught up on.
     */
    private mergeLiveMessages(): ConversationMessage[] {
      const transcriptIds = new Set(this.transcriptMessages.map((message) => message.id));
      const merged: ConversationMessage[] = [...this.transcriptMessages];
      const pendingUserPromptMessage = this.getPendingUserPromptMessage();

      // The optimistic prompt row belongs to the turn it started: below
      // everything already persisted, and above the reply streaming back. Left
      // trailing the list, it read as the newest message of the conversation.
      if (pendingUserPromptMessage) {
        merged.push(pendingUserPromptMessage);
      }

      merged.push(...this.liveMessages.filter((message) => !transcriptIds.has(message.id)));

      if (this.liveStreamText && this.viewedSessionValue) {
        merged.push({ id: this.getLiveStreamMessageId(this.viewedSessionValue.id), role: "assistant", text: this.liveStreamText });
      }

      return merged;
    }

    /**
     * Rebuilds the rows on screen, retiring the optimistic prompt row once the
     * transcript has caught up with it.
     */
    private updateMessages(): void {
      if (this.pendingUserPromptValue && this.shouldClearPendingUserPrompt(this.transcriptMessages)) {
        this.retiredUserPromptId = this.getPendingUserPromptMessageId(this.pendingUserPromptValue);
        this.pendingUserPromptValue = null;
      }

      this.messages = this.mergeLiveMessages();
    }

    /**
     * Builds the stand-in row for a prompt the transcript has not recorded yet.
     */
    private getPendingUserPromptMessage(): ConversationMessage | null {
      const pendingUserPrompt = this.pendingUserPromptValue;

      if (!pendingUserPrompt || !this.isViewedSessionPendingPrompt()) return null;

      return {
        id: this.getPendingUserPromptMessageId(pendingUserPrompt),
        role: "user",
        text: pendingUserPrompt.text,
      };
    }

    /** Keyed by submission, so a new prompt never reuses the previous row. */
    private getPendingUserPromptMessageId(pendingUserPrompt: PendingSessionPrompt): string {
      return `pending-prompt:${pendingUserPrompt.sessionId}:${pendingUserPrompt.submittedAt}`;
    }

    /**
     * Returns whether a row stands in for the prompt awaiting persistence.
     */
    private isPendingUserPromptMessage(message: ConversationMessage): boolean {
      return Boolean(
        this.pendingUserPromptValue
        && message.id === this.getPendingUserPromptMessageId(this.pendingUserPromptValue),
      );
    }

    private refreshLive(): void {
      this.cancelLiveRefresh();

      // A pending load or error view owns the screen; the next load merges live rows itself.
      if (!this.isConnected || this.isLoading || this.loadError || !this.viewedSessionValue) return;

      this.updateMessages();

      if (this.canReconcileExistingMarkup() && this.syncConversationMarkup()) {
        this.scrollToBottom();
        return;
      }

      this.render();
      this.scrollToBottom();
    }

    /**
     * Re-renders the light DOM for the panel.
     */
    private render(): void {
      renderWithStableStyle(this, `
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

          /*
           * The thinking row is pinned here instead of trailing the scrolling
           * transcript, where reading earlier output scrolls it out of sight.
           * The strip has no border so it reads as part of the panel, and it
           * keeps its row while idle so starting a turn never reflows the
           * transcript beside it.
           */
          .details-panel__status-bar {
            flex: 0 0 1px;
            overflow: hidden;
          }

          .details-panel__session-title {
            color: #d7ecff;
          }

          .details-panel__muted {
            color: #8aa4bf;
          }

          .details-panel__thinking {
            color: #d7ba7d;
            padding: 0 1px;
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
        <div class="details-panel__status-bar" data-status-bar="true">${
          this.isViewedSessionThinking() ? this.renderThinkingMarkup() : ""
        }</div>
      `);

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
          <div data-conversation-messages="true">${this.renderStatusRowsMarkup()}</div>
        `;
      }

      return `
        <div class="details-panel__session-title">${escapeHtml(this.viewedSessionValue.title)}</div>
        <div data-conversation-messages="true">${this.renderMessageGroupsMarkup(this.messages)}${this.renderStatusRowsMarkup()}</div>
      `;
    }

    /**
     * Status rows live in their own small container, so showing or clearing one
     * does not restyle the transcript beside it.
     */
    private renderStatusRowsMarkup(): string {
      return `<div data-status-rows="true">${
        this.isViewedSessionInterrupted() ? this.renderInterruptedMarkup() : ""
      }</div>`;
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
     * Builds the pending assistant response row shown in the pinned status bar.
     */
    private renderThinkingMarkup(): string {
      return `<div class="details-panel__thinking" data-thinking-row="true"><span data-thinking-spinner="true">${escapeHtml(this.getThinkingSpinnerFrame())}</span> <span data-thinking-label="true">${escapeHtml(this.thinkingLabelValue)}</span></div>`;
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
      // Opening another conversation retires nothing: that row belonged to the
      // session being left behind.
      this.retiredUserPromptId = null;
      this.resetLiveState();

      if (!viewedSession) {
        this.messages = [];
        this.isLoading = false;
        this.renderedMessageFingerprints.clear();
        this.renderedSessionId = null;
        this.render();
        return;
      }

      this.messages = [];
      this.transcriptMessages = [];
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

        this.transcriptMessages = conversation.messages;
        this.updateMessages();
        this.isLoading = false;
        this.loadError = null;

        this.render();
        this.scrollToBottom();
      } catch {
        if (loadVersion !== this.loadVersion) return;

        this.messages = [];
        this.transcriptMessages = [];
        this.isLoading = false;
        this.loadError = "Failed to load the conversation. Press w on this session to retry.";
        this.render();
      }
    }

    /**
     * Builds one transcript row.
     */
    private renderMessageGroupsMarkup(messages: ConversationMessage[]): string {
      const groupRows: string[] = [];

      for (let start = 0; start < messages.length; start += messageGroupSize) {
        groupRows.push(messages.slice(start, start + messageGroupSize).map((message) => this.renderMessageMarkup(message)).join(""));
      }

      return groupRows.reduceRight((nestedMarkup, rowsMarkup) => this.renderMessageGroupMarkup(rowsMarkup + nestedMarkup), "");
    }

    private renderMessageGroupMarkup(innerMarkup = ""): string {
      return `<div data-message-group="true">${innerMarkup}</div>`;
    }

    /**
     * Returns the innermost group, which is the only one that takes new rows.
     */
    private getTailMessageGroup(messagesContainer: HTMLElement): HTMLElement | null {
      return [...messagesContainer.querySelectorAll<HTMLElement>("[data-message-group='true']")].at(-1) ?? null;
    }

    /**
     * Opens a new tail group inside the current one, or as the first group.
     */
    private appendMessageGroup(messagesContainer: HTMLElement, tailGroup: HTMLElement | null): HTMLElement | null {
      if (tailGroup) {
        tailGroup.insertAdjacentHTML("beforeend", this.renderMessageGroupMarkup());
        return tailGroup.lastElementChild as HTMLElement | null;
      }

      messagesContainer.insertAdjacentHTML("afterbegin", this.renderMessageGroupMarkup());
      return messagesContainer.firstElementChild as HTMLElement | null;
    }

    /**
     * Drops groups left with no rows and no nested group, innermost first.
     */
    private removeEmptyMessageGroups(group: HTMLElement | null): void {
      while (group?.getAttribute("data-message-group") === "true" && group.childElementCount === 0) {
        const parentGroup = group.parentElement;

        group.parentNode?.removeChild(group);
        group = parentGroup;
      }
    }

    private renderMessageMarkup(message: ConversationMessage): string {
      const isPendingUserPrompt = this.isPendingUserPromptMessage(message);

      return `
        <div class="details-panel__message${isPendingUserPrompt ? " details-panel__message--pending" : ""}" data-conversation-message="true" data-message-id="${escapeHtml(message.id)}"${isPendingUserPrompt ? ` data-pending-user-prompt="true"` : ""}>
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
     * Adds, updates and removes rendered message rows for a same-session
     * refresh, keeping them in the order the conversation has them.
     */
    private syncConversationMarkup(): boolean {
      if (!this.viewedSessionValue || this.renderedSessionId !== this.viewedSessionValue.id) return false;

      const messagesContainer = this.getMessagesContainer();

      if (!messagesContainer) return false;

      this.syncTitleMarkup();

      const messages = this.messages;

      // A live row is replaced by its transcript twin or dropped once the turn
      // settles, so rows can now disappear as well as appear.
      const currentIds = new Set(messages.map((message) => message.id));
      // One pass over the rendered rows; a lookup per message made each refresh
      // quadratic in the transcript length.
      const messageElements = this.getMessageElementsById();
      for (const renderedId of [...this.renderedMessageFingerprints.keys()]) {
        if (currentIds.has(renderedId)) continue;

        const staleElement = messageElements.get(renderedId);
        const group = staleElement?.parentElement ?? null;

        staleElement?.parentNode?.removeChild(staleElement);
        this.removeEmptyMessageGroups(group);
        messageElements.delete(renderedId);
        this.renderedMessageFingerprints.delete(renderedId);
      }

      // Walked from the newest row backwards, so each new row knows which row
      // follows it and can go in above it. Appending every new row to the tail
      // put a prompt the transcript only now reports under the reply to it.
      let followingMessage: HTMLElement | null = null;

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const fingerprint = this.getMessageFingerprint(message);
        const existingMessage = messageElements.get(message.id);

        if (existingMessage) {
          if (this.renderedMessageFingerprints.get(message.id) !== fingerprint) {
            existingMessage.innerHTML = this.renderMessageInnerMarkup(message);
          }

          followingMessage = existingMessage;
        } else {
          const insertedMessage = this.insertMessageMarkup(messagesContainer, message, followingMessage);

          if (insertedMessage) {
            messageElements.set(message.id, insertedMessage);
            followingMessage = insertedMessage;
          }
        }

        this.renderedMessageFingerprints.set(message.id, fingerprint);
      }

      if (messages.length > 0 || this.isViewedSessionThinking()) {
        this.removeEmptyConversationMarkup();
      }

      this.syncThinkingMarkup();
      this.syncInterruptedMarkup();
      return true;
    }

    /**
     * Places one new row: above the row that follows it, or at the end of the
     * tail group when nothing on screen comes after it.
     */
    private insertMessageMarkup(
      messagesContainer: HTMLElement,
      message: ConversationMessage,
      followingMessage: HTMLElement | null,
    ): HTMLElement | null {
      if (followingMessage) {
        followingMessage.insertAdjacentHTML("beforebegin", this.renderMessageMarkup(message));
        return followingMessage.previousElementSibling as HTMLElement | null;
      }

      let tailGroup = this.getTailMessageGroup(messagesContainer);

      // The tail group holds only rows, so its child count is its row count.
      if (!tailGroup || tailGroup.childElementCount >= messageGroupSize) {
        tailGroup = this.appendMessageGroup(messagesContainer, tailGroup);
      }

      tailGroup?.insertAdjacentHTML("beforeend", this.renderMessageMarkup(message));

      return (tailGroup?.lastElementChild as HTMLElement | null) ?? null;
    }

    /**
     * Adds or removes the pending assistant row in the pinned status bar.
     *
     * Only the row inside the bar is added or removed; the bar itself stays on
     * screen, so a turn starting or ending never restyles the transcript.
     */
    private syncThinkingMarkup(): void {
      if (!this.viewedSessionValue || this.isLoading || this.loadError) {
        this.removeThinkingMarkup();
        this.syncThinkingSpinnerAnimation();
        return;
      }

      const statusBarContainer = this.getStatusBarContainer();

      if (!statusBarContainer) {
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
        statusBarContainer.insertAdjacentHTML("beforeend", this.renderThinkingMarkup());
        this.scrollToBottom();
      }

      this.syncThinkingSpinnerAnimation();
      this.syncThinkingLabelMarkup();
    }

    /**
     * Retitles the pending row in place, so a change of activity never rebuilds
     * the status bar or restarts the spinner.
     */
    private syncThinkingLabelMarkup(): void {
      const label = this.querySelector<HTMLElement>("[data-thinking-label='true']");

      if (label) {
        label.textContent = this.thinkingLabelValue;
      }
    }

    /**
     * Adds or removes the interrupted assistant row in place.
     */
    private syncInterruptedMarkup(): void {
      if (!this.viewedSessionValue || this.isLoading || this.loadError) {
        this.removeInterruptedMarkup();
        return;
      }

      const statusRowsContainer = this.getStatusRowsContainer();

      if (!statusRowsContainer) {
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
        statusRowsContainer.insertAdjacentHTML("beforeend", this.renderInterruptedMarkup());
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
     * Returns whether a transcript read matches the one already shown.
     */
    private isSameTranscript(messages: ConversationMessage[]): boolean {
      if (messages.length !== this.transcriptMessages.length) return false;

      return messages.every((message, index) => {
        const shownMessage = this.transcriptMessages[index];

        return message.id === shownMessage.id && this.getMessageFingerprint(message) === this.getMessageFingerprint(shownMessage);
      });
    }

    /**
     * Finds the transcript container used for incremental message updates.
     */
    private getMessagesContainer(): HTMLElement | null {
      return this.querySelector<HTMLElement>("[data-conversation-messages='true']");
    }

    /**
     * Finds the container for the pending and interrupted rows.
     */
    private getStatusRowsContainer(): HTMLElement | null {
      return this.querySelector<HTMLElement>("[data-status-rows='true']");
    }

    /**
     * Finds the borderless strip pinned under the transcript.
     */
    private getStatusBarContainer(): HTMLElement | null {
      return this.querySelector<HTMLElement>("[data-status-bar='true']");
    }

    /**
     * Maps rendered message rows by message id, keeping the first row per id.
     */
    private getMessageElementsById(): Map<string, HTMLElement> {
      const messageElements = new Map<string, HTMLElement>();

      for (const renderedMessage of this.querySelectorAll<HTMLElement>("[data-conversation-message='true']")) {
        const messageId = renderedMessage.getAttribute("data-message-id");

        if (messageId !== null && !messageElements.has(messageId)) {
          messageElements.set(messageId, renderedMessage);
        }
      }

      return messageElements;
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
     * Keeps the end of the transcript visible as rows are added or grow.
     *
     * The scroll box is moved directly rather than through `scrollIntoView`:
     * TermDOM ignores the alignment option and always makes the smallest move
     * that reveals the element, so a reply taller than the panel was pulled up
     * to its first line, then back down to its last, on every streamed update.
     * It also walks every scrolling ancestor, including the `overflow: hidden`
     * ones around the panel, which shifted the layout beside it.
     */
    private scrollToBottom(): void {
      const content = this.querySelector<HTMLElement>(".details-panel__content");

      if (!content) return;

      // Assigning past the end clamps to the last scroll position available.
      content.scrollTop = content.scrollHeight;
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
