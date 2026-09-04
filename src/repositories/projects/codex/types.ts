export interface CodexProjectReader {
  listProjects(): Promise<CodexProjectSummary[]>;
}

export type CodexProjectSummary = {
  path: string;
  name: string;
  sessionCount: number;
  updatedAt: string;
  relativeUpdated: string;
  status: string;
};
