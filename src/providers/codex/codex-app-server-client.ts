import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

import { SessionAlreadyRunningError } from "../../entities/provider/index.js";
import { requiresShellToSpawn, resolveExecutablePath } from "../../shared/lib/process/index.js";

import type {
  ToolPermissionDecision,
  ToolPermissionHandler,
  ToolPermissionRequest,
} from "../../entities/provider/index.js";
import type {
  CodexAppServerClientOptions,
  CodexApprovalDecision,
  CodexCommandExecutionApprovalParams,
  CodexFileChangeApprovalParams,
  CodexItemStartedNotification,
  CodexOfferedApprovalDecision,
  CodexServerRequestResolvedNotification,
} from "./types.js";

type JsonRpcRequest = {
  id: number;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

/**
 * A reply to a request Codex sent us. Its id has to echo Codex's own, which is
 * numbered on a counter separate from the one we use for our requests.
 */
type JsonRpcResponse = {
  error?: {
    code: number;
    message: string;
  };
  id: number | string;
  result?: unknown;
};

/**
 * Anything arriving on stdout, before it is known to be a response, a
 * notification, or a request Codex expects us to answer.
 */
type IncomingMessage = {
  error?: {
    code?: number;
    message?: string;
  };
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
};

/**
 * One request from Codex that is waiting on an answer.
 */
type PendingServerRequest = {
  /** Answers with the narrowest "no" the request's response shape allows. */
  decline(): void;
  /** Abandons the request because Codex reported it settled elsewhere. */
  discard(): void;
  respond(result: unknown): void;
};

type PendingRequest = {
  method: string;
  reject(error: Error): void;
  resolve(value: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingTurnCompletion = {
  reject(error: Error): void;
  resolve(value: CodexAppServerTurnCompletionResult): void;
  threadId: string;
  /** Re-armed while the thread waits on an approval, so unset between arms. */
  timer?: ReturnType<typeof setTimeout>;
  turnId?: string;
};

export type CodexAppServerResumeResult = {
  threadId: string;
};

export type CodexAppServerDeleteResult = {
  threadId: string;
};

export type CodexAppServerStartResult = {
  sessionId: string;
  threadId: string;
};

export type CodexAppServerTurnStartResult = {
  turnId: string;
};

export type CodexAppServerTurnCompletionResult = {
  errorMessage?: string;
  status: "completed" | "failed" | "interrupted" | "unknown";
  threadId: string;
  turnId?: string;
};

type ThreadResumeResponse = {
  reasoningEffort?: string | null;
  model?: string;
  thread?: {
    id?: string;
    sessionId?: string;
  };
};

type ThreadStartResponse = {
  reasoningEffort?: string | null;
  model?: string;
  thread?: {
    id?: string;
    sessionId?: string;
  };
};

type TurnStartResponse = {
  turn?: {
    id?: string;
  };
};

type TurnCompletedNotification = {
  threadId?: string;
  turn?: {
    error?: {
      message?: string;
    } | null;
    id?: string;
    status?: string;
  };
};

/**
 * Mirrors the Claude Code client pinning `permissionMode: "default"`: the
 * in-terminal approval modal is the point of lazy-ai, so Codex is asked to route
 * escalations here rather than follow whatever the local config would have done.
 */
const approvalPolicy = "on-request";
const jsonRpcMethodNotFoundCode = -32601;
// File-change items are announced far more often than they are asked about, so
// the path cache is trimmed rather than left to grow for the whole process.
const fileChangeItemCacheLimit = 200;

export class CodexAppServerClient {
  private readonly model: string | null;
  private effort: string | null;
  private readonly threadEfforts = new Map<string, {
    defaultEffort: string | null;
    model: string | null;
    overridden: boolean;
  }>();
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: ReadlineInterface | null = null;
  private initializePromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private pendingTurnCompletions = new Set<PendingTurnCompletion>();
  private pendingServerRequests = new Map<string, PendingServerRequest>();
  /** Outstanding approval count per thread, so a blocked turn is not timed out. */
  private pendingApprovalsByThread = new Map<string, number>();
  /** Changed paths per file-change item id, for the approval prompt to show. */
  private fileChangePathsByItemId = new Map<string, string[]>();
  private toolPermissionHandler: ToolPermissionHandler | null = null;
  private completedTurns: CodexAppServerTurnCompletionResult[] = [];
  private stderrLines: string[] = [];

  constructor(options: CodexAppServerClientOptions = {}) {
    this.model = options.model ?? null;
    this.effort = options.effort ?? null;
  }

  setEffort(effort: string | null): void {
    this.effort = effort;
  }

  setToolPermissionHandler(handler: ToolPermissionHandler | null): void {
    this.toolPermissionHandler = handler;
  }

  async resumeThread(threadId: string, cwd?: string): Promise<CodexAppServerResumeResult> {
    await this.initialize();

    const result = await this.request<ThreadResumeResponse>("thread/resume", {
      threadId,
      cwd,
      approvalPolicy,
      serviceName: "lazy-ai",
      ...(this.model ? { model: this.model } : {}),
    });

    const resumedId = result.thread?.id ?? result.thread?.sessionId ?? threadId;
    this.rememberThreadEffort(resumedId, result);
    return {
      threadId: resumedId,
    };
  }

  async deleteThread(threadId: string): Promise<CodexAppServerDeleteResult> {
    await this.initialize();

    await this.request<Record<string, never>>("thread/delete", {
      threadId,
    });

    return {
      threadId,
    };
  }

  async startThread(cwd?: string): Promise<CodexAppServerStartResult> {
    await this.initialize();

    const result = await this.request<ThreadStartResponse>("thread/start", {
      cwd,
      approvalPolicy,
      historyMode: "legacy",
      serviceName: "lazy-ai",
      // Omitted entirely when unset so Codex applies its own configured default.
      ...(this.model ? { model: this.model } : {}),
    });

    const threadId = result.thread?.id;

    if (!threadId) {
      throw new Error("Codex app-server did not return a thread id.");
    }

    this.rememberThreadEffort(threadId, result);
    return {
      threadId,
      sessionId: result.thread?.sessionId ?? threadId,
    };
  }

  async startTurn(threadId: string, prompt: string, cwd?: string): Promise<CodexAppServerTurnStartResult> {
    await this.initialize();

    const effort = this.effort;
    const threadEffort = this.threadEfforts.get(threadId);
    // turn/start effort is sticky. Save the original provider choice before the
    // first override so selecting Default can restore it on this same thread.
    if (threadEffort && effort && !threadEffort.defaultEffort) {
      const config = await this.request<{ config?: { model_reasoning_effort?: string | null } }>("config/read", { cwd });

      threadEffort.defaultEffort = config.config?.model_reasoning_effort ?? null;

      if (!threadEffort.defaultEffort) {
        let cursor: string | null = null;
        do {
          const models: { data: { model: string; defaultReasoningEffort: string }[]; nextCursor?: string | null }
            = await this.request("model/list", { cursor });
          threadEffort.defaultEffort = models.data.find((model) => model.model === threadEffort.model)?.defaultReasoningEffort ?? null;
          cursor = models.nextCursor ?? null;
        } while (!threadEffort.defaultEffort && cursor);
      }

      if (!threadEffort.defaultEffort) throw new Error("Codex did not report a default thinking level for this model.");
    }
    const turnEffort = effort ?? (threadEffort?.overridden ? threadEffort.defaultEffort : null);
    const result = await this.request<TurnStartResponse>("turn/start", {
      threadId,
      input: [{
        type: "text",
        text: prompt,
        text_elements: [],
      }],
      cwd,
      ...(this.model ? { model: this.model } : {}),
      ...(turnEffort ? { effort: turnEffort } : {}),
    });

    const turnId = result.turn?.id;

    if (!turnId) {
      throw new Error("Codex app-server did not return a turn id.");
    }

    if (threadEffort) threadEffort.overridden = effort !== null;
    return {
      turnId,
    };
  }

  private rememberThreadEffort(threadId: string, result: ThreadStartResponse | ThreadResumeResponse): void {
    if (this.threadEfforts.has(threadId)) return;

    this.threadEfforts.set(threadId, {
      defaultEffort: result.reasoningEffort ?? null,
      model: result.model ?? this.model,
      overridden: false,
    });
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.initialize();

    await this.request<Record<string, never>>("turn/interrupt", {
      threadId,
      turnId,
    });
  }

  async waitForTurnCompletion(threadId: string, turnId?: string, timeoutMs = 300000): Promise<CodexAppServerTurnCompletionResult> {
    await this.initialize();

    const completedTurn = this.findCompletedTurn(threadId, turnId);

    if (completedTurn) return completedTurn;

    return new Promise<CodexAppServerTurnCompletionResult>((resolve, reject) => {
      const waiter: PendingTurnCompletion = {
        reject,
        resolve,
        threadId,
        turnId,
      };

      // A turn stops making progress while it waits on an approval, so the clock
      // is restarted rather than allowed to fail a turn the user is still
      // reading. Nothing else can stall this long without the process dying.
      const armTimeout = (): void => {
        waiter.timer = setTimeout(() => {
          if (this.hasPendingApprovals(threadId)) {
            armTimeout();
            return;
          }

          this.pendingTurnCompletions.delete(waiter);
          reject(new Error("Timed out waiting for Codex turn completion."));
        }, timeoutMs);
      };

      armTimeout();
      this.pendingTurnCompletions.add(waiter);
    });
  }

  dispose(): void {
    this.threadEfforts.clear();
    // Answered before the process goes away so Codex is never left waiting on a
    // prompt nothing can show any more.
    this.declinePendingServerRequests();
    this.toolPermissionHandler = null;
    this.pendingApprovalsByThread.clear();
    this.fileChangePathsByItemId.clear();

    this.rejectPendingRequests(new Error("Codex app-server client disposed."));
    this.rejectPendingTurnCompletions(new Error("Codex app-server client disposed."));

    this.stdoutReader?.close();
    this.stdoutReader = null;

    if (this.process && !this.process.killed) {
      this.process.kill();
    }

    this.process = null;
    this.initializePromise = null;
  }

  private initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeProcess().catch((error: unknown) => {
        this.initializePromise = null;
        throw error;
      });
    }

    return this.initializePromise;
  }

  private async initializeProcess(): Promise<void> {
    await this.startProcess();

    await this.request("initialize", {
      clientInfo: {
        name: "lazy-ai",
        title: "Lazy AI",
        version: "0.0.1",
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    this.notify({
      method: "initialized",
      params: {},
    });
  }

  private async startProcess(): Promise<void> {
    if (this.process && !this.process.killed) return;

    // Prefer the resolved path: an npm-installed Codex is a `codex.cmd` shim,
    // which CreateProcess cannot launch, so those have to go via the shell.
    // Falling back to the bare name lets the OS resolve it if PATH lookup missed.
    const executable = await resolveExecutablePath("codex") ?? "codex";
    const useShell = requiresShellToSpawn(executable);
    const command = useShell ? `"${executable}"` : executable;

    const appServerProcess = spawn(command, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: useShell,
    });

    this.process = appServerProcess;
    this.stderrLines = [];

    this.stdoutReader = createInterface({
      input: appServerProcess.stdout,
    });

    this.stdoutReader.on("line", (line) => this.handleStdoutLine(line));
    appServerProcess.stderr.on("data", (chunk: Buffer) => this.recordStderr(chunk));
    appServerProcess.on("error", (error) => this.handleProcessError(error));
    appServerProcess.on("exit", (code, signal) => this.handleProcessExit(code, signal));
  }

  private request<T>(method: string, params?: unknown, timeoutMs = 15000): Promise<T> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Codex app-server request "${method}" timed out.`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        method,
        reject,
        resolve: (value) => resolve(value as T),
        timer,
      });

      try {
        this.send({
          id: requestId,
          method,
          params,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(notification: JsonRpcNotification): void {
    this.send(notification);
  }

  private send(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    if (!this.process?.stdin.writable) {
      throw new Error("Codex app-server is not available.");
    }

    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleStdoutLine(line: string): void {
    let message: IncomingMessage;

    try {
      message = JSON.parse(line) as IncomingMessage;
    } catch {
      return;
    }

    // A request Codex sends us carries a method *and* an id, and those ids come
    // off Codex's own counter starting at zero, so they overlap the ids of our
    // requests and have to be routed on the method before the response lookup.
    if (typeof message.method === "string") {
      if (message.id === undefined || message.id === null) {
        this.handleNotification({ method: message.method, params: message.params });
        return;
      }

      this.handleServerRequest(message.id, message.method, message.params);
      return;
    }

    if (typeof message.id !== "number") return;

    const pendingRequest = this.pendingRequests.get(message.id);

    if (!pendingRequest) return;

    clearTimeout(pendingRequest.timer);
    this.pendingRequests.delete(message.id);

    if (message.error) {
      const responseError = this.formatResponseError(pendingRequest.method, message.error);

      if (this.isActiveWriterError(message.error)) {
        pendingRequest.reject(new SessionAlreadyRunningError(responseError));
        return;
      }

      pendingRequest.reject(new Error(responseError));
      return;
    }

    pendingRequest.resolve(message.result);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === "item/started") {
      this.recordFileChangeItem(notification.params);
      return;
    }

    if (notification.method === "serverRequest/resolved") {
      this.discardResolvedServerRequest(notification.params);
      return;
    }

    if (notification.method !== "turn/completed") return;

    const completion = this.readTurnCompletedNotification(notification.params);

    if (!completion) return;

    this.completedTurns.push(completion);
    this.completedTurns = this.completedTurns.slice(-20);

    for (const waiter of this.pendingTurnCompletions) {
      if (!this.matchesTurnCompletion(waiter, completion)) continue;

      clearTimeout(waiter.timer);
      this.pendingTurnCompletions.delete(waiter);
      waiter.resolve(completion);
    }
  }

  /**
   * Answers one request Codex sent us. The turn it belongs to stays blocked
   * until a response arrives, so every branch here has to write one.
   *
   * Codex's older `execCommandApproval` and `applyPatchApproval` requests are
   * deliberately absent: a server old enough to send them predates the
   * `thread/*` API this client drives, so it could never get this far.
   */
  private handleServerRequest(requestId: number | string, method: string, params: unknown): void {
    switch (method) {
      case "item/commandExecution/requestApproval":
        void this.resolveCommandApproval(requestId, params as CodexCommandExecutionApprovalParams | undefined);
        return;
      case "item/fileChange/requestApproval":
        void this.resolveFileChangeApproval(requestId, params as CodexFileChangeApprovalParams | undefined);
        return;
      // Asks lazy-ai has no prompt for yet. Each is answered with the narrowest
      // "no" its response shape allows, so the turn moves on instead of hanging.
      case "item/permissions/requestApproval":
        this.respond(requestId, { permissions: {}, scope: "turn" });
        return;
      case "item/tool/requestUserInput":
        this.respond(requestId, { answers: {} });
        return;
      case "mcpServer/elicitation/request":
        this.respond(requestId, { _meta: null, action: "decline", content: null });
        return;
      case "currentTime/read":
        this.respond(requestId, { currentTimeAt: Math.floor(Date.now() / 1000) });
        return;
      default:
        this.respondWithError(requestId, jsonRpcMethodNotFoundCode, `lazy-ai does not implement "${method}".`);
    }
  }

  /**
   * Asks the user whether Codex may run a command, or feed input to one that is
   * already running.
   */
  private async resolveCommandApproval(
    requestId: number | string,
    params: CodexCommandExecutionApprovalParams | undefined,
  ): Promise<void> {
    const pendingServerRequest = this.registerServerRequest(requestId, { decision: "decline" });

    if (!params) {
      pendingServerRequest.decline();
      return;
    }

    const threadId = params.threadId ?? "";
    const isTerminalInput = params.kind === "writeStdin";

    const decision = await this.askForToolPermission(threadId, {
      allowsSessionScope: offersSessionScope(params.availableDecisions),
      // Typing into a command that is already running is not something a stray
      // Enter should do.
      defaultsToDeny: isTerminalInput,
      detail: formatApprovalDetail(params.reason, params.cwd ? `in ${params.cwd}` : null),
      displayName: isTerminalInput ? "Send terminal input" : "Run command",
      path: readFriendlyCommand(params),
      sessionId: threadId,
      title: isTerminalInput
        ? "Codex wants to send input to a running command"
        : "Codex wants to run a command",
      toolName: isTerminalInput ? "terminal input" : "shell commands",
    });

    pendingServerRequest.respond({ decision: toApprovalDecision(decision) });
  }

  /**
   * Asks the user whether Codex may write the change it has staged.
   */
  private async resolveFileChangeApproval(
    requestId: number | string,
    params: CodexFileChangeApprovalParams | undefined,
  ): Promise<void> {
    const pendingServerRequest = this.registerServerRequest(requestId, { decision: "decline" });

    if (!params) {
      pendingServerRequest.decline();
      return;
    }

    const threadId = params.threadId ?? "";
    const changedPaths = this.takeFileChangePaths(params.itemId);

    const decision = await this.askForToolPermission(threadId, {
      // Codex only honours a session-wide grant when it named the root it wants.
      allowsSessionScope: Boolean(params.grantRoot),
      defaultsToDeny: false,
      detail: formatApprovalDetail(
        params.reason,
        params.grantRoot ? `allows writes under ${params.grantRoot}` : null,
      ),
      displayName: "Edit files",
      path: formatChangedPaths(changedPaths),
      sessionId: threadId,
      title: formatFileChangeTitle(changedPaths),
      toolName: "file edits",
    });

    pendingServerRequest.respond({ decision: toApprovalDecision(decision) });
  }

  /**
   * Routes one request at the UI. Returns null when nothing can answer, which
   * every caller turns into a decline rather than leaving the turn blocked.
   */
  private async askForToolPermission(
    threadId: string,
    request: ToolPermissionRequest,
  ): Promise<ToolPermissionDecision | null> {
    const handler = this.toolPermissionHandler;

    if (!handler) return null;

    this.trackPendingApproval(threadId, 1);

    try {
      return await handler(request);
    } catch {
      return null;
    } finally {
      this.trackPendingApproval(threadId, -1);
    }
  }

  /**
   * Tracks the request so it can still be settled if Codex resolves it
   * elsewhere, or if this client is torn down while the prompt is open.
   */
  private registerServerRequest(requestId: number | string, declineResult: unknown): PendingServerRequest {
    const key = String(requestId);
    let isSettled = false;

    const settle = (result: unknown, shouldRespond: boolean): void => {
      if (isSettled) return;

      isSettled = true;
      this.pendingServerRequests.delete(key);

      if (shouldRespond) {
        this.respond(requestId, result);
      }
    };

    const pendingServerRequest: PendingServerRequest = {
      decline: () => settle(declineResult, true),
      discard: () => settle(undefined, false),
      respond: (result) => settle(result, true),
    };

    this.pendingServerRequests.set(key, pendingServerRequest);

    return pendingServerRequest;
  }

  /**
   * Drops a request Codex reports as already settled, so a late answer is not
   * sent against a request that no longer exists. Every resolution is reported,
   * including ours, which has already removed its own entry by this point.
   *
   * The prompt itself stays up: retracting an open modal is not something the
   * approval controller exposes, and lazy-ai runs its own app-server process, so
   * nothing else is competing to answer.
   */
  private discardResolvedServerRequest(params: unknown): void {
    const requestId = (params as CodexServerRequestResolvedNotification | undefined)?.requestId;

    if (requestId === undefined || requestId === null) return;

    this.pendingServerRequests.get(String(requestId))?.discard();
  }

  private declinePendingServerRequests(): void {
    for (const pendingServerRequest of [...this.pendingServerRequests.values()]) {
      pendingServerRequest.decline();
    }

    this.pendingServerRequests.clear();
  }

  /**
   * Counts the approvals a thread is waiting on, so a turn blocked on the user
   * is not failed by its own completion timeout.
   */
  private trackPendingApproval(threadId: string, delta: number): void {
    const nextCount = (this.pendingApprovalsByThread.get(threadId) ?? 0) + delta;

    if (nextCount > 0) {
      this.pendingApprovalsByThread.set(threadId, nextCount);
      return;
    }

    this.pendingApprovalsByThread.delete(threadId);
  }

  private hasPendingApprovals(threadId: string): boolean {
    return (this.pendingApprovalsByThread.get(threadId) ?? 0) > 0;
  }

  /**
   * Remembers which files a change touches. The approval request carries no
   * paths, so they come from the item that announced the change.
   */
  private recordFileChangeItem(params: unknown): void {
    const item = (params as CodexItemStartedNotification | undefined)?.item;

    if (item?.type !== "fileChange" || !item.id) return;

    const paths = (item.changes ?? [])
      .map((change) => change.path?.trim())
      .filter((path): path is string => Boolean(path));

    if (paths.length === 0) return;

    this.fileChangePathsByItemId.set(item.id, paths);

    while (this.fileChangePathsByItemId.size > fileChangeItemCacheLimit) {
      const oldestItemId = this.fileChangePathsByItemId.keys().next().value;

      if (oldestItemId === undefined) break;

      this.fileChangePathsByItemId.delete(oldestItemId);
    }
  }

  private takeFileChangePaths(itemId: string | undefined): string[] {
    if (!itemId) return [];

    const paths = this.fileChangePathsByItemId.get(itemId) ?? [];
    this.fileChangePathsByItemId.delete(itemId);

    return paths;
  }

  private respond(requestId: number | string, result: unknown): void {
    this.trySend({ id: requestId, result });
  }

  private respondWithError(requestId: number | string, code: number, message: string): void {
    this.trySend({ error: { code, message }, id: requestId });
  }

  /**
   * Writes a response, tolerating a process that has already gone away: the
   * request died with it, and nothing on our side is waiting on the write.
   */
  private trySend(message: JsonRpcResponse): void {
    try {
      this.send(message);
    } catch {
      // Deliberately ignored.
    }
  }

  private readTurnCompletedNotification(params: unknown): CodexAppServerTurnCompletionResult | null {
    const notification = params as TurnCompletedNotification | undefined;
    const threadId = notification?.threadId;

    if (!threadId) return null;

    const status = this.readTurnCompletionStatus(notification.turn?.status);

    return {
      errorMessage: notification.turn?.error?.message,
      status,
      threadId,
      turnId: notification.turn?.id,
    };
  }

  private readTurnCompletionStatus(status: string | undefined): CodexAppServerTurnCompletionResult["status"] {
    if (status === "completed" || status === "failed" || status === "interrupted") return status;

    return "unknown";
  }

  private findCompletedTurn(threadId: string, turnId?: string): CodexAppServerTurnCompletionResult | null {
    return [...this.completedTurns].reverse().find((completion) => {
      return completion.threadId === threadId && (!turnId || completion.turnId === turnId);
    }) ?? null;
  }

  private matchesTurnCompletion(waiter: PendingTurnCompletion, completion: CodexAppServerTurnCompletionResult): boolean {
    return completion.threadId === waiter.threadId && (!waiter.turnId || completion.turnId === waiter.turnId);
  }

  private recordStderr(chunk: Buffer): void {
    const lines = chunk.toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    this.stderrLines.push(...lines);
    this.stderrLines = this.stderrLines.slice(-8);
  }

  private handleProcessError(error: Error): void {
    this.rejectPendingRequests(new Error(`Codex app-server failed to start: ${error.message}`));
    this.rejectPendingTurnCompletions(new Error(`Codex app-server failed to start: ${error.message}`));
    // Left unanswered: there is no process to answer to any more.
    this.pendingServerRequests.clear();
    this.initializePromise = null;
    this.process = null;
  }

  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    const stderr = this.stderrLines.length > 0 ? ` ${this.stderrLines.join(" ")}` : "";
    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;

    this.rejectPendingRequests(new Error(`Codex app-server exited with ${reason}.${stderr}`));
    this.rejectPendingTurnCompletions(new Error(`Codex app-server exited with ${reason}.${stderr}`));
    this.pendingServerRequests.clear();
    this.initializePromise = null;
    this.process = null;
    this.stdoutReader = null;
  }

  private rejectPendingRequests(error: Error): void {
    for (const pendingRequest of this.pendingRequests.values()) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(error);
    }

    this.pendingRequests.clear();
  }

  private rejectPendingTurnCompletions(error: Error): void {
    for (const pendingTurnCompletion of this.pendingTurnCompletions.values()) {
      clearTimeout(pendingTurnCompletion.timer);
      pendingTurnCompletion.reject(error);
    }

    this.pendingTurnCompletions.clear();
  }

  private formatResponseError(method: string, error: NonNullable<IncomingMessage["error"]>): string {
    const code = typeof error.code === "number" ? ` (${error.code})` : "";
    const message = error.message ?? "Unknown error";

    return `Codex app-server request "${method}" failed${code}: ${message}`;
  }

  private isActiveWriterError(error: NonNullable<IncomingMessage["error"]>): boolean {
    return error.message?.includes("already has an active writer") ?? false;
  }
}

/**
 * Maps the user's answer onto Codex's vocabulary. An unanswerable request is a
 * decline, which tells the model the user said no without ending the turn the
 * way `cancel` would.
 */
function toApprovalDecision(decision: ToolPermissionDecision | null): CodexApprovalDecision {
  if (decision?.behavior !== "allow") return "decline";

  return decision.scope === "session" ? "acceptForSession" : "accept";
}

/**
 * Codex lists the decisions it will accept for each prompt, and a session-wide
 * allow is often missing, so the prompt only offers one when Codex named it. A
 * server that sends no list at all still accepts the whole vocabulary.
 */
function offersSessionScope(availableDecisions: CodexOfferedApprovalDecision[] | null | undefined): boolean {
  if (!availableDecisions) return true;

  return availableDecisions.includes("acceptForSession");
}

/**
 * Prefers Codex's parsed command over the raw argv, which on Windows is the
 * whole PowerShell wrapper rather than what the model asked to run.
 */
function readFriendlyCommand(params: CodexCommandExecutionApprovalParams): string | null {
  const parsedCommand = params.commandActions
    ?.map((action) => action.command?.trim())
    .find((command): command is string => Boolean(command));

  if (parsedCommand) return parsedCommand;

  return params.command?.trim() || null;
}

function formatApprovalDetail(...parts: (string | null | undefined)[]): string | null {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" — ") || null;
}

/**
 * Names the first file and counts the rest, so a wide change still fits the one
 * line the prompt has for it.
 */
function formatChangedPaths(changedPaths: string[]): string | null {
  const [firstPath, ...remainingPaths] = changedPaths;

  if (!firstPath) return null;
  if (remainingPaths.length === 0) return firstPath;

  return `${firstPath} (+${remainingPaths.length} more)`;
}

function formatFileChangeTitle(changedPaths: string[]): string {
  if (changedPaths.length > 1) {
    return `Codex wants to edit ${changedPaths.length} files`;
  }

  return "Codex wants to edit a file";
}
