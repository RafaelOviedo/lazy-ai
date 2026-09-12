import type { ContextUsage, UsageLimit } from "../../app/types/index.js";
import type { SessionReader } from "../../app/ports/index.js";

export type CodexSessionRepositoryOptions = {
  codexRootPath?: string;
};

export type CodexModelSourceOptions = {
  codexRootPath?: string;
};

export type CodexAppServerClientOptions = {
  model?: string | null;
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
