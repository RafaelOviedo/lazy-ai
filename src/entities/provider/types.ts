import type { ProjectReader } from "../project";
import type { ConversationMessage, SessionReader } from "../session";
import type { AgentMode, ModeAvailability } from "./model/agent-mode.js";

export type AgentQuestion = {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
  multiSelect?: boolean;
  allowOther?: boolean;
  isSecret?: boolean;
};

export type ProviderId = "claude-code" | "codex";

/**
 * One tool call a provider is asking permission to run.
 */
export type ToolPermissionRequest = {
  questions?: AgentQuestion[];
  signal?: AbortSignal;
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
  | { behavior: "allow"; scope: "once" | "session"; answers?: Record<string, string[]> }
  | { behavior: "deny" };

export type ToolPermissionHandler = (request: ToolPermissionRequest) => Promise<ToolPermissionDecision>;

/**
 * Output a provider produces mid-turn, delivered before it reaches the on-disk
 * transcript. The transcript stays authoritative: a panel drops these once the
 * turn settles, so ids only need to be stable within one turn.
 */
export type LiveConversationEvent =
  /** Full text of the assistant message currently being generated. */
  | { sessionId: string; type: "stream"; text: string }
  /** A finished assistant message; null when it carried no readable text. */
  | { sessionId: string; type: "message"; message: ConversationMessage | null };

export type LiveConversationHandler = (event: LiveConversationEvent) => void;

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
  setMode(mode: AgentMode): Promise<void>;
  getModeAvailability(): Promise<ModeAvailability>;
  setModeNoticeHandler?(handler: ((message: string) => void) | null): void;
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
  /**
   * Streams assistant output as it is generated. Only implemented by providers
   * that expose it; others rely on re-reading the transcript.
   */
  setLiveConversationHandler?(handler: LiveConversationHandler | null): void;
  startThread(cwd?: string): Promise<{ sessionId: string; threadId: string }>;
  /** Returns the accepted turn's thinking level, or null if unresolved. */
  startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId: string; effort: string | null }>;
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
