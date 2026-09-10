import { isCodexAppServerActiveWriterError } from "../../../repositories/app-server/codex-app-server-client.js";

import type { CodexSessionSummary } from "../../../repositories/sessions/codex/types.js";

type SessionResumeClient = {
  resumeThread(threadId: string, cwd?: string): Promise<unknown>;
};

type SessionResumeControllerOptions = {
  client: SessionResumeClient;
  setActiveSessionId(sessionId: string | null): void;
  setLoadError(error: string | null): void;
  setSessionAlreadyRunning(sessionId: string | null): void;
  setSessionResumeFailed(sessionId: string | null): void;
  setSessionResuming(sessionId: string | null): void;
  syncStatusPanel(): void;
};

export type SessionResumeController = {
  clearActiveSession(sessionId?: string): void;
  dispose(): void;
  getActiveSessionId(): string | null;
  isSessionActive(sessionId: string): boolean;
  isSessionResuming(sessionId: string): boolean;
  resumeSession(requestedSession: CodexSessionSummary, resumeProjectPath: string): Promise<void>;
  showAlreadyRunningStatus(sessionId: string): void;
};

/**
 * Coordinates session resume state and transient resume statuses.
 */
export function createSessionResumeController(options: SessionResumeControllerOptions): SessionResumeController {
  let activeSessionId: string | null = null;
  let resumingSessionId: string | null = null;
  let resumeRequestVersion = 0;
  let alreadyRunningTimer: ReturnType<typeof setTimeout> | null = null;
  let resumeFailedTimer: ReturnType<typeof setTimeout> | null = null;

  function clearAlreadyRunningStatus(): void {
    if (!alreadyRunningTimer) return;

    clearTimeout(alreadyRunningTimer);
    alreadyRunningTimer = null;
    options.setSessionAlreadyRunning(null);
  }

  function clearResumeFailedStatus(): void {
    if (!resumeFailedTimer) return;

    clearTimeout(resumeFailedTimer);
    resumeFailedTimer = null;
    options.setSessionResumeFailed(null);
  }

  function showAlreadyRunningStatus(sessionId: string): void {
    clearAlreadyRunningStatus();
    clearResumeFailedStatus();

    options.setSessionAlreadyRunning(sessionId);

    alreadyRunningTimer = setTimeout(() => {
      alreadyRunningTimer = null;
      options.setSessionAlreadyRunning(null);
    }, 1000);
  }

  async function resumeSession(requestedSession: CodexSessionSummary, resumeProjectPath: string): Promise<void> {
    const currentResumeRequestVersion = resumeRequestVersion + 1;
    resumeRequestVersion = currentResumeRequestVersion;
    resumingSessionId = requestedSession.id;
    options.setLoadError(null);

    clearAlreadyRunningStatus();
    clearResumeFailedStatus();
    options.setSessionResuming(resumingSessionId);

    try {
      await options.client.resumeThread(requestedSession.id, resumeProjectPath);

      if (currentResumeRequestVersion !== resumeRequestVersion) return;

      activeSessionId = requestedSession.id;
      resumingSessionId = null;

      options.setSessionResuming(null);
      options.setActiveSessionId(activeSessionId);
    } catch (error) {
      if (currentResumeRequestVersion !== resumeRequestVersion) return;

      const failedSessionId = requestedSession.id;
      resumingSessionId = null;
      options.setSessionResuming(null);

      if (isCodexAppServerActiveWriterError(error)) {
        showAlreadyRunningStatus(failedSessionId);
        return;
      }

      options.setLoadError("Failed to resume Codex session.");
      options.setSessionResumeFailed(failedSessionId);
      options.syncStatusPanel();

      resumeFailedTimer = setTimeout(() => {
        resumeFailedTimer = null;
        options.setSessionResumeFailed(null);
      }, 1500);
    }
  }

  return {
    clearActiveSession(sessionId?: string): void {
      if (sessionId && activeSessionId !== sessionId) return;

      activeSessionId = null;
      options.setActiveSessionId(null);
    },
    dispose(): void {
      resumeRequestVersion += 1;
      resumingSessionId = null;
      options.setSessionResuming(null);
      clearAlreadyRunningStatus();
      clearResumeFailedStatus();
    },
    getActiveSessionId(): string | null {
      return activeSessionId;
    },
    isSessionActive(sessionId: string): boolean {
      return sessionId === activeSessionId;
    },
    isSessionResuming(sessionId: string): boolean {
      return sessionId === resumingSessionId;
    },
    resumeSession,
    showAlreadyRunningStatus,
  };
}
