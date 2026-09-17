/**
 * Raised when a session cannot be driven because something already holds it.
 * Providers detect this differently — Codex rejects a second writer server-side,
 * while lazy-ai tracks its own live processes for Claude Code — so the features
 * layer recognises this error instead of any one provider's error type.
 */
export class SessionAlreadyRunningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionAlreadyRunningError";
  }
}

export function isSessionAlreadyRunningError(error: unknown): error is SessionAlreadyRunningError {
  return error instanceof SessionAlreadyRunningError;
}
