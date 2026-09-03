
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
  type: string;
  payload?: {
    cwd?: string;
    model?: string;
  };
};
