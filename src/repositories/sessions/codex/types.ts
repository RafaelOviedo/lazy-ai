
export interface CodexSessionReader {
  listByProject(projectPath?: string): Promise<CodexSessionSummary[]>;
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
  status: string;
};

export type ContextUsage = {
  usedTokens: number;
  maxTokens: number;
  percent: number;
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
  type: "event_msg";
  payload?: {
    type: "token_count";
    info?: {
      last_token_usage?: {
        input_tokens?: number;
      };
      model_context_window?: number;
    };
  };
};

export type SessionContext = {
  cwd?: string;
  model?: string;
  contextUsage?: ContextUsage;
};
