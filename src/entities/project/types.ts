/**
 * Lists the projects a provider has persisted session history for.
 */
export interface ProjectReader {
  listProjects(): Promise<ProjectSummary[]>;
}

export type ProjectSummary = {
  path: string;
  name: string;
  sessionCount: number;
  updatedAt: string;
  relativeUpdated: string;
  status: string;
};
