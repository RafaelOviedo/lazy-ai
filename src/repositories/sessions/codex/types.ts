
export interface CodexSessionReader {
  listByProject(projectPath?: string): Promise<CodexSessionSummary[]>;
  getLatestUsageLimit(): Promise<UsageLimitSnapshot | null>;
  getConversation(sessionId: string): Promise<CodexSessionConversation>;
}

export type CodexSessionRepositoryOptions = {
  codexRootPath?: string;
};

export type CodexSessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  relativeUpdated: string;
  projectPath: string;
  projectName: string;
  model: string;
  contextUsage?: ContextUsage;
  usageLimit?: UsageLimit;
  status: string;
};

export type ContextUsage = {
  usedTokens: number;
  maxTokens: number;
  percent: number;
};

export type CodexSessionConversation = {
  sessionId: string;
  messages: CodexConversationMessage[];
};

export type CodexConversationMessage = {
  id: string;
  role: CodexConversationRole;
  text: string;
  timestamp?: string;
};

export type CodexConversationRole = "user" | "assistant";

export type UsageLimit = {
  limitId?: string;
  limitName?: string | null;
  primary?: UsageLimitWindow;
  secondary?: UsageLimitWindow;
  credits?: UsageLimitCredits;
  planType?: string;
  rateLimitReachedType?: string | null;
};

export type UsageLimitSnapshot = {
  usageLimit: UsageLimit;
  observedAt: string;
};

export type UsageLimitWindow = {
  usedPercent: number;
  remainingPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
};

export type UsageLimitCredits = {
  hasCredits?: boolean;
  unlimited?: boolean;
  balance?: number | null;
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
  usageLimit?: UsageLimit;
};
