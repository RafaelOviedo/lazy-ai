import type { ProviderRuntimeClient } from "../ports/index.js";

/**
 * Stands in for providers lazy-ai can read but cannot drive yet, so callers fail
 * with a clear message instead of a null dereference.
 */
export function createUnavailableRuntimeClient(providerLabel: string): ProviderRuntimeClient {
  const unavailable = (): never => {
    throw new Error(`${providerLabel} sessions are read-only in lazy-ai for now.`);
  };

  return {
    deleteThread: unavailable,
    dispose: () => { },
    interruptTurn: unavailable,
    resumeThread: unavailable,
    startThread: unavailable,
    startTurn: unavailable,
    waitForTurnCompletion: unavailable,
  };
}
