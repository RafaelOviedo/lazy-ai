import type { UsageLimit } from "../../entities/provider/index.js";
import type { ContextUsage, SessionReader } from "../../entities/session/index.js";

export type CodexSessionRepositoryOptions = {
  codexRootPath?: string;
};

export type CodexModelSourceOptions = {
  codexRootPath?: string;
};

export type CodexAppServerClientOptions = {
  model?: string | null;
};

/**
 * Decisions Codex accepts for one approval request. The protocol also carries
 * object variants that attach a policy amendment, which lazy-ai reads off the
 * offered list but never sends.
 */
export type CodexApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type CodexOfferedApprovalDecision = CodexApprovalDecision | Record<string, unknown>;

/**
 * Codex's own parse of the command, which is friendlier than the raw argv.
 */
export type CodexCommandAction = {
  command?: string;
  path?: string | null;
  type?: string;
};

/**
 * Params of an `item/commandExecution/requestApproval` request.
 */
export type CodexCommandExecutionApprovalParams = {
  /** Ordered decisions Codex will accept for this prompt. */
  availableDecisions?: CodexOfferedApprovalDecision[] | null;
  command?: string | null;
  commandActions?: CodexCommandAction[] | null;
  cwd?: string | null;
  itemId?: string;
  /** `writeStdin` feeds input to a command that is already running. */
  kind?: "command" | "writeStdin";
  reason?: string | null;
  threadId?: string;
  turnId?: string;
};

/**
 * Params of an `item/fileChange/requestApproval` request. The changed paths are
 * not included, so they have to come from the item that announced the change.
 */
export type CodexFileChangeApprovalParams = {
  /** Set when Codex is asking for writes under this root for the session. */
  grantRoot?: string | null;
  itemId?: string;
  reason?: string | null;
  threadId?: string;
  turnId?: string;
};

export type CodexThreadItem = {
  changes?: { path?: string }[];
  id?: string;
  type?: string;
};

export type CodexItemStartedNotification = {
  item?: CodexThreadItem;
  threadId?: string;
};

export type CodexServerRequestResolvedNotification = {
  requestId?: number | string;
  threadId?: string;
};

export type CodexModelsCacheEntry = {
  slug?: string;
  display_name?: string;
  description?: string;
  default_reasoning_level?: string;
  visibility?: string;
  priority?: number;
  context_window?: number;
};

export type CodexProjectRepositoryOptions = {
  sessionReader?: SessionReader;
};

export type SessionIndexRow = {
  id: string;
  updated_at?: string;
  thread_name?: string;
};

export type SessionMetaEvent = {
  type: "session_meta";
  payload?: {
    cwd?: string;
    model?: string;
  };
};

export type TurnContextEvent = {
  type: "turn_context";
  payload?: {
    cwd?: string;
    model?: string;
  };
};

export type ThreadSettingsAppliedEvent = {
  type: "event_msg";
  payload?: {
    type: "thread_settings_applied";
    thread_settings?: {
      model?: string;
    };
  };
};

export type TokenCountEvent = {
  timestamp?: string;
  type: "event_msg";
  payload?: {
    type: "token_count";
    info?: {
      last_token_usage?: {
        input_tokens?: number;
      };
      model_context_window?: number;
    };
    rate_limits?: {
      limit_id?: string;
      limit_name?: string | null;
      primary?: RawUsageLimitWindow | null;
      secondary?: RawUsageLimitWindow | null;
      credits?: {
        has_credits?: boolean;
        unlimited?: boolean;
        balance?: number | null;
      };
      plan_type?: string;
      rate_limit_reached_type?: string | null;
    };
  };
};

export type RawUsageLimitWindow = {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
};

export type SessionContext = {
  cwd?: string;
  model?: string;
  contextUsage?: ContextUsage;
  sessionId?: string;
  title?: string;
  updatedAt?: string;
  usageLimit?: UsageLimit;
};
