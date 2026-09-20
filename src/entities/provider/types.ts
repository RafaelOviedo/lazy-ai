import type { ProjectReader } from "../project";
import type { SessionReader } from "../session";

export type ProviderId = "claude-code" | "codex";

/**
 * One tool call a provider is asking permission to run.
 */
export type ToolPermissionRequest = {
  /**
   * False when the provider says this call must not offer a persistent
   * "don't ask again" choice, because the rule it would write grants more than
   * this one action.
   */
  allowsSessionScope: boolean;
  /**
   * True when the provider says approval must not be reachable by a single
   * stray keystroke, so the prompt has to open on its decline option.
   */
  defaultsToDeny: boolean;
  /** Secondary line explaining the consequence, when the provider supplies one. */
  detail: string | null;
  /** Short noun phrase for the action, such as "Read file". */
  displayName: string;
  /** Path that triggered the request, when the tool is scoped to one. */
  path: string | null;
  sessionId: string;
  /** Provider-rendered prompt sentence, such as "Claude wants to read foo.txt". */
  title: string;
  toolName: string;
};

/**
 * How the user answered one tool permission request. A session-scoped allow also
 * stops the provider asking again for that tool for the rest of the session.
 */
export type ToolPermissionDecision =
  | { behavior: "allow"; scope: "once" | "session" }
  | { behavior: "deny" };

export type ToolPermissionHandler = (request: ToolPermissionRequest) => Promise<ToolPermissionDecision>;

/**
 * What a provider can actually be driven to do, rather than only read. Keeping
 * these separate stops one unimplemented action from gating the others.
 */
export type ProviderCapabilities = {
  deleteSessions: boolean;
  promptSessions: boolean;
  resumeSessions: boolean;
  startSessions: boolean;
};

/**
 * Drives live turns for one provider. Null on a provider that can only be read.
 */
export interface ProviderRuntimeClient {
  /** Selects the effort for future turns; null restores provider defaults. */
  setEffort(effort: string | null): void;
  deleteThread(threadId: string): Promise<unknown>;
  dispose(): void;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  resumeThread(threadId: string, cwd?: string): Promise<{ threadId: string }>;
  /**
   * Routes tool permission requests at the UI. Only implemented by providers
   * that gate tool use on an answer.
   */
  setToolPermissionHandler?(handler: ToolPermissionHandler | null): void;
  startThread(cwd?: string): Promise<{ sessionId: string; threadId: string }>;
  startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId: string }>;
  waitForTurnCompletion(threadId: string, turnId?: string): Promise<{ errorMessage?: string; status: string }>;
}

/**
 * Everything the app needs to render and drive one provider.
 */
export type ProviderProfile = {
  capabilities: ProviderCapabilities;
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
