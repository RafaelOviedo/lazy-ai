import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";

import { SessionAlreadyRunningError } from "../../entities/provider/index.js";
import { resolveExecutablePath } from "../../shared/lib/process/index.js";

import type {
  Options,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ProviderRuntimeClient, ToolPermissionHandler } from "../../entities/provider/index.js";
import type { ClaudeSdkClientOptions } from "./types.js";

type TurnCompletion = {
  errorMessage?: string;
  status: "completed" | "failed" | "interrupted" | "unknown";
  turnId: string;
};

type PendingTurn = {
  reject(error: Error): void;
  resolve(value: TurnCompletion): void;
  turnId: string;
};

/**
 * Feeds turns into one session. The SDK only exposes `interrupt()` and
 * `setPermissionMode()` in streaming-input mode, which requires the prompt to be
 * an async iterable rather than a string, so every session owns one of these.
 */
type SessionInputQueue = {
  end(): void;
  iterable: AsyncIterable<SDKUserMessage>;
  push(text: string): void;
};

type LiveSession = {
  allowedToolsForSession: Set<string>;
  completedTurns: TurnCompletion[];
  cwd: string | undefined;
  input: SessionInputQueue | null;
  /**
   * Re-issue timers per turn the user asked to interrupt, keyed by turn id.
   * Claude Code accepts an interrupt while still starting up but aborts nothing,
   * so the request is repeated until the turn actually ends.
   */
  interruptRetryTimers: Map<string, ReturnType<typeof setInterval>>;
  isResumed: boolean;
  nextTurnIndex: number;
  /** Turn ids awaiting a result, oldest first. Results arrive in turn order. */
  orderedTurnIds: string[];
  pendingTurns: Set<PendingTurn>;
  query: Query | null;
  sessionId: string;
  startFailure: Error | null;
};

const completedTurnHistoryLimit = 20;
const interruptRetryIntervalMs = 1500;
// Generous enough to outlast a cold Claude Code start, which can take ~20s and
// during which an interrupt aborts nothing. Retries stop as soon as the turn
// ends, so a high ceiling costs nothing on a warm session.
const interruptRetryLimit = 40;
const deniedByUserMessage = "The user declined this tool call in lazy-ai.";
const noApprovalSurfaceMessage = "lazy-ai has no approval surface attached, so this tool call was declined.";

/**
 * Resolved once per process. The user's own CLI is preferred over the copy the
 * SDK bundles so live sessions run the same Claude Code build as their
 * transcripts, but a machine without one still works on the bundled binary.
 */
let cachedExecutablePath: string | null | undefined;
let hasExecutableLaunchFailure = false;

/**
 * Drives live Claude Code sessions through the Claude Agent SDK.
 *
 * Unlike the Codex app-server, which multiplexes every thread over one process,
 * the SDK runs one `query()` per session and has no separate thread concept, so
 * a session id doubles as its thread id.
 */
export class ClaudeSdkClient implements ProviderRuntimeClient {
  private readonly model: string | null;
  private readonly canResumeSession: ClaudeSdkClientOptions["canResumeSession"];
  private readonly sessions = new Map<string, LiveSession>();
  private toolPermissionHandler: ToolPermissionHandler | null = null;
  private isDisposed = false;

  constructor(options: ClaudeSdkClientOptions = {}) {
    this.model = options.model ?? null;
    this.canResumeSession = options.canResumeSession;

    // Started here so the first turn does not pay for it. Resolving the binary
    // walks the whole PATH, and blocking `startTurn` on that delays the point at
    // which the turn becomes interruptible.
    void primeClaudeExecutablePath();
  }

  setToolPermissionHandler(handler: ToolPermissionHandler | null): void {
    this.toolPermissionHandler = handler;
  }

  /**
   * Reserves a session id without starting a process. Claude Code accepts the id
   * we choose, so the transcript path is known before the first turn runs and the
   * panels can poll for it immediately.
   */
  async startThread(cwd?: string): Promise<{ sessionId: string; threadId: string }> {
    this.assertNotDisposed();

    const sessionId = randomUUID();

    this.sessions.set(sessionId, this.createSessionRecord(sessionId, cwd, false));

    return { sessionId, threadId: sessionId };
  }

  /**
   * Re-attaches to a persisted session. Nothing is spawned until the first turn,
   * so the transcript is checked here rather than letting a missing session only
   * surface once the user has already typed a prompt.
   */
  async resumeThread(threadId: string, cwd?: string): Promise<{ threadId: string }> {
    this.assertNotDisposed();

    const existingSession = this.sessions.get(threadId);

    // No server-side lock exists here, so a live local process is the only
    // signal that something already holds this session.
    if (existingSession?.query) {
      throw new SessionAlreadyRunningError(`Claude Code session ${threadId} is already running in lazy-ai.`);
    }

    if (!(await this.isSessionResumable(threadId, cwd))) {
      throw new Error(`Claude Code session ${threadId} no longer has a transcript to resume.`);
    }

    this.sessions.set(threadId, this.createSessionRecord(threadId, cwd, true));

    return { threadId };
  }

  /**
   * A probe that cannot answer is treated as resumable, so a failed lookup never
   * blocks a resume that Claude Code itself would have accepted.
   */
  private async isSessionResumable(threadId: string, cwd?: string): Promise<boolean> {
    if (!this.canResumeSession) return true;

    try {
      return await this.canResumeSession(threadId, cwd);
    } catch {
      return true;
    }
  }

  /**
   * Sends one turn, starting the underlying query on first use.
   */
  async startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId: string }> {
    this.assertNotDisposed();

    // Tolerates a caller that never reserved the session, rather than throwing.
    const session = this.sessions.get(threadId) ?? this.createSessionRecord(threadId, cwd, true);
    this.sessions.set(threadId, session);

    if (cwd && !session.cwd) {
      session.cwd = cwd;
    }

    if (session.startFailure) {
      throw session.startFailure;
    }

    if (!session.query) {
      // Resolved here rather than at boot so the client never depends on a
      // priming call having happened first.
      await primeClaudeExecutablePath();
      this.beginQuery(session);
    }

    const turnId = `${session.sessionId}:${session.nextTurnIndex}`;
    session.nextTurnIndex += 1;
    session.orderedTurnIds.push(turnId);

    try {
      session.input?.push(prompt);
    } catch (error) {
      session.orderedTurnIds = session.orderedTurnIds.filter((id) => id !== turnId);
      throw this.toError(error, "Failed to send the prompt to Claude Code.");
    }

    return { turnId };
  }

  /**
   * Resolves when the turn finishes. Results are buffered because the caller may
   * only start waiting after the turn has already completed.
   */
  async waitForTurnCompletion(threadId: string, turnId?: string): Promise<TurnCompletion> {
    const session = this.sessions.get(threadId);

    if (!session) {
      return { status: "unknown", turnId: turnId ?? "" };
    }

    const completedTurn = this.findCompletedTurn(session, turnId);

    if (completedTurn) return completedTurn;

    if (session.startFailure) {
      throw session.startFailure;
    }

    return new Promise<TurnCompletion>((resolve, reject) => {
      session.pendingTurns.add({
        reject,
        resolve,
        turnId: turnId ?? "",
      });
    });
  }

  /**
   * Asks Claude Code to abandon the running turn. The turn still reports its own
   * outcome, so a late interrupt that misses the window is reported as completed
   * rather than pretended to be interrupted.
   */
  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    const session = this.sessions.get(threadId);

    if (!session?.query) {
      throw new Error("No running Claude Code turn to interrupt.");
    }

    await session.query.interrupt();

    // An interrupt accepted during startup aborts nothing, so keep asking until
    // the turn actually ends.
    this.scheduleInterruptRetries(session, turnId || session.orderedTurnIds[0] || "");
  }

  /**
   * Claude Code exposes no session deletion, and removing the transcript would
   * be lazy-ai destroying history on its own initiative.
   */
  async deleteThread(_threadId: string): Promise<unknown> {
    throw new Error("Deleting Claude Code sessions is not supported in lazy-ai.");
  }

  dispose(): void {
    this.isDisposed = true;
    this.toolPermissionHandler = null;

    for (const session of this.sessions.values()) {
      this.closeSession(session, new Error("Claude Code client disposed."));
    }

    this.sessions.clear();
  }

  private createSessionRecord(sessionId: string, cwd: string | undefined, isResumed: boolean): LiveSession {
    return {
      allowedToolsForSession: new Set<string>(),
      completedTurns: [],
      cwd,
      input: null,
      interruptRetryTimers: new Map<string, ReturnType<typeof setInterval>>(),
      isResumed,
      nextTurnIndex: 0,
      orderedTurnIds: [],
      pendingTurns: new Set<PendingTurn>(),
      query: null,
      sessionId,
      startFailure: null,
    };
  }

  /**
   * Starts the query and the loop that drains its messages.
   */
  private beginQuery(session: LiveSession): void {
    const input = createSessionInputQueue();

    session.input = input;
    session.query = query({
      prompt: input.iterable,
      options: this.buildQueryOptions(session),
    });

    void this.pumpSession(session);
  }

  private buildQueryOptions(session: LiveSession): Options {
    const options: Options = {
      cwd: session.cwd,
      canUseTool: (toolName, toolInput, toolOptions) => {
        return this.resolveToolPermission(session, toolName, toolInput, toolOptions);
      },
      // `default` is what makes Claude Code ask at all; a looser mode would skip
      // the approval modal entirely.
      permissionMode: "default",
      ...(session.isResumed ? { resume: session.sessionId } : { sessionId: session.sessionId }),
      // Omitted when unset so Claude Code applies its own configured default.
      ...(this.model ? { model: this.model } : {}),
    };

    if (cachedExecutablePath && !hasExecutableLaunchFailure) {
      options.pathToClaudeCodeExecutable = cachedExecutablePath;
    }

    return options;
  }

  /**
   * Drains one session's messages, resolving turns as their results arrive.
   */
  private async pumpSession(session: LiveSession): Promise<void> {
    const sessionQuery = session.query;

    if (!sessionQuery) return;

    try {
      for await (const message of sessionQuery as AsyncIterable<SDKMessage>) {
        if (message.type === "result") {
          this.recordTurnCompletion(session, message);
        }
      }

      // The generator ending without a result leaves nothing else to wait for.
      this.rejectPendingTurns(session, new Error("Claude Code ended the session before the turn completed."));
    } catch (error) {
      const failure = this.toError(error, "Claude Code failed while running the session.");

      // A bad custom executable is worth retiring for the rest of the process so
      // later sessions fall back to the binary the SDK bundles.
      if (this.isExecutableFailure(failure)) {
        hasExecutableLaunchFailure = true;
      }

      session.startFailure = failure;
      this.rejectPendingTurns(session, failure);
    } finally {
      session.input?.end();
      session.input = null;
      session.query = null;
    }
  }

  /**
   * Matches a result to the oldest turn still awaiting one. The SDK reports no
   * turn id, but streaming input produces exactly one result per turn in order.
   */
  /**
   * Repeats an interrupt request until the turn ends.
   *
   * Claude Code acknowledges an interrupt that arrives before it has begun
   * generating, but aborts nothing, and there is no message that reliably marks
   * the moment it becomes abortable. Re-asking on a short interval lands the
   * abort as soon as it can take effect instead of letting the turn run out.
   */
  private scheduleInterruptRetries(session: LiveSession, turnId: string): void {
    if (session.interruptRetryTimers.has(turnId)) return;

    let attempts = 0;

    const timer = setInterval(() => {
      attempts += 1;

      const isTurnStillRunning = session.orderedTurnIds[0] === turnId;

      if (!isTurnStillRunning || !session.query || attempts > interruptRetryLimit) {
        this.clearInterruptRetries(session, turnId);
        return;
      }

      void session.query.interrupt().catch(() => undefined);
    }, interruptRetryIntervalMs);

    session.interruptRetryTimers.set(turnId, timer);
  }

  private clearInterruptRetries(session: LiveSession, turnId?: string): void {
    const turnIds = turnId === undefined ? [...session.interruptRetryTimers.keys()] : [turnId];

    for (const pendingTurnId of turnIds) {
      const timer = session.interruptRetryTimers.get(pendingTurnId);

      if (!timer) continue;

      clearInterval(timer);
      session.interruptRetryTimers.delete(pendingTurnId);
    }
  }

  private recordTurnCompletion(session: LiveSession, message: SDKResultMessage): void {
    const turnId = session.orderedTurnIds.shift() ?? "";

    this.clearInterruptRetries(session, turnId);
    const completion: TurnCompletion = {
      ...this.readCompletionStatus(message),
      turnId,
    };

    // A finished turn means the transcript now exists, so if this session's
    // process later exits, the next turn has to resume it rather than try to
    // create the same session id a second time.
    session.isResumed = true;

    session.completedTurns.push(completion);
    session.completedTurns = session.completedTurns.slice(-completedTurnHistoryLimit);

    for (const pendingTurn of [...session.pendingTurns]) {
      if (pendingTurn.turnId && turnId && pendingTurn.turnId !== turnId) continue;

      session.pendingTurns.delete(pendingTurn);
      pendingTurn.resolve(completion);
    }
  }

  /**
   * Maps an SDK result onto the status vocabulary the session controllers use.
   * Aborts are checked first because an interrupted turn can still report the
   * `success` subtype.
   */
  private readCompletionStatus(message: SDKResultMessage): Omit<TurnCompletion, "turnId"> {
    if (message.terminal_reason === "aborted_streaming" || message.terminal_reason === "aborted_tools") {
      return { status: "interrupted" };
    }

    if (message.subtype === "success" && !message.is_error) {
      return { status: "completed" };
    }

    return {
      status: "failed",
      errorMessage: this.readResultErrorMessage(message),
    };
  }

  private readResultErrorMessage(message: SDKResultMessage): string | undefined {
    const result = "result" in message && typeof message.result === "string" ? message.result.trim() : "";

    if (result) return result;

    return message.subtype === "error_max_turns"
      ? "Claude Code stopped after reaching its turn limit."
      : undefined;
  }

  /**
   * Answers one tool permission request, asking the UI unless the user already
   * approved this tool for the session.
   */
  private async resolveToolPermission(
    session: LiveSession,
    toolName: string,
    toolInput: Record<string, unknown>,
    toolOptions: {
      blockedPath?: string;
      decisionReason?: string;
      defaultToNo?: boolean;
      description?: string;
      displayName?: string;
      signal: AbortSignal;
      suggestions?: PermissionUpdate[];
      suppressAlwaysAllowRule?: boolean;
      title?: string;
    },
  ): Promise<PermissionResult> {
    if (session.allowedToolsForSession.has(toolName)) {
      return { behavior: "allow", updatedInput: toolInput };
    }

    const handler = this.toolPermissionHandler;

    // Denying beats hanging the turn forever on an approval nothing can give.
    if (!handler || toolOptions.signal.aborted) {
      return { behavior: "deny", message: noApprovalSurfaceMessage };
    }

    // Claude Code marks the calls whose "always allow" rule would grant more
    // than the single action being asked about.
    const allowsSessionScope = toolOptions.suppressAlwaysAllowRule !== true
      && (toolOptions.suggestions?.length ?? 0) > 0;

    try {
      const decision = await handler({
        allowsSessionScope,
        defaultsToDeny: toolOptions.defaultToNo === true,
        detail: toolOptions.description ?? toolOptions.decisionReason ?? null,
        displayName: toolOptions.displayName ?? toolName,
        path: toolOptions.blockedPath ?? this.readInputPath(toolInput),
        sessionId: session.sessionId,
        title: toolOptions.title ?? `Claude Code wants to use ${toolName}`,
        toolName,
      });

      if (decision.behavior === "deny") {
        return { behavior: "deny", message: deniedByUserMessage };
      }

      // Honoured even if the UI offered the choice anyway, so a session-wide
      // rule is never written against Claude Code's own advice.
      if (decision.scope === "session" && allowsSessionScope) {
        session.allowedToolsForSession.add(toolName);

        // Passing the provider's own suggestions back is what stops it asking
        // again for this tool, rather than relying only on our local memo.
        return {
          behavior: "allow",
          updatedInput: toolInput,
          ...(toolOptions.suggestions ? { updatedPermissions: toolOptions.suggestions } : {}),
        };
      }

      return { behavior: "allow", updatedInput: toolInput };
    } catch {
      return { behavior: "deny", message: deniedByUserMessage };
    }
  }

  /**
   * Picks the most path-like field off a tool input for display.
   */
  private readInputPath(toolInput: Record<string, unknown>): string | null {
    for (const key of ["file_path", "path", "notebook_path", "command"]) {
      const value = toolInput[key];

      if (typeof value === "string" && value.trim()) return value.trim();
    }

    return null;
  }

  private findCompletedTurn(session: LiveSession, turnId?: string): TurnCompletion | null {
    return [...session.completedTurns].reverse().find((completion) => {
      return !turnId || !completion.turnId || completion.turnId === turnId;
    }) ?? null;
  }

  private closeSession(session: LiveSession, error: Error): void {
    this.clearInterruptRetries(session);
    this.rejectPendingTurns(session, error);
    session.input?.end();
    session.input = null;

    // Returning the generator is what shuts the underlying process down.
    void session.query?.return(undefined).catch(() => undefined);
    session.query = null;
  }

  private rejectPendingTurns(session: LiveSession, error: Error): void {
    for (const pendingTurn of session.pendingTurns) {
      pendingTurn.reject(error);
    }

    session.pendingTurns.clear();
    session.orderedTurnIds = [];
  }

  private isExecutableFailure(error: Error): boolean {
    return /executable|native binary/i.test(error.message);
  }

  private toError(error: unknown, fallbackMessage: string): Error {
    if (error instanceof Error) return error;

    return new Error(typeof error === "string" && error.trim() ? error : fallbackMessage);
  }

  private assertNotDisposed(): void {
    if (this.isDisposed) {
      throw new Error("Claude Code client is disposed.");
    }
  }
}

/**
 * Resolves the Claude Code binary once so every session agrees on which build to
 * run. Returning null is fine: the SDK then uses the copy it bundles.
 */
export async function primeClaudeExecutablePath(): Promise<string | null> {
  if (cachedExecutablePath !== undefined) return cachedExecutablePath;

  try {
    cachedExecutablePath = await resolveExecutablePath("claude");
  } catch {
    cachedExecutablePath = null;
  }

  return cachedExecutablePath;
}

/**
 * Builds the pushable async iterable the SDK consumes as streaming input.
 */
function createSessionInputQueue(): SessionInputQueue {
  const queuedMessages: SDKUserMessage[] = [];
  let deliverNext: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  let isEnded = false;

  const settleEnd = (): void => {
    const deliver = deliverNext;

    if (!deliver) return;

    deliverNext = null;
    deliver({ done: true, value: undefined });
  };

  return {
    end(): void {
      if (isEnded) return;

      isEnded = true;
      settleEnd();
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
        return {
          next(): Promise<IteratorResult<SDKUserMessage>> {
            const queuedMessage = queuedMessages.shift();

            if (queuedMessage) return Promise.resolve({ done: false, value: queuedMessage });
            if (isEnded) return Promise.resolve({ done: true, value: undefined });

            return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
              deliverNext = resolve;
            });
          },
          return(): Promise<IteratorResult<SDKUserMessage>> {
            isEnded = true;
            settleEnd();

            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
    push(text: string): void {
      if (isEnded) {
        throw new Error("Claude Code session input is closed.");
      }

      const message = {
        type: "user",
        message: { role: "user", content: [{ type: "text", text }] },
        parent_tool_use_id: null,
        session_id: "",
      } as unknown as SDKUserMessage;

      const deliver = deliverNext;

      if (deliver) {
        deliverNext = null;
        deliver({ done: false, value: message });
        return;
      }

      queuedMessages.push(message);
    },
  };
}
