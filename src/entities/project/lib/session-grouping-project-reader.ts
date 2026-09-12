import type { ProjectSummary } from "../types.js";
import type { ProjectReader } from "../api.js";
import type { SessionReader } from "../../session/api.js";

/**
 * Builds a project list by grouping any provider's persisted session history.
 */
export class SessionGroupingProjectReader implements ProjectReader {
  private readonly sessionReader: SessionReader;

  constructor(sessionReader: SessionReader) {
    this.sessionReader = sessionReader;
  }

  /**
   * Returns projects grouped by workspace path, newest activity first.
   */
  async listProjects(): Promise<ProjectSummary[]> {
    const sessions = await this.sessionReader.listByProject();
    const projects = new Map<string, ProjectSummary>();

    for (const session of sessions) {
      const projectKey = this.normalizeProjectPath(session.projectPath);
      const existingProject = projects.get(projectKey);

      if (!existingProject) {
        projects.set(projectKey, {
          path: session.projectPath,
          name: session.projectName,
          sessionCount: 1,
          updatedAt: session.updatedAt,
          relativeUpdated: session.relativeUpdated,
          status: session.status,
        });
        continue;
      }

      existingProject.sessionCount += 1;

      if (session.updatedAt.localeCompare(existingProject.updatedAt) > 0) {
        existingProject.updatedAt = session.updatedAt;
        existingProject.relativeUpdated = session.relativeUpdated;
        existingProject.status = session.status;
      }
    }

    return [...projects.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /**
   * Groups tolerantly because providers record separators and casing differently.
   */
  private normalizeProjectPath(projectPath: string): string {
    return projectPath.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  }
}
