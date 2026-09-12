import type { ProviderId } from "../types.js";

export type ActiveProviderSelection = {
  modelId: string | null;
  modelLabel: string | null;
  providerId: ProviderId;
};

type ActiveProviderListener = () => void;

const listeners = new Set<ActiveProviderListener>();

let selection: ActiveProviderSelection = {
  modelId: null,
  modelLabel: null,
  providerId: "codex",
};

/**
 * Returns the provider and model the app is currently pointed at.
 */
export function getActiveProvider(): ActiveProviderSelection {
  return selection;
}

/**
 * Points the app at a provider and model, notifying subscribers when it changes.
 */
export function setActiveProvider(next: ActiveProviderSelection): void {
  if (selection.providerId === next.providerId && selection.modelId === next.modelId) return;

  selection = next;

  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * Subscribes to provider changes so the app can rebuild against the new source.
 */
export function subscribeActiveProvider(listener: ActiveProviderListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
