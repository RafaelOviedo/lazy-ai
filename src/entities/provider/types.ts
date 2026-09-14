import type { ProjectReader } from "../project";
import type { SessionReader } from "../session";

export type ProviderId = "claude-code" | "codex";

/**
 * Drives live turns for one provider. Null on a provider that can only be read.
 */
export interface ProviderRuntimeClient {
  deleteThread(threadId: string): Promise<unknown>;
  dispose(): void;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  resumeThread(threadId: string, cwd?: string): Promise<{ threadId: string }>;
  startThread(cwd?: string): Promise<{ sessionId: string; threadId: string }>;
  startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId: string }>;
  waitForTurnCompletion(threadId: string, turnId?: string): Promise<{ errorMessage?: string; status: string }>;
}

/**
 * Everything the app needs to render and drive one provider.
 */
export type ProviderProfile = {
  client: ProviderRuntimeClient | null;
  id: ProviderId;
  label: string;
  projects: ProjectReader;
  sessions: SessionReader;
};

export type UsageLimit = {
  limitId?: string;
  limitName?: string | null;
  primary?: UsageLimitWindow;
  secondary?: UsageLimitWindow;
  credits?: UsageLimitCredits;
  planType?: string;
  rateLimitReachedType?: string | null;
};

export type UsageLimitSnapshot = {
  usageLimit: UsageLimit;
  observedAt: string;
};

export type UsageLimitWindow = {
  usedPercent: number;
  remainingPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
};

export type UsageLimitCredits = {
  hasCredits?: boolean;
  unlimited?: boolean;
  balance?: number | null;
};
