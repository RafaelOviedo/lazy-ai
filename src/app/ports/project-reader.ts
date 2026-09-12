import type { ProjectSummary } from "../types/project.js";

/**
 * Lists the projects a provider has persisted session history for.
 */
export interface ProjectReader {
  listProjects(): Promise<ProjectSummary[]>;
}
