
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
  status: string;
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
    type?: string;
    thread_settings?: {
      model?: string;
    };
  };
};

export type SessionContext = {
  cwd?: string;
  model?: string;
};
