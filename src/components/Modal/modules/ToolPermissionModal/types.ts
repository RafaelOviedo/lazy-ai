import type { ToolPermissionDecision, ToolPermissionRequest } from "../../../../entities/provider/index.js";

export type ToolPermissionModalPayload = {
  onCancel?: () => void;
  onDecide: (decision: ToolPermissionDecision) => void;
  /** Number of further requests waiting behind this one, for a queue hint. */
  queuedCount: number;
  request: ToolPermissionRequest;
};
