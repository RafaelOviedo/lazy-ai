type SessionStartClient = {
  startThread(cwd?: string): Promise<{ sessionId: string; threadId: string }>;
  startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId: string }>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  waitForTurnCompletion(threadId: string, turnId?: string): Promise<{ errorMessage?: string; status: string }>;
};

type StartedSession = {
  title: string;
};

type SessionStartControllerOptions = {
  client: SessionStartClient;
  getSession(sessionId: string): StartedSession | null;
  /** Names the provider in user-facing errors. */
  providerLabel: string;
  /** Surfaces a failed action to the user. */
  reportActionError(message: string): void;
  setActiveSession(sessionId: string, threadId: string): void;
  setDetailsInterruptedSessionId(sessionId: string | null): void;
  setDetailsThinkingSessionId(sessionId: string | null): void;
  setLoadError(error: string | null): void;
  setSessionInterrupted(sessionId: string | null): void;
  setSessionThinking(sessionId: string | null): void;
  syncConversation(sessionId: string): Promise<void>;
  syncSession(sessionId: string): Promise<StartedSession | null>;
  syncStatusPanel(): void;
};

export type SessionStartController = {
  dispose(): void;
  hasActiveTurn(): boolean;
  interruptActiveTurn(): Promise<boolean>;
  isSessionStarting(): boolean;
  startSession(prompt: string, projectPath: string): Promise<void>;
};

type ActiveSessionTurn = {
  isInterrupting: boolean;
  requestVersion: number;
  threadId: string;
  turnId: string;
};

const sessionReloadAttempts = 20;
const sessionReloadRetryDelayMs = 250;
const conversationPollIntervalMs = 1000;
const conversationSettleAttempts = 3;
const conversationSettleDelayMs = 250;
const untitledSessionTitle = "Untitled session";

/**
 * Coordinates new-session creation and post-start panel refresh.
 */
export function createSessionStartController(options: SessionStartControllerOptions): SessionStartController {
  let isStarting = false;
  let isConversationPollInFlight = false;
  let conversationPollTimer: ReturnType<typeof setInterval> | null = null;
  let startRequestVersion = 0;
  let activeTurn: ActiveSessionTurn | null = null;

  async function startSession(prompt: string, projectPath: string): Promise<void> {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isStarting) return;

    const currentStartRequestVersion = startRequestVersion + 1;
    startRequestVersion = currentStartRequestVersion;
    isStarting = true;
    options.setLoadError(null);
    options.setSessionInterrupted(null);
    options.setDetailsInterruptedSessionId(null);
    options.syncStatusPanel();

    try {
      const startedThread = await options.client.startThread(projectPath);

      if (currentStartRequestVersion !== startRequestVersion) return;

      const startedTurn = await options.client.startTurn(startedThread.threadId, trimmedPrompt, projectPath);

      if (currentStartRequestVersion !== startRequestVersion) return;

      activeTurn = {
        isInterrupting: false,
        requestVersion: currentStartRequestVersion,
        threadId: startedThread.threadId,
        turnId: startedTurn.turnId,
      };

      await syncSessionUntilReady(startedThread.sessionId, currentStartRequestVersion);

      if (currentStartRequestVersion !== startRequestVersion) return;

      options.setActiveSession(startedThread.sessionId, startedThread.threadId);
      options.setSessionThinking(startedThread.sessionId);
      options.setDetailsThinkingSessionId(startedThread.sessionId);
      options.syncStatusPanel();
      startConversationPolling(startedThread.sessionId, currentStartRequestVersion);

      const completion = await options.client.waitForTurnCompletion(startedThread.threadId, startedTurn.turnId);

      if (currentStartRequestVersion !== startRequestVersion) return;

      stopConversationPolling();
      clearActiveTurn(currentStartRequestVersion);

      if (completion.status === "failed") {
        options.reportActionError(completion.errorMessage ?? `${options.providerLabel} session failed while generating a response.`);
      }

      if (completion.status === "interrupted") {
        options.setLoadError(`${options.providerLabel} session was interrupted before the response completed.`);
      }

      options.setSessionThinking(null);
      await syncSessionUntilReady(startedThread.sessionId, currentStartRequestVersion);
      await settleConversation(startedThread.sessionId, currentStartRequestVersion);

      if (currentStartRequestVersion !== startRequestVersion) return;

      options.setDetailsThinkingSessionId(null);
      options.setActiveSession(startedThread.sessionId, startedThread.threadId);
      if (completion.status === "interrupted") {
        options.setSessionInterrupted(startedThread.sessionId);
        options.setDetailsInterruptedSessionId(startedThread.sessionId);
      }
      options.syncStatusPanel();
    } catch (error) {
      if (currentStartRequestVersion !== startRequestVersion) return;

      stopConversationPolling();
      clearActiveTurn(currentStartRequestVersion);
      options.reportActionError(formatStartSessionError(error));
      options.setSessionThinking(null);
      options.setDetailsThinkingSessionId(null);
      options.setSessionInterrupted(null);
      options.setDetailsInterruptedSessionId(null);
      options.syncStatusPanel();
    } finally {
      if (currentStartRequestVersion !== startRequestVersion) return;

      isStarting = false;
    }
  }

  async function interruptActiveTurn(): Promise<boolean> {
    const turn = activeTurn;

    if (!turn || turn.requestVersion !== startRequestVersion) return false;
    if (turn.isInterrupting) return true;

    turn.isInterrupting = true;

    try {
      await options.client.interruptTurn(turn.threadId, turn.turnId);
      return true;
    } catch {
      if (turn.requestVersion === startRequestVersion) {
        turn.isInterrupting = false;
        options.reportActionError(`Failed to interrupt ${options.providerLabel} session.`);
        options.syncStatusPanel();
      }

      return false;
    }
  }

  function hasActiveTurn(): boolean {
    return activeTurn?.requestVersion === startRequestVersion;
  }

  function clearActiveTurn(requestVersion: number): void {
    if (activeTurn?.requestVersion === requestVersion) {
      activeTurn = null;
    }
  }

  function startConversationPolling(sessionId: string, requestVersion: number): void {
    stopConversationPolling();
    pollConversation(sessionId, requestVersion);
    conversationPollTimer = setInterval(() => pollConversation(sessionId, requestVersion), conversationPollIntervalMs);
  }

  function stopConversationPolling(): void {
    if (conversationPollTimer) {
      clearInterval(conversationPollTimer);
      conversationPollTimer = null;
    }
  }

  function pollConversation(sessionId: string, requestVersion: number): void {
    if (requestVersion !== startRequestVersion || isConversationPollInFlight) return;

    isConversationPollInFlight = true;

    void options.syncConversation(sessionId)
      .finally(() => {
        isConversationPollInFlight = false;
      });
  }

  /**
   * Re-reads the transcript a few times after the turn reports completion.
   *
   * A provider can write its closing assistant record just after it announces the
   * turn is done, so a single read can miss the final reply and leave the details
   * panel one message short.
   */
  async function settleConversation(sessionId: string, requestVersion: number): Promise<void> {
    for (let attempt = 0; attempt < conversationSettleAttempts; attempt += 1) {
      await options.syncConversation(sessionId);

      if (requestVersion !== startRequestVersion) return;
      if (attempt === conversationSettleAttempts - 1) return;

      await wait(conversationSettleDelayMs);

      if (requestVersion !== startRequestVersion) return;
    }
  }

  async function syncSessionUntilReady(sessionId: string, requestVersion: number): Promise<void> {
    for (let attempt = 0; attempt < sessionReloadAttempts; attempt += 1) {
      const syncedSession = await options.syncSession(sessionId);

      if (requestVersion !== startRequestVersion) return;
      if (isSessionReady(syncedSession ?? options.getSession(sessionId))) return;

      await wait(sessionReloadRetryDelayMs);

      if (requestVersion !== startRequestVersion) return;
    }
  }

  function isSessionReady(session: StartedSession | null): boolean {
    return Boolean(session?.title && session.title !== untitledSessionTitle);
  }

  function formatStartSessionError(error: unknown): string {
    if (error instanceof Error && /timed out waiting for/i.test(error.message)) {
      return `Timed out waiting for ${options.providerLabel} response. The session may still be running.`;
    }

    return `Failed to start ${options.providerLabel} session.`;
  }

  function wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  return {
    dispose(): void {
      startRequestVersion += 1;
      isStarting = false;
      activeTurn = null;
      stopConversationPolling();
      options.setSessionThinking(null);
      options.setDetailsThinkingSessionId(null);
      options.setSessionInterrupted(null);
      options.setDetailsInterruptedSessionId(null);
    },
    hasActiveTurn,
    interruptActiveTurn,
    isSessionStarting(): boolean {
      return isStarting;
    },
    startSession,
  };
}
