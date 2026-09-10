type SessionStartClient = {
  startThread(cwd?: string): Promise<{ sessionId: string; threadId: string }>;
  startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId?: string }>;
  waitForTurnCompletion(threadId: string, turnId?: string): Promise<{ errorMessage?: string; status: string }>;
};

type StartedSession = {
  title: string;
};

type SessionStartControllerOptions = {
  client: SessionStartClient;
  getSession(sessionId: string): StartedSession | null;
  setActivityStatus(status: string | null): void;
  setActiveSessionId(sessionId: string | null): void;
  setDetailsThinkingSessionId(sessionId: string | null): void;
  setLoadError(error: string | null): void;
  setSessionThinking(sessionId: string | null): void;
  syncSession(sessionId: string): Promise<StartedSession | null>;
  syncStatusPanel(): void;
};

export type SessionStartController = {
  dispose(): void;
  isSessionStarting(): boolean;
  startSession(prompt: string, projectPath: string): Promise<void>;
};

const sessionReloadAttempts = 20;
const sessionReloadRetryDelayMs = 250;
const untitledSessionTitle = "Untitled session";

/**
 * Coordinates new-session creation and post-start panel refresh.
 */
export function createSessionStartController(options: SessionStartControllerOptions): SessionStartController {
  let isStarting = false;
  let startRequestVersion = 0;

  async function startSession(prompt: string, projectPath: string): Promise<void> {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isStarting) return;

    const currentStartRequestVersion = startRequestVersion + 1;
    startRequestVersion = currentStartRequestVersion;
    isStarting = true;
    options.setLoadError(null);
    options.syncStatusPanel();

    try {
      const startedThread = await options.client.startThread(projectPath);

      if (currentStartRequestVersion !== startRequestVersion) return;

      const startedTurn = await options.client.startTurn(startedThread.threadId, trimmedPrompt, projectPath);

      if (currentStartRequestVersion !== startRequestVersion) return;

      await syncSessionUntilReady(startedThread.sessionId, currentStartRequestVersion);

      if (currentStartRequestVersion !== startRequestVersion) return;

      options.setActiveSessionId(startedThread.sessionId);
      options.setSessionThinking(startedThread.sessionId);
      options.setDetailsThinkingSessionId(startedThread.sessionId);
      options.setActivityStatus("Thinking...");
      options.syncStatusPanel();

      const completion = await options.client.waitForTurnCompletion(startedThread.threadId, startedTurn.turnId);

      if (currentStartRequestVersion !== startRequestVersion) return;

      if (completion.status === "failed") {
        options.setLoadError(completion.errorMessage ?? "Codex session failed while generating a response.");
      }

      if (completion.status === "interrupted") {
        options.setLoadError("Codex session was interrupted before the response completed.");
      }

      options.setActivityStatus(null);
      options.setSessionThinking(null);
      await syncSessionUntilReady(startedThread.sessionId, currentStartRequestVersion);

      if (currentStartRequestVersion !== startRequestVersion) return;

      options.setDetailsThinkingSessionId(null);
      options.setActiveSessionId(startedThread.sessionId);
      options.syncStatusPanel();
    } catch (error) {
      if (currentStartRequestVersion !== startRequestVersion) return;

      options.setLoadError(formatStartSessionError(error));
      options.setSessionThinking(null);
      options.setDetailsThinkingSessionId(null);
      options.setActivityStatus(null);
      options.syncStatusPanel();
    } finally {
      if (currentStartRequestVersion !== startRequestVersion) return;

      isStarting = false;
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
    if (error instanceof Error && error.message.includes("Timed out waiting for Codex turn completion")) {
      return "Timed out waiting for Codex response. The session may still be running.";
    }

    return "Failed to start Codex session.";
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
      options.setSessionThinking(null);
      options.setDetailsThinkingSessionId(null);
      options.setActivityStatus(null);
    },
    isSessionStarting(): boolean {
      return isStarting;
    },
    startSession,
  };
}
