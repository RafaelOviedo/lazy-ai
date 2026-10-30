import type {
  BackgroundTask,
  ProviderRuntimeClient,
  ProviderSessionState,
  ToolPermissionHandler,
} from "../../entities/provider/index.js";
import type { SessionSummary } from "../../entities/session/index.js";

export type PendingSessionPrompt = {
  sessionId: string;
  submittedAt: string;
  text: string;
};

export type SessionRunStatus = "starting" | "thinking" | "awaitingApproval" | "completed" | "failed" | "interrupted";

export type SessionRunState = {
  session: SessionSummary;
  threadId: string;
  status: SessionRunStatus;
  busy: boolean;
  pendingPrompt: PendingSessionPrompt | null;
  /**
   * Work the provider is still running for this session. It outlives the turn
   * that spawned it, so this is tracked separately from `busy` rather than
   * folded into it: a session with sub-agents still working accepts a new
   * prompt, it just is not idle.
   */
  backgroundTasks: BackgroundTask[];
  /**
   * The provider's own view of the session, or null when it does not report
   * one. A provider can hand back a turn's result while still running, so this
   * is what says the work is really over.
   */
  providerState: ProviderSessionState | null;
};

/**
 * Names everything a session has in flight, most prominent first, or an empty
 * list when it is idle. These are separate strands of work that run at the same
 * time, so the model and its background tasks each get their own entry rather
 * than one of them hiding the other.
 */
export function describeRunActivity(state: SessionRunState | null): string[] {
  if (!state) return [];

  const segments: string[] = [];
  const modelSegment = readModelActivity(state);

  if (modelSegment) segments.push(modelSegment);

  const tasks = state.backgroundTasks;

  if (tasks.some((task) => task.kind === "subAgent")) segments.push("Sub-agents are working...");
  if (tasks.some((task) => task.kind === "terminal")) segments.push("Terminal tasks in process...");
  if (segments.length === 0 && tasks.length > 0) segments.push("Background tasks are working...");

  return segments;
}

/**
 * Says whether the provider reports work of its own past the turn the app is
 * waiting on. Claude Code hands a result back while sub-agents and background
 * shells carry on, so `busy` going false does not mean the session is done.
 */
export function hasWorkBeyondTurn(state: SessionRunState | null): boolean {
  return state?.providerState === "running" || state?.providerState === "requiresAction";
}

/**
 * Says whether anything at all is still running for the session, turn or not.
 */
function isSessionWorking(state: SessionRunState): boolean {
  return state.busy || hasWorkBeyondTurn(state);
}

/**
 * Says whether the model itself is still at work. `busy` only covers the turn
 * the app is waiting on, so a provider that reports itself as still running is
 * trusted beyond it: that is the case where the row used to disappear while
 * Claude Code was holding a result back or looping over background agents.
 */
function readModelActivity(state: SessionRunState): string | null {
  if (state.busy && state.status === "starting") return "Starting...";
  if (state.busy) return "Thinking...";

  return hasWorkBeyondTurn(state) ? "Thinking..." : null;
}

type Run = SessionRunState & {
  turnId: string | null;
  interruptRequested: boolean;
  interrupting: boolean;
  approvals: number;
  polling: boolean;
  timer: ReturnType<typeof setInterval> | null;
};

type Options = {
  client: Pick<ProviderRuntimeClient, "startThread" | "startTurn" | "interruptTurn" | "waitForTurnCompletion">;
  providerLabel: string;
  onChange(state: SessionRunState): void;
  onTurnFinished(sessionId: string, threadId: string): void;
  /** Called once the transcript has had its final reads, so live output can yield to it. */
  onTurnSettled?(sessionId: string): void;
  reportActionError(message: string): void;
  refreshUsageLimit(): void;
  syncSession(sessionId: string, projectPath: string): Promise<SessionSummary | null>;
  syncConversation(sessionId: string): Promise<void>;
};

/** Owns concurrent turns for one provider runtime, independently of the viewed session. */
export function createSessionRunController(options: Options) {
  const runs = new Map<string, Run>();
  let pendingStarts = 0;
  let disposed = false;

  function isCurrent(run: Run): boolean {
    return !disposed && runs.get(run.session.id) === run;
  }

  function publish(run: Run): void {
    if (!isCurrent(run)) return;
    const { session, threadId, status, busy, pendingPrompt, backgroundTasks, providerState } = run;
    options.onChange({ session, threadId, status, busy, pendingPrompt, backgroundTasks, providerState });
  }

  function stopPolling(run: Run): void {
    if (run.timer) clearInterval(run.timer);
    run.timer = null;
  }

  async function poll(run: Run): Promise<void> {
    if (!isCurrent(run) || run.polling) return;
    run.polling = true;
    try {
      // The view ignores other sessions; only the opened transcript is read.
      await options.syncConversation(run.session.id);
    } catch {
      // A transient transcript read must not terminate the provider's turn.
    } finally {
      run.polling = false;
    }
  }

  async function refreshSession(run: Run): Promise<void> {
    const session = await options.syncSession(run.session.id, run.session.projectPath);
    if (!isCurrent(run) || !session) return;
    // Keep the accepted level while providers finish flushing their history.
    run.session = { ...session, effort: run.session.effort !== undefined ? run.session.effort : session.effort };
    publish(run);
  }

  async function interruptRun(run: Run): Promise<boolean> {
    if (!isCurrent(run) || !run.busy) return false;
    if (!run.turnId) {
      if (run.status !== "starting" && run.status !== "awaitingApproval") return false;
      run.interruptRequested = true;
      return true;
    }
    if (run.interrupting) return true;
    run.interrupting = true;
    try {
      await options.client.interruptTurn(run.threadId, run.turnId);
      return true;
    } catch {
      if (isCurrent(run) && run.turnId) {
        run.interrupting = false;
        options.reportActionError(`Failed to interrupt ${options.providerLabel} session “${run.session.title}”.`);
      }
      return false;
    }
  }

  async function runTurn(session: SessionSummary, threadId: string, prompt: string): Promise<void> {
    const text = prompt.trim();
    if (disposed || !text || runs.get(session.id)?.busy) return;

    const run: Run = {
      session, threadId, status: "starting", busy: true,
      pendingPrompt: { sessionId: session.id, submittedAt: new Date().toISOString(), text },
      turnId: null, interruptRequested: false, interrupting: false,
      approvals: 0, polling: false, timer: null,
      // A new turn does not end work the previous one left running, and the
      // provider only re-reports the set when it changes.
      backgroundTasks: runs.get(session.id)?.backgroundTasks ?? [],
      providerState: runs.get(session.id)?.providerState ?? null,
    };
    runs.set(session.id, run);
    publish(run);
    let didStart = false;

    try {
      const { turnId, effort } = await options.client.startTurn(threadId, text, session.projectPath);
      didStart = true;
      if (!isCurrent(run)) return;
      run.turnId = turnId;
      run.session = { ...run.session, effort };
      run.status = run.approvals ? "awaitingApproval" : "thinking";
      publish(run);
      if (run.interruptRequested) void interruptRun(run);

      void poll(run);
      run.timer = setInterval(() => void poll(run), 1000);
      const completion = await options.client.waitForTurnCompletion(threadId, turnId);
      if (!isCurrent(run)) return;

      stopPolling(run);
      run.turnId = null;
      run.status = completion.status === "interrupted" ? "interrupted"
        : completion.status === "completed" ? "completed" : "failed";
      options.onTurnFinished(session.id, threadId);
      publish(run);
      if (run.status === "failed") {
        options.reportActionError(`${options.providerLabel} session “${run.session.title}”: ${completion.errorMessage ?? "Response failed."}`);
      }

      // Providers can flush their final transcript just after announcing completion.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await refreshSession(run);
        if (!isCurrent(run)) return;
        await options.syncConversation(session.id);
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
        if (!isCurrent(run)) return;
      }
    } catch (error) {
      if (!isCurrent(run)) return;
      run.turnId = null;
      run.status = "failed";
      options.onTurnFinished(session.id, threadId);
      options.reportActionError(`${options.providerLabel} session “${run.session.title}”: ${error instanceof Error ? error.message : "Failed to generate a response."}`);
    } finally {
      stopPolling(run);
      if (isCurrent(run)) {
        options.onTurnSettled?.(session.id);
        run.busy = false;
        run.pendingPrompt = null;
        publish(run);
        if (didStart) options.refreshUsageLimit();
      }
    }
  }

  async function startSession(prompt: string, projectPath: string, onStarted: (session: SessionSummary, threadId: string) => void): Promise<void> {
    const text = prompt.trim();

    if (disposed || !text) return;
    pendingStarts += 1;

    try {
      const { sessionId, threadId } = await options.client.startThread(projectPath);

      if (disposed) return;

      const session: SessionSummary = {
        id: sessionId, title: text.split("\n")[0].slice(0, 100),
        projectPath, projectName: projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath,
        updatedAt: new Date().toISOString(), relativeUpdated: "just now", model: "", status: "Saved",
      };

      // Publish a placeholder immediately, even before the provider writes its transcript.
      const completion = runTurn(session, threadId, text);
      onStarted(session, threadId);
      await completion;
    } catch (error) {
      if (!disposed) options.reportActionError(`Failed to start ${options.providerLabel} session. ${error instanceof Error ? error.message : ""}`);
    } finally {
      pendingStarts -= 1;
    }
  }

  function getState(sessionId: string): SessionRunState | null {
    return runs.get(sessionId) ?? [...runs.values()].find((run) => run.threadId === sessionId) ?? null;
  }

  function forgetSession(sessionId: string): void {
    const run = runs.get(sessionId);
    if (run?.busy) return;
    runs.delete(sessionId);
  }

  /** Providers key their reports by thread id on sessions whose two ids differ. */
  function findRun(sessionId: string): Run | null {
    const run = runs.get(sessionId) ?? [...runs.values()].find((candidate) => candidate.threadId === sessionId);

    return run && isCurrent(run) ? run : null;
  }

  /**
   * Replaces what the provider says is still running for one session.
   */
  function setBackgroundTasks(sessionId: string, tasks: BackgroundTask[]): void {
    const run = findRun(sessionId);

    if (!run) return;
    if (run.backgroundTasks.length === 0 && tasks.length === 0) return;

    run.backgroundTasks = tasks;
    publish(run);
  }

  /** Records the provider's own idle/running view for one session. */
  function setProviderState(sessionId: string, providerState: ProviderSessionState): void {
    const run = findRun(sessionId);

    if (!run || run.providerState === providerState) return;

    run.providerState = providerState;
    publish(run);
  }

  function isBusy(sessionId: string): boolean {
    return runs.get(sessionId)?.busy ?? false;
  }

  function hasOngoingTurn(): boolean {
    return pendingStarts > 0 || [...runs.values()].some((run) => run.busy);
  }

  async function interruptSession(sessionId: string): Promise<boolean> {
    const run = runs.get(sessionId);
    return run ? interruptRun(run) : false;
  }

  async function requestToolPermission(request: Parameters<ToolPermissionHandler>[0], handler: ToolPermissionHandler) {
    if (disposed) return { behavior: "deny" } as const;

    const run = [...runs.values()].find((candidate) => candidate.threadId === request.sessionId || candidate.session.id === request.sessionId);

    // A late request must not resurrect a session that has stopped, but a turn
    // ending is not that: Claude Code hands its result back while sub-agents
    // and background shells carry on, and the tool calls they make arrive after
    // `busy` has gone. Denying those declined work the user never saw asked
    // about. The provider's own state is what says the session is really over.
    if (run && (!isSessionWorking(run) || run.status === "interrupted")) {
      return { behavior: "deny" } as const;
    }

    if (run && isCurrent(run)) {
      run.approvals += 1;
      run.status = "awaitingApproval";
      publish(run);
    }

    try {
      return await handler(request);
    } finally {
      if (run && isCurrent(run) && run.status === "awaitingApproval") {
        run.approvals -= 1;
        if (!run.approvals) run.status = run.turnId ? "thinking" : "starting";
        publish(run);
      }
    }
  }

  function dispose(): void {
    disposed = true;
    for (const run of runs.values()) stopPolling(run);
    runs.clear();
  }

  return {
    startSession,
    getState,
    forgetSession,
    isBusy,
    hasOngoingTurn,
    interruptSession,
    requestToolPermission,
    setBackgroundTasks,
    setProviderState,
    dispose,
    promptSession: runTurn
  };
}
