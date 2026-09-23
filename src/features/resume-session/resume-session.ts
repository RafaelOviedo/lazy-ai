import { isSessionAlreadyRunningError } from "../../entities/provider/index.js";

import type { SessionSummary } from "../../entities/session/index.js";

type SessionResumeClient = {
  resumeThread(threadId: string, cwd?: string): Promise<{ threadId: string }>;
};

type SessionResumeControllerOptions = {
  client: SessionResumeClient;
  /** Names the provider in user-facing errors. */
  providerLabel: string;
  /** Surfaces a failed action to the user. */
  reportActionError(message: string): void;
  setActiveSessionId(sessionId: string | null): void;
  setLoadError(error: string | null): void;
  setSessionAlreadyRunning(sessionId: string | null): void;
  setSessionResumeFailed(sessionId: string | null): void;
  setSessionResuming(sessionId: string | null): void;
  syncStatusPanel(): void;
};

export type SessionResumeController = {
  attachSession(sessionId: string, threadId: string): void;
  clearActiveSession(sessionId?: string): void;
  dispose(): void;
  getActiveThreadId(): string | null;
  getActiveSessionId(): string | null;
  isSessionActive(sessionId: string): boolean;
  isSessionResuming(sessionId: string): boolean;
  markSessionActive(sessionId: string, threadId?: string | null): void;
  resumeSession(requestedSession: SessionSummary, resumeProjectPath: string): Promise<void>;
  showAlreadyRunningStatus(sessionId: string): void;
};

/**
 * Coordinates session resume state and transient resume statuses.
 */
export function createSessionResumeController(options: SessionResumeControllerOptions): SessionResumeController {
  const attachedThreads = new Map<string, string>();
  const pendingResumes = new Map<string, Promise<{ threadId: string }>>();
  let activeSessionId: string | null = null;
  let activeThreadId: string | null = null;
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

  function markSessionActive(sessionId: string, threadId?: string | null): void {
    resumeRequestVersion += 1;
    resumingSessionId = null;
    options.setSessionResuming(null);
    activeSessionId = sessionId;
    activeThreadId = threadId ?? attachedThreads.get(sessionId) ?? sessionId;
    attachedThreads.set(sessionId, activeThreadId);
    options.setActiveSessionId(activeSessionId);
  }

  async function resumeSession(requestedSession: SessionSummary, resumeProjectPath: string): Promise<void> {
    const currentResumeRequestVersion = resumeRequestVersion + 1;
    resumeRequestVersion = currentResumeRequestVersion;
    resumingSessionId = requestedSession.id;
    options.setLoadError(null);

    clearAlreadyRunningStatus();
    clearResumeFailedStatus();
    options.setSessionResuming(resumingSessionId);

    try {
      let threadId = attachedThreads.get(requestedSession.id);

      if (!threadId) {
        let pending = pendingResumes.get(requestedSession.id);

        if (!pending) {
          pending = options.client.resumeThread(requestedSession.id, resumeProjectPath);
          pendingResumes.set(requestedSession.id, pending);
        }

        try {
          threadId = (await pending).threadId;
          attachedThreads.set(requestedSession.id, threadId);
        } finally {
          pendingResumes.delete(requestedSession.id);
        }
      }

      const resumedThread = { threadId };
      if (currentResumeRequestVersion !== resumeRequestVersion) return;

      markSessionActive(requestedSession.id, resumedThread.threadId);
      resumingSessionId = null;

      options.setSessionResuming(null);
    } catch (error) {
      if (currentResumeRequestVersion !== resumeRequestVersion) return;

      const failedSessionId = requestedSession.id;
      resumingSessionId = null;
      options.setSessionResuming(null);

      if (isSessionAlreadyRunningError(error)) {
        showAlreadyRunningStatus(failedSessionId);
        return;
      }

      options.reportActionError(`Failed to resume ${options.providerLabel} session.`);
      options.setSessionResumeFailed(failedSessionId);
      options.syncStatusPanel();

      resumeFailedTimer = setTimeout(() => {
        resumeFailedTimer = null;
        options.setSessionResumeFailed(null);
      }, 1500);
    }
  }

  function attachSession(sessionId: string, threadId: string): void {
    attachedThreads.set(sessionId, threadId);
  }

  function clearActiveSession(sessionId?: string): void {
    if (sessionId) attachedThreads.delete(sessionId);
    if (sessionId && activeSessionId !== sessionId) return;

    activeSessionId = null;
    activeThreadId = null;
    options.setActiveSessionId(null);
  }

  function dispose(): void {
    resumeRequestVersion += 1;
    attachedThreads.clear();
    activeSessionId = null;
    activeThreadId = null;
    resumingSessionId = null;
    options.setActiveSessionId(null);
    options.setSessionResuming(null);
    clearAlreadyRunningStatus();
    clearResumeFailedStatus();
  }

  function getActiveThreadId(): string | null {
    return activeThreadId;
  }

  function getActiveSessionId(): string | null {
    return activeSessionId;
  }

  function isSessionActive(sessionId: string): boolean {
    return sessionId === activeSessionId;
  }

  function isSessionResuming(sessionId: string): boolean {
    return sessionId === resumingSessionId;
  }

  return {
    attachSession,
    clearActiveSession,
    dispose,
    getActiveThreadId,
    getActiveSessionId,
    isSessionActive,
    isSessionResuming,
    markSessionActive,
    resumeSession,
    showAlreadyRunningStatus,
  };
}
