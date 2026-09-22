import type { UsageLimitSnapshot } from "../../entities/provider/index.js";

type UsageLimitControllerOptions = {
  readSnapshot(): Promise<UsageLimitSnapshot | null>;
  onSnapshot(snapshot: UsageLimitSnapshot): void;
};

const settleAttempts = 3;
const settleDelayMs = 500;

/** Refreshes persisted usage without blocking a response or losing the last known value. */
export function createUsageLimitController(options: UsageLimitControllerOptions) {
  let isDisposed = false;
  let latestObservedAt = -Infinity;
  let settleVersion = 0;
  let cancelDelay: (() => void) | null = null;

  async function refresh(): Promise<void> {
    if (isDisposed) return;

    let snapshot: UsageLimitSnapshot | null;
    try {
      snapshot = await options.readSnapshot();
    } catch {
      return;
    }

    if (isDisposed || !snapshot) return;

    const observedAt = Date.parse(snapshot.observedAt);
    // A slow startup/project refresh must not overwrite a newer turn's usage.
    if (!Number.isFinite(observedAt) || observedAt <= latestObservedAt) return;

    latestObservedAt = observedAt;
    options.onSnapshot(snapshot);
  }

  async function refreshAfterTurn(): Promise<void> {
    if (isDisposed) return;

    const version = ++settleVersion;
    cancelDelay?.();

    // Completion can arrive before the final usage record reaches the transcript.
    // Retry even if the first read succeeds: it may still contain an older record.
    for (let attempt = 0; attempt < settleAttempts; attempt += 1) {
      await refresh();
      if (isDisposed || version !== settleVersion || attempt === settleAttempts - 1) return;

      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          cancelDelay = null;
          resolve();
        };
        const timer = setTimeout(finish, settleDelayMs);
        cancelDelay = finish;
      });

      if (isDisposed || version !== settleVersion) return;
    }
  }

  return {
    refresh,
    refreshAfterTurn,
    dispose(): void {
      isDisposed = true;
      settleVersion += 1;
      cancelDelay?.();
    },
  };
}
