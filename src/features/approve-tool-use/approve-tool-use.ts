import type {
  ToolPermissionDecision,
  ToolPermissionHandler,
  ToolPermissionRequest,
} from "../../entities/provider/index.js";

type QueuedPermissionRequest = {
  request: ToolPermissionRequest;
  settle(decision: ToolPermissionDecision): void;
};

type ToolApprovalControllerOptions = {
  closeModal(): void;
  /** True when some other modal currently owns the screen. */
  isModalActive(): boolean;
  openPermissionModal(request: ToolPermissionRequest, queuedCount: number, onDecide: (decision: ToolPermissionDecision) => void): void;
};

export type ToolApprovalController = {
  dispose(): void;
  /** Re-checks the queue once the screen frees up. */
  handleModalClosed(): void;
  hasPendingRequests(): boolean;
  requestToolPermission: ToolPermissionHandler;
};

const deniedDecision: ToolPermissionDecision = { behavior: "deny" };

/**
 * Serialises tool permission requests onto the single modal slot.
 *
 * Claude Code runs independent tool calls in parallel, so several requests can be
 * outstanding at once while only one can be shown, and each one blocks its turn
 * until it is answered.
 */
export function createToolApprovalController(options: ToolApprovalControllerOptions): ToolApprovalController {
  const queue: QueuedPermissionRequest[] = [];
  let activeRequest: QueuedPermissionRequest | null = null;
  let isDisposed = false;

  function requestToolPermission(request: ToolPermissionRequest): Promise<ToolPermissionDecision> {
    // Nothing can answer after teardown, so deny rather than leave a turn hanging.
    if (isDisposed) return Promise.resolve(deniedDecision);

    return new Promise<ToolPermissionDecision>((resolve) => {
      let hasSettled = false;

      queue.push({
        request,
        settle: (decision) => {
          if (hasSettled) return;

          hasSettled = true;
          resolve(decision);
        },
      });

      presentNextRequest();
    });
  }

  /**
   * Shows the next request, waiting for any unrelated modal to close first.
   */
  function presentNextRequest(): void {
    if (isDisposed || activeRequest) return;

    const nextRequest = queue[0];

    if (!nextRequest) return;
    if (options.isModalActive()) return;

    activeRequest = nextRequest;
    queue.shift();

    options.openPermissionModal(nextRequest.request, queue.length, (decision) => {
      settleActiveRequest(decision);
    });
  }

  function settleActiveRequest(decision: ToolPermissionDecision): void {
    const settledRequest = activeRequest;

    if (!settledRequest) return;

    activeRequest = null;
    options.closeModal();
    settledRequest.settle(decision);

    presentNextRequest();
  }

  return {
    dispose(): void {
      isDisposed = true;

      const abandonedRequests = [...queue];

      queue.length = 0;

      const abandonedActiveRequest = activeRequest;
      activeRequest = null;

      abandonedActiveRequest?.settle(deniedDecision);

      for (const abandonedRequest of abandonedRequests) {
        abandonedRequest.settle(deniedDecision);
      }
    },
    handleModalClosed(): void {
      presentNextRequest();
    },
    hasPendingRequests(): boolean {
      return activeRequest !== null || queue.length > 0;
    },
    requestToolPermission,
  };
}
