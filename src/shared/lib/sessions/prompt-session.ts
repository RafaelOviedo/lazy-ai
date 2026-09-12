import type { SessionSummary } from "../../../app/types/index.js";

type SessionPromptClient = {
  startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId: string }>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  waitForTurnCompletion(threadId: string, turnId?: string): Promise<{ errorMessage?: string; status: string }>;
};

type SessionPromptControllerOptions = {
  client: SessionPromptClient;
  setDetailsPendingUserPrompt(prompt: PendingSessionPrompt | null): void;
  setDetailsInterruptedSessionId(sessionId: string | null): void;
  setDetailsThinkingSessionId(sessionId: string | null): void;
  setLoadError(error: string | null): void;
  setSessionInterrupted(sessionId: string | null): void;
  setSessionThinking(sessionId: string | null): void;
  syncConversation(sessionId: string): Promise<void>;
  syncSession(sessionId: string): Promise<SessionSummary | null>;
  syncStatusPanel(): void;
};

export type PendingSessionPrompt = {
  sessionId: string;
  submittedAt: string;
  text: string;
};

export type SessionPromptController = {
  dispose(): void;
  hasActiveTurn(): boolean;
  interruptActiveTurn(): Promise<boolean>;
  isSessionPrompting(): boolean;
  promptSession(prompt: string, session: SessionSummary, threadId: string, projectPath: string): Promise<void>;
};

type ActiveSessionTurn = {
  isInterrupting: boolean;
  requestVersion: number;
  threadId: string;
  turnId: string;
};

const conversationPollIntervalMs = 1000;

/**
 * Coordinates follow-up prompts sent to an already running session.
 */
export function createSessionPromptController(options: SessionPromptControllerOptions): SessionPromptController {
  let isPrompting = false;
  let isConversationPollInFlight = false;
  let conversationPollTimer: ReturnType<typeof setInterval> | null = null;
  let promptRequestVersion = 0;
  let activeTurn: ActiveSessionTurn | null = null;

  async function promptSession(
    prompt: string,
    session: SessionSummary,
    threadId: string,
    projectPath: string,
  ): Promise<void> {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isPrompting) return;

    const currentPromptRequestVersion = promptRequestVersion + 1;
    promptRequestVersion = currentPromptRequestVersion;
    isPrompting = true;

    options.setLoadError(null);
    options.setSessionInterrupted(null);
    options.setDetailsInterruptedSessionId(null);
    options.setDetailsPendingUserPrompt({
      sessionId: session.id,
      submittedAt: new Date().toISOString(),
      text: trimmedPrompt,
    });
    options.setSessionThinking(session.id);
    options.setDetailsThinkingSessionId(session.id);
    options.syncStatusPanel();

    try {
      const startedTurn = await options.client.startTurn(threadId, trimmedPrompt, projectPath);

      if (currentPromptRequestVersion !== promptRequestVersion) return;

      activeTurn = {
        isInterrupting: false,
        requestVersion: currentPromptRequestVersion,
        threadId,
        turnId: startedTurn.turnId,
      };

      startConversationPolling(session.id, currentPromptRequestVersion);

      const completion = await options.client.waitForTurnCompletion(threadId, startedTurn.turnId);

      if (currentPromptRequestVersion !== promptRequestVersion) return;

      stopConversationPolling();
      clearActiveTurn(currentPromptRequestVersion);

      if (completion.status === "failed") {
        options.setLoadError(completion.errorMessage ?? "Codex session failed while generating a response.");
      }

      if (completion.status === "interrupted") {
        options.setLoadError("Codex session was interrupted before the response completed.");
      }

      options.setSessionThinking(null);
      await options.syncSession(session.id);
      await options.syncConversation(session.id);

      if (currentPromptRequestVersion !== promptRequestVersion) return;

      options.setDetailsThinkingSessionId(null);
      options.setDetailsPendingUserPrompt(null);
      if (completion.status === "interrupted") {
        options.setSessionInterrupted(session.id);
        options.setDetailsInterruptedSessionId(session.id);
      }
      options.syncStatusPanel();
    } catch (error) {
      if (currentPromptRequestVersion !== promptRequestVersion) return;

      stopConversationPolling();
      clearActiveTurn(currentPromptRequestVersion);
      options.setLoadError(formatPromptSessionError(error));
      options.setSessionThinking(null);
      options.setDetailsThinkingSessionId(null);
      options.setDetailsPendingUserPrompt(null);
      options.setSessionInterrupted(null);
      options.setDetailsInterruptedSessionId(null);
      options.syncStatusPanel();
    } finally {
      if (currentPromptRequestVersion !== promptRequestVersion) return;

      isPrompting = false;
    }
  }

  async function interruptActiveTurn(): Promise<boolean> {
    const turn = activeTurn;

    if (!turn || turn.requestVersion !== promptRequestVersion) return false;
    if (turn.isInterrupting) return true;

    turn.isInterrupting = true;

    try {
      await options.client.interruptTurn(turn.threadId, turn.turnId);
      return true;
    } catch {
      if (turn.requestVersion === promptRequestVersion) {
        turn.isInterrupting = false;
        options.setLoadError("Failed to interrupt Codex session.");
        options.syncStatusPanel();
      }

      return false;
    }
  }

  function hasActiveTurn(): boolean {
    return activeTurn?.requestVersion === promptRequestVersion;
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
    if (requestVersion !== promptRequestVersion || isConversationPollInFlight) return;

    isConversationPollInFlight = true;

    void options.syncConversation(sessionId)
      .finally(() => {
        isConversationPollInFlight = false;
      });
  }

  function formatPromptSessionError(error: unknown): string {
    if (error instanceof Error && error.message.includes("Timed out waiting for Codex turn completion")) {
      return "Timed out waiting for Codex response. The session may still be running.";
    }

    return "Failed to prompt Codex session.";
  }

  return {
    dispose(): void {
      promptRequestVersion += 1;
      isPrompting = false;
      activeTurn = null;
      stopConversationPolling();
      options.setSessionThinking(null);
      options.setDetailsThinkingSessionId(null);
      options.setDetailsPendingUserPrompt(null);
      options.setSessionInterrupted(null);
      options.setDetailsInterruptedSessionId(null);
    },
    hasActiveTurn,
    interruptActiveTurn,
    isSessionPrompting(): boolean {
      return isPrompting;
    },
    promptSession,
  };
}
