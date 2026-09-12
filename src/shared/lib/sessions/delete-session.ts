import type { SessionSummary } from "../../../entities/session/index.js";

type SessionDeleteClient = {
  deleteThread(threadId: string): Promise<unknown>;
};

type SessionDeleteControllerOptions = {
  clearActiveSession(sessionId: string): void;
  client: SessionDeleteClient;
  reloadSessions(): Promise<void>;
  setLoadError(error: string | null): void;
  setSessionDeleting(sessionId: string | null): void;
  syncStatusPanel(): void;
};

export type SessionDeleteController = {
  deleteSession(requestedSession: SessionSummary): Promise<void>;
  dispose(): void;
  isSessionDeleting(sessionId: string): boolean;
};

/**
 * Coordinates session deletion state and post-delete refresh.
 */
export function createSessionDeleteController(options: SessionDeleteControllerOptions): SessionDeleteController {
  let deletingSessionId: string | null = null;
  let deleteRequestVersion = 0;

  async function deleteSession(requestedSession: SessionSummary): Promise<void> {
    const currentDeleteRequestVersion = deleteRequestVersion + 1;
    deleteRequestVersion = currentDeleteRequestVersion;
    deletingSessionId = requestedSession.id;
    options.setLoadError(null);
    options.setSessionDeleting(deletingSessionId);

    try {
      await options.client.deleteThread(requestedSession.id);

      if (currentDeleteRequestVersion !== deleteRequestVersion) return;

      options.clearActiveSession(requestedSession.id);
      await options.reloadSessions();
    } catch {
      if (currentDeleteRequestVersion !== deleteRequestVersion) return;

      options.setLoadError("Failed to delete Codex session.");
      options.syncStatusPanel();
    } finally {
      if (currentDeleteRequestVersion !== deleteRequestVersion) return;

      deletingSessionId = null;
      options.setSessionDeleting(null);
    }
  }

  return {
    deleteSession,
    dispose(): void {
      deleteRequestVersion += 1;
      deletingSessionId = null;
      options.setSessionDeleting(null);
    },
    isSessionDeleting(sessionId: string): boolean {
      return sessionId === deletingSessionId;
    },
  };
}
