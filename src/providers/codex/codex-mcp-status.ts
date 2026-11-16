import type { McpServerInfo, McpServerState } from "../../entities/provider/index.js";
import type { CodexMcpServerStatus } from "./types.js";

/**
 * Codex reports startup states separately from connection states. Anything the
 * server has not finished bringing up maps to "connecting" so the caller reads
 * again rather than treating it as settled.
 */
const stateByRuntimeStatus: Record<string, McpServerState> = {
  connected: "connected",
  starting: "connecting",
  notStarted: "connecting",
  authenticationRequired: "needs-auth",
  failed: "failed",
  cancelled: "failed",
  disabled: "disabled",
};

/**
 * Infers a state for a server Codex reported without a runtime status.
 *
 * That happens whenever the read is not scoped to a live thread, which is the
 * normal case for a dashboard-level listing. A returned tool catalog is proof
 * the server answered, so it counts as connected; otherwise only the auth
 * status says anything definite.
 */
function inferStateWithoutRuntime(status: CodexMcpServerStatus): McpServerState {
  if (status.toolsError) return "failed";
  if (Object.keys(status.tools ?? {}).length > 0) return "connected";
  if (status.authStatus === "notLoggedIn") return "needs-auth";

  return "unknown";
}

/**
 * Flattens Codex's MCP status into the shape the app renders.
 */
export function mapCodexMcpServers(statuses: CodexMcpServerStatus[]): McpServerInfo[] {
  return statuses.map((status) => {
    const runtime = status.runtimeStatus ? stateByRuntimeStatus[status.runtimeStatus] : undefined;

    return {
      name: status.name,
      state: runtime ?? inferStateWithoutRuntime(status),
      scope: status.pluginId ? `plugin:${status.pluginId}` : "config",
      transport: status.httpOrigin ? "http" : "stdio",
      origin: readHost(status.httpOrigin),
      version: status.serverInfo?.version,
      error: status.toolsError ?? undefined,
      tools: Object.entries(status.tools ?? {}).map(([name, tool]) => ({
        name,
        description: typeof tool?.description === "string" ? tool.description : undefined,
        // Codex passes MCP annotations through unchanged, so they still carry
        // the spec's `*Hint` names rather than Claude Code's normalised ones.
        readOnly: tool?.annotations?.readOnlyHint,
        destructive: tool?.annotations?.destructiveHint,
      })),
    };
  });
}

/**
 * Codex already strips credentials and paths from the origin, so only the
 * scheme is left to drop before it fits on a row.
 */
function readHost(origin: string | null | undefined): string | undefined {
  if (!origin) return undefined;

  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
