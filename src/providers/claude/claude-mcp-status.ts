import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerInfo, McpServerState } from "../../entities/provider/index.js";

/**
 * Claude Code reports `pending` for a server it has not finished starting.
 * That is a transient state rather than a problem, so it maps to "connecting"
 * and the caller is expected to read again rather than report it as final.
 */
const stateByStatus: Record<string, McpServerState> = {
  connected: "connected",
  pending: "connecting",
  failed: "failed",
  "needs-auth": "needs-auth",
  disabled: "disabled",
};

/**
 * Reads the transport out of a server config. stdio configs may leave `type`
 * unset, so a bare `command` is taken as stdio rather than falling through to
 * "unknown".
 */
function readTransport(config: McpServerStatus["config"]): string | undefined {
  if (!config || typeof config !== "object") return undefined;

  const record = config as Record<string, unknown>;
  const declared = typeof record.type === "string" ? record.type : undefined;

  if (declared) return declared;

  return typeof record.command === "string" ? "stdio" : undefined;
}

/**
 * Reduces a remote server's URL to a host, which is what identifies it on a
 * row; the full URL carries credentials and path noise that do not fit.
 */
function readOrigin(config: McpServerStatus["config"]): string | undefined {
  if (!config || typeof config !== "object") return undefined;

  const url = (config as Record<string, unknown>).url;

  if (typeof url !== "string") return undefined;

  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Flattens Claude Code's MCP status into the shape the app renders.
 */
export function mapClaudeMcpServers(statuses: McpServerStatus[]): McpServerInfo[] {
  return statuses.map((status) => ({
    name: status.name,
    state: stateByStatus[status.status] ?? "unknown",
    scope: status.scope,
    transport: readTransport(status.config),
    origin: readOrigin(status.config),
    version: status.serverInfo?.version,
    error: status.error,
    tools: (status.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      readOnly: tool.annotations?.readOnly,
      destructive: tool.annotations?.destructive,
    })),
  }));
}
