import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";

import { SessionAlreadyRunningError } from "../../entities/provider/index.js";
import { resolveExecutablePath } from "../../shared/lib/process/index.js";
import { parseClaudeEffort } from "./claude-effort.js";
import { claudePermissionMode, planFinishedMessage, type AgentMode, type ModeAvailability } from "../../entities/provider/model/agent-mode.js";
import { parseClaudeQuestions } from "./claude-questions.js";

import type {
  Options,
  EffortLevel,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKBackgroundTasksChangedMessage,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  BackgroundActivityHandler,
  BackgroundTask,
  BackgroundTaskKind,
  LiveConversationHandler,
  ProviderRuntimeClient,
  ToolPermissionHandler,
} from "../../entities/provider/index.js";
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
  mode: AgentMode;
  effort: EffortLevel | null;
  pumpPromise: Promise<void> | null;
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
/**
 * Claude Code's raw task discriminants, which are what
 * `background_tasks_changed` carries. Anything unrecognised still counts as
 * activity, so an added task type keeps the indicator honest instead of
 * silently disappearing from it.
 */
const backgroundTaskKinds: Record<string, BackgroundTaskKind> = {
  local_agent: "subAgent",
  subagent: "subAgent",
  local_bash: "terminal",
  shell: "terminal",
};

function readBackgroundTaskKind(taskType: string | undefined): BackgroundTaskKind {
  return (taskType && backgroundTaskKinds[taskType]) || "other";
}

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
  private mode: AgentMode = "manual";
  private modeUnavailable: ModeAvailability = {};
  private modeNoticeHandler: ((message: string) => void) | null = null;
  private readonly model: string | null;
  private effort: EffortLevel | null;
  private readonly canResumeSession: ClaudeSdkClientOptions["canResumeSession"];
  private readonly sessions = new Map<string, LiveSession>();
  private toolPermissionHandler: ToolPermissionHandler | null = null;
  private liveConversationHandler: LiveConversationHandler | null = null;
  private backgroundActivityHandler: BackgroundActivityHandler | null = null;
  private isDisposed = false;

  constructor(options: ClaudeSdkClientOptions = {}, private readonly createQuery: typeof query = query) {
    this.model = options.model ?? null;
    this.effort = parseClaudeEffort(options.effort ?? null);
    this.canResumeSession = options.canResumeSession;

    // Started here so the first turn does not pay for it. Resolving the binary
    // walks the whole PATH, and blocking `startTurn` on that delays the point at
    // which the turn becomes interruptible.
    void primeClaudeExecutablePath();
  }

  setEffort(effort: string | null): void {
    this.effort = parseClaudeEffort(effort);
  }

  async setMode(mode: AgentMode): Promise<void> {
    if (this.mode === mode) return;
    if ([...this.sessions.values()].some((session) => session.orderedTurnIds.length)) {
      throw new Error("Wait for all responses to finish before changing mode.");
    }
    // Closing the query clears provider-side session grants as well as our memo.
    // Transcripts remain available and are resumed with the new policy.
    for (const session of this.sessions.values()) {
      if (session.query) {
        session.input?.end();
        await session.query.return(undefined);
        await session.pumpPromise;
      }
      session.allowedToolsForSession.clear();
      session.startFailure = null;
    }
    this.mode = mode;
  }

  async getModeAvailability(): Promise<ModeAvailability> { return { ...this.modeUnavailable }; }

  setModeNoticeHandler(handler: ((message: string) => void) | null): void {
    this.modeNoticeHandler = handler;
  }

  setToolPermissionHandler(handler: ToolPermissionHandler | null): void {
    this.toolPermissionHandler = handler;
  }

  setLiveConversationHandler(handler: LiveConversationHandler | null): void {
    this.liveConversationHandler = handler;
  }

  setBackgroundActivityHandler(handler: BackgroundActivityHandler | null): void {
    this.backgroundActivityHandler = handler;
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
  async startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId: string; effort: string | null }> {
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

    if (session.query && session.effort !== this.effort) {
      // Reopen the same saved session with fresh launch options. In particular,
      // omitting effort restores user/project defaults; applyFlagSettings(null)
      // would restore only the model default and ignore configured preferences.
      session.input?.end();
      await session.query.return(undefined);
      await session.pumpPromise;
      session.startFailure = null;
      this.assertNotDisposed();
    }

    if (!session.query) {
      // Resolved here rather than at boot so the client never depends on a
      // priming call having happened first.
      await primeClaudeExecutablePath();
      this.beginQuery(session);
    }

    // A rejected Auto selection must not quietly run a Manual turn instead.
    try {
      await session.query!.setPermissionMode(claudePermissionMode(this.mode));
      session.mode = this.mode;
    } catch (error) {
      const message = `Claude Code could not activate ${this.mode}: ${error instanceof Error ? error.message : String(error)}`;
      if (this.mode === "auto") this.modeUnavailable.auto = message;
      this.modeNoticeHandler?.(message);
      throw new Error(message);
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

    return { turnId, effort: session.effort };
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
    this.liveConversationHandler = null;
    this.backgroundActivityHandler = null;

    for (const session of this.sessions.values()) {
      this.closeSession(session, new Error("Claude Code client disposed."));
    }

    this.sessions.clear();
  }

  private createSessionRecord(sessionId: string, cwd: string | undefined, isResumed: boolean): LiveSession {
    return {
      mode: this.mode,
      effort: this.effort,
      pumpPromise: null,
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
    session.mode = this.mode;
    session.effort = this.effort;
    session.query = this.createQuery({
      prompt: input.iterable,
      options: this.buildQueryOptions(session),
    });

    // Nothing is emitted at startup, so the previous process's tasks have to be
    // dropped here rather than waiting for a change that may never come.
    this.emitBackgroundActivity(session, []);
    session.pumpPromise = this.pumpSession(session);
  }

  private buildQueryOptions(session: LiveSession): Options {
    const options: Options = {
      cwd: session.cwd,
      canUseTool: (toolName, toolInput, toolOptions) => {
        return this.resolveToolPermission(session, toolName, toolInput, toolOptions);
      },
      permissionMode: claudePermissionMode(session.mode),
      ...(session.mode === "plan" ? { planModeInstructions: "Explore using read-only tools and return the complete plan directly in your final response. Do not edit source files. The user reviews the plan and selects an implementation mode in Lazy AI before sending another prompt." } : {}),
      // Let the host surface questions and enforce a deliberate exit from Plan.
      hooks: {
        PreToolUse: [{ hooks: [async (input) => {
          if (input.hook_event_name !== "PreToolUse") return {};
          if (input.tool_name === "ExitPlanMode") {
            return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: planFinishedMessage } };
          }
          if (input.tool_name === "EnterPlanMode" || input.tool_name === "AskUserQuestion") {
            return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" } };
          }
          return {};
        }] }],
      },
      // Without this the SDK only yields whole messages, so nothing is shown
      // until a block is finished.
      includePartialMessages: true,
      ...(session.isResumed ? { resume: session.sessionId } : { sessionId: session.sessionId }),
      // Omitted when unset so Claude Code applies its own configured default.
      ...(this.model ? { model: this.model } : {}),
      ...(this.effort ? { effort: this.effort } : {}),
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
      const stream = { text: "" };

      for await (const message of sessionQuery as AsyncIterable<SDKMessage>) {
        if (message.type === "system" && "permissionMode" in message && message.permissionMode
          && message.permissionMode !== claudePermissionMode(session.mode)) {
          const notice = `Claude Code reports ${message.permissionMode} instead of ${session.mode}. Select a supported mode with f before continuing.`;
          this.modeNoticeHandler?.(notice);
          if (session.mode === "auto") this.modeUnavailable.auto = notice;
          // Do not continue generating with a mode different from the user's choice.
          void sessionQuery.interrupt().catch(() => undefined);
        }
        if (message.type === "system" && message.subtype === "background_tasks_changed") {
          this.emitBackgroundActivity(session, message.tasks);
          continue;
        }
        if (message.type === "result") {
          stream.text = "";
          this.recordTurnCompletion(session, message);
        } else {
          this.emitLiveMessage(session, message, stream);
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
      this.emitBackgroundActivity(session, []);
    }
  }

  /**
   * Forwards assistant output the moment the SDK yields it. Claude Code only
   * appends to its transcript once a block is finished, so reading that file is
   * always behind what the stream already knows.
   */
  private emitLiveMessage(session: LiveSession, message: SDKMessage, stream: { text: string }): void {
    const handler = this.liveConversationHandler;

    if (!handler) return;

    // Subagent traffic belongs to a tool call, not to the visible conversation.
    if ("parent_tool_use_id" in message && message.parent_tool_use_id) return;

    try {
      if (message.type === "stream_event") {
        const event = message.event;

        if (event.type === "message_start") {
          stream.text = "";
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          stream.text += event.delta.text;
          handler({ sessionId: session.sessionId, type: "stream", text: stream.text });
        }

        return;
      }

      if (message.type !== "assistant") return;

      stream.text = "";

      const text = this.readAssistantText(message.message.content);

      handler({
        sessionId: session.sessionId,
        type: "message",
        message: text
          ? { id: message.uuid, role: "assistant", text, timestamp: new Date().toISOString() }
          : null,
      });
    } catch {
      // A display listener must never take down the pump that settles turns.
    }
  }

  /**
   * Reports the background work Claude Code still has running, so the UI can
   * keep showing activity after the turn that spawned it has already settled.
   *
   * Claude Code sends the whole live set on every change, so this replaces
   * rather than merges. Ambient entries are housekeeping the SDK asks hosts to
   * keep out of activity indicators.
   */
  private emitBackgroundActivity(session: LiveSession, tasks: SDKBackgroundTasksChangedMessage["tasks"]): void {
    const handler = this.backgroundActivityHandler;

    if (!handler) return;

    try {
      handler({
        sessionId: session.sessionId,
        tasks: tasks
          .filter((task) => !task.ambient)
          .map((task): BackgroundTask => ({
            description: task.description,
            id: task.task_id,
            kind: readBackgroundTaskKind(task.task_type),
          })),
      });
    } catch {
      // A display listener must never take down the pump that settles turns.
    }
  }

  private readAssistantText(content: unknown): string {
    if (!Array.isArray(content)) return "";

    return content
      .map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
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
    if (toolName === "ExitPlanMode") return { behavior: "deny", message: planFinishedMessage };
    if (toolName === "EnterPlanMode") return { behavior: "deny", message: "Ask the user to select Plan with f in Lazy AI after this turn finishes." };
    if (toolName === "AskUserQuestion") {
      const questions = parseClaudeQuestions(toolInput.questions);
      if (!questions.length || !this.toolPermissionHandler || toolOptions.signal.aborted) {
        return { behavior: "deny", message: "No answer available. Ask the user in your response." };
      }
      const decision = await this.toolPermissionHandler({
        questions, signal: toolOptions.signal, sessionId: session.sessionId,
        allowsSessionScope: false, defaultsToDeny: true, detail: null, displayName: "Answer questions",
        path: null, title: "Claude Code needs your input", toolName,
      });
      if (decision.behavior !== "allow" || !decision.answers) return { behavior: "deny", message: deniedByUserMessage };
      const answers = Object.fromEntries(questions.map((question) => [question.question, (decision.answers![question.id] ?? []).join(", ")]));
      return { behavior: "allow", updatedInput: { ...toolInput, answers } };
    }
    // Plan-mode writes fall through to canUseTool even with old allow rules.
    // Never let an earlier session grant or the approval modal authorize them.
    if (session.mode === "plan") {
      return { behavior: "deny", message: "This action requires permission and is unavailable in Plan. Continue with read-only exploration and present a plan." };
    }
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
        signal: toolOptions.signal,
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
