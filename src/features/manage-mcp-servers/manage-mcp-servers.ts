import type {
  McpReconnectResult,
  McpReconnectScope,
  McpServerInfo,
  McpServerListOptions,
} from "../../entities/provider/index.js";

/**
 * Only the part of the runtime client this feature drives, so a test can stand
 * in for it without building a whole provider.
 */
type McpServerClient = {
  listMcpServers?(options?: McpServerListOptions): Promise<McpServerInfo[]>;
  releaseMcpResources?(): void;
  reconnectMcpServer?(serverName: string, options?: McpServerListOptions): Promise<McpReconnectResult>;
};

export type McpServerListState = {
  servers: McpServerInfo[];
  error: string | null;
  /** True until the first read of this viewing resolves. */
  isLoading: boolean;
  /** True while at least one server is still starting up. */
  isSettling: boolean;
  /** The server a reconnect is running for, or null when none is. */
  reconnecting: string | null;
  /** The outcome of the last action, for the viewer to show once. */
  notice: string | null;
};

type McpServerControllerOptions = {
  client: McpServerClient;
  /** Resolves project-scoped MCP config, such as a project's `.mcp.json`. */
  cwd?: string;
  providerLabel: string;
  /** The live session to read through, when there is one. */
  getActiveThreadId?(): string | undefined;
};

export type McpServerListener = (state: McpServerListState) => void;

export type McpServerController = ReturnType<typeof createMcpServerController>;

/** How long to leave between reads while servers are still starting. */
const pollIntervalMs = 2000;
/**
 * Both runtimes start MCP servers without blocking, so the first read is
 * nearly always incomplete. Polling stops once nothing is starting, or after
 * this long, so a server that never settles does not poll forever.
 */
const settleTimeoutMs = 30000;

/**
 * Reads the active provider's MCP servers for the viewer, re-reading while any
 * of them are still coming up.
 */
export function createMcpServerController(options: McpServerControllerOptions) {
  let state: McpServerListState = {
    servers: [], error: null, isLoading: false, isSettling: false, reconnecting: null, notice: null,
  };
  const listeners = new Set<McpServerListener>();
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let settleDeadline = 0;
  let isOpen = false;
  // Rising token so a read that resolves after a close or a newer read is
  // dropped rather than overwriting fresher state.
  let readToken = 0;
  // The server a reconnect is waiting on, so its outcome can be reported once
  // the reads settle rather than guessed at the moment the request was taken.
  let awaitingOutcome: { name: string; scope: McpReconnectScope } | null = null;

  function emit(next: Partial<McpServerListState>): void {
    state = { ...state, ...next };

    for (const listener of listeners) listener(state);
  }

  function clearTimer(): void {
    if (!pollTimer) return;

    clearTimeout(pollTimer);
    pollTimer = null;
  }

  async function read(): Promise<void> {
    const token = ++readToken;

    if (!options.client.listMcpServers) {
      emit({
        error: `${options.providerLabel} does not report MCP servers to lazy-ai.`,
        isLoading: false,
        isSettling: false,
      });
      return;
    }

    try {
      const servers = await options.client.listMcpServers({
        cwd: options.cwd,
        threadId: options.getActiveThreadId?.(),
      });

      if (token !== readToken || !isOpen) return;

      const isSettling = servers.some((server) => server.state === "connecting");

      emit({ servers, error: null, isLoading: false, isSettling, ...readOutcome(servers, isSettling) });

      if (isSettling && Date.now() < settleDeadline) {
        clearTimer();
        pollTimer = setTimeout(() => void read(), pollIntervalMs);
      }
    } catch (error) {
      if (token !== readToken || !isOpen) return;

      emit({
        error: error instanceof Error ? error.message : "Could not read MCP servers.",
        isLoading: false,
        isSettling: false,
      });
    }
  }

  /**
   * Reports how a reconnect turned out, once the reads have settled.
   *
   * The provider only confirms it accepted the request, so the answer has to
   * come from the server's own state afterwards rather than from the call.
   */
  function readOutcome(servers: McpServerInfo[], isSettling: boolean): Partial<McpServerListState> {
    if (!awaitingOutcome || isSettling) return {};

    const { name, scope } = awaitingOutcome;
    const server = servers.find((candidate) => candidate.name === name);
    // Codex can only reload everything, so the message says which it did.
    const sweep = scope === "all" ? " Every server was reloaded." : "";

    awaitingOutcome = null;

    const describe = (): string => {
      if (!server) return `${name} is no longer listed.`;
      if (server.state === "connected") return `${name} reconnected.`;
      if (server.state === "failed") {
        return `${name} failed to reconnect${server.error ? `: ${server.error}` : "."}`;
      }
      if (server.state === "needs-auth") return `${name} still needs you to sign in.`;
      if (server.state === "disabled") return `${name} is disabled.`;

      return `${name} is ${server.state}.`;
    };

    return { reconnecting: null, notice: `${describe()}${sweep}` };
  }

  /** Ends the viewing and drops anything held only to serve it. */
  function closeViewing(): void {
    isOpen = false;
    readToken += 1;
    clearTimer();
    awaitingOutcome = null;
    state = { ...state, reconnecting: null, notice: null };
    options.client.releaseMcpResources?.();
  }

  /** Re-reads on demand, giving starting servers a fresh window to settle. */
  function refresh(): void {
    if (!isOpen) return;

    settleDeadline = Date.now() + settleTimeoutMs;
    clearTimer();
    emit({ isLoading: true, error: null });
    void read();
  }

  return {
    /** Starts a viewing: reads now, then re-reads while servers come up. */
    open(): void {
      isOpen = true;
      settleDeadline = Date.now() + settleTimeoutMs;
      emit({ servers: [], error: null, isLoading: true, isSettling: false, reconnecting: null, notice: null });
      void read();
    },

    /**
     * Reconnects one server, then re-reads so the row shows the result.
     *
     * The provider only promises the request was accepted, so the state after
     * it is whatever the following reads report, not an assumed success.
     */
    async reconnect(serverName: string): Promise<void> {
      if (!isOpen || state.reconnecting) return;

      if (!options.client.reconnectMcpServer) {
        emit({ notice: `${options.providerLabel} cannot reconnect MCP servers from lazy-ai.` });
        return;
      }

      emit({ reconnecting: serverName, notice: null });

      try {
        const result = await options.client.reconnectMcpServer(serverName, {
          cwd: options.cwd,
          threadId: options.getActiveThreadId?.(),
        });

        if (!isOpen) return;

        // `reconnecting` stays set: the request was only accepted, and the
        // reads that follow are what say whether the server actually came up.
        awaitingOutcome = { name: serverName, scope: result.scope };
        refresh();
      } catch (error) {
        if (!isOpen) return;

        awaitingOutcome = null;
        emit({
          reconnecting: null,
          notice: `Could not reconnect ${serverName}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },

    /**
     * Shows a message in place of an action. Used when the viewer knows an
     * action cannot help, so nothing is attempted that is certain to fail.
     */
    notify(message: string): void {
      if (!isOpen) return;

      emit({ notice: message });
    },

    /** Drops the last action's message, once the user has moved on from it. */
    clearNotice(): void {
      if (state.notice) emit({ notice: null });
    },

    /** Re-reads on demand, giving starting servers a fresh window to settle. */
    refresh,

    /** Ends the viewing and drops anything held only to serve it. */
    close: closeViewing,

    getState(): McpServerListState {
      return state;
    },

    /** Reports every state change until the returned function is called. */
    subscribe(listener: McpServerListener): () => void {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },

    dispose(): void {
      closeViewing();
      listeners.clear();
    },
  };
}
