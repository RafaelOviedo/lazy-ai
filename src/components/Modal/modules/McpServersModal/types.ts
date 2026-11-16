import type { ProviderId } from "../../../../entities/provider/index.js";
import type { McpServerListState, McpServerListener } from "../../../../features/manage-mcp-servers/index.js";

export type McpServersModalPayload = {
  providerId: ProviderId;
  providerLabel: string;
  getState(): McpServerListState;
  subscribe(listener: McpServerListener): () => void;
  onRefresh(): void;
  onReconnect(serverName: string): void;
  onClearNotice(): void;
  onNotice(message: string): void;
};
