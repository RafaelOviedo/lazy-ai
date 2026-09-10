import type { CodexSessionSummary } from "../../../repositories/sessions/codex/types.js";

type SessionPromptClient = {
  startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId?: string }>;
  waitForTurnCompletion(threadId: string, turnId?: string): Promise<{ errorMessage?: string; status: string }>;
};

type SessionPromptControllerOptions = {
  client: SessionPromptClient;
  setActivityStatus(status: string | null): void;
  setDetailsPendingUserPrompt(prompt: PendingSessionPrompt | null): void;
  setDetailsThinkingSessionId(sessionId: string | null): void;
  setLoadError(error: string | null): void;
  setSessionThinking(sessionId: string | null): void;
  syncSession(sessionId: string): Promise<CodexSessionSummary | null>;
  syncStatusPanel(): void;
};

export type PendingSessionPrompt = {
  sessionId: string;
  submittedAt: string;
  text: string;
};

export type SessionPromptController = {
  dispose(): void;
  isSessionPrompting(): boolean;
  promptSession(prompt: string, session: CodexSessionSummary, threadId: string, projectPath: string): Promise<void>;
};

/**
 * Coordinates follow-up prompts sent to an already running session.
 */
export function createSessionPromptController(options: SessionPromptControllerOptions): SessionPromptController {
  let isPrompting = false;
  let promptRequestVersion = 0;

  async function promptSession(
    prompt: string,
    session: CodexSessionSummary,
    threadId: string,
    projectPath: string,
  ): Promise<void> {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isPrompting) return;

    const currentPromptRequestVersion = promptRequestVersion + 1;
    promptRequestVersion = currentPromptRequestVersion;
    isPrompting = true;

    options.setLoadError(null);
    options.setDetailsPendingUserPrompt({
      sessionId: session.id,
      submittedAt: new Date().toISOString(),
      text: trimmedPrompt,
    });
    options.setSessionThinking(session.id);
    options.setDetailsThinkingSessionId(session.id);
    options.setActivityStatus("Thinking...");
    options.syncStatusPanel();

    try {
      const startedTurn = await options.client.startTurn(threadId, trimmedPrompt, projectPath);

      if (currentPromptRequestVersion !== promptRequestVersion) return;

      const completion = await options.client.waitForTurnCompletion(threadId, startedTurn.turnId);

      if (currentPromptRequestVersion !== promptRequestVersion) return;

      if (completion.status === "failed") {
        options.setLoadError(completion.errorMessage ?? "Codex session failed while generating a response.");
      }

      if (completion.status === "interrupted") {
        options.setLoadError("Codex session was interrupted before the response completed.");
      }

      options.setActivityStatus(null);
      options.setSessionThinking(null);
      await options.syncSession(session.id);

      if (currentPromptRequestVersion !== promptRequestVersion) return;

      options.setDetailsThinkingSessionId(null);
      options.setDetailsPendingUserPrompt(null);
      options.syncStatusPanel();
    } catch (error) {
      if (currentPromptRequestVersion !== promptRequestVersion) return;

      options.setLoadError(formatPromptSessionError(error));
      options.setSessionThinking(null);
      options.setDetailsThinkingSessionId(null);
      options.setDetailsPendingUserPrompt(null);
      options.setActivityStatus(null);
      options.syncStatusPanel();
    } finally {
      if (currentPromptRequestVersion !== promptRequestVersion) return;

      isPrompting = false;
    }
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
      options.setSessionThinking(null);
      options.setDetailsThinkingSessionId(null);
      options.setDetailsPendingUserPrompt(null);
      options.setActivityStatus(null);
    },
    isSessionPrompting(): boolean {
      return isPrompting;
    },
    promptSession,
  };
}
