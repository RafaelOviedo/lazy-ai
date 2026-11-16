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
 * What one piece of still-running background work is. Providers name their task
 * types differently, so each maps its own vocabulary onto these.
 */
export type BackgroundTaskKind = "subAgent" | "terminal" | "other";

/** One unit of work a provider is still running. */
export type BackgroundTask = {
  description: string;
  id: string;
  kind: BackgroundTaskKind;
};

/**
 * The complete set of a session's live background work, re-sent whenever that
 * set changes. Carrying the whole set rather than start/stop pairs means a
 * dropped event cannot wedge the UI on a task that has already finished.
 */
export type BackgroundActivityEvent = {
  sessionId: string;
  tasks: BackgroundTask[];
};

export type BackgroundActivityHandler = (event: BackgroundActivityEvent) => void;

/**
 * How much of a session's work is still outstanding, as the provider sees it.
 * This is coarser than the app's own run status and, crucially, outlasts it: a
 * provider can report a turn's result while still being `running`, because the
 * result was held back for background work or a follow-up turn is already
 * under way.
 */
export type ProviderSessionState = "idle" | "running" | "requiresAction";

export type SessionStateEvent = {
  sessionId: string;
  state: ProviderSessionState;
};

export type SessionStateHandler = (event: SessionStateEvent) => void;

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
 * One MCP server's connection state, reduced to the states both providers can
 * actually distinguish. Claude Code and Codex each report a richer vocabulary,
 * but only these survive the mapping in a way the UI can rely on.
 */
export type McpServerState =
  | "connected"
  | "connecting"
  | "failed"
  | "needs-auth"
  | "disabled"
  | "unknown";

export type McpServerTool = {
  name: string;
  description?: string;
  /** The server promises this tool makes no changes. */
  readOnly?: boolean;
  /** The server warns this tool can make destructive changes. */
  destructive?: boolean;
};

/**
 * One configured MCP server, flattened to what both providers can report.
 *
 * `tools` is empty until the server is connected: both runtimes start MCP
 * servers without blocking, so an early read shows "connecting" with nothing
 * in it and has to be re-read rather than taken as the final answer.
 */
export type McpServerInfo = {
  name: string;
  state: McpServerState;
  /** Where the server is configured, in the provider's own vocabulary. */
  scope?: string;
  /** stdio, http, sse, or a provider-specific transport label. */
  transport?: string;
  /** Host for remote servers; absent for stdio. */
  origin?: string;
  version?: string;
  error?: string;
  tools: McpServerTool[];
};

export type McpServerListOptions = {
  /**
   * A live session to read through, so the state reflects that session's own
   * connections rather than a detached probe.
   */
  threadId?: string;
  /**
   * Directory to resolve project-scoped MCP configuration against. Defaults to
   * wherever lazy-ai itself is running.
   */
  cwd?: string;
};

/**
 * What a reconnect actually touched. Claude Code reconnects the one server it
 * was given; Codex only exposes a reload of every configured server, and the
 * UI has to say so rather than imply the others were left alone.
 */
export type McpReconnectScope = "server" | "all";

export type McpReconnectResult = {
  scope: McpReconnectScope;
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
  /**
   * Reports work that outlives the turn which spawned it, such as sub-agents
   * and backgrounded shells. Only implemented by providers that announce it;
   * without it a turn's end is taken as the end of all its work.
   */
  setBackgroundActivityHandler?(handler: BackgroundActivityHandler | null): void;
  /**
   * Reports when the provider considers a session genuinely idle, rather than
   * merely done with the turn the app asked for. Only implemented by providers
   * that announce it; without it the turn's own result is all there is to go on.
   */
  setSessionStateHandler?(handler: SessionStateHandler | null): void;
  startThread(cwd?: string): Promise<{ sessionId: string; threadId: string }>;
  /** Returns the accepted turn's thinking level, or null if unresolved. */
  startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId: string; effort: string | null }>;
  waitForTurnCompletion(threadId: string, turnId?: string): Promise<{ errorMessage?: string; status: string }>;
  /**
   * Reports the MCP servers this provider has configured, with live connection
   * state where the provider exposes it. Only implemented by providers that can
   * be asked; without it the app has nothing to show.
   *
   * Reading through a live session reflects that session's own connections;
   * without one the provider may have to start a probe of its own.
   */
  listMcpServers?(options?: McpServerListOptions): Promise<McpServerInfo[]>;
  /**
   * Drops anything held only to answer `listMcpServers`, such as a probe
   * process started because no session was live. Safe to call when nothing is
   * held, and never closes a real session.
   */
  releaseMcpResources?(): void;
  /**
   * Reconnects one MCP server and resolves once the provider has accepted the
   * request. The server may still come up asynchronously afterwards, so the
   * caller should re-read rather than treat this as the final state.
   */
  reconnectMcpServer?(serverName: string, options?: McpServerListOptions): Promise<McpReconnectResult>;
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
