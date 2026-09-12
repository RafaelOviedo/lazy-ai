import { CodexSessionRepository } from "./codex-session-repository.js";

import type { ProjectSummary } from "../../app/types/index.js";
import type { ProjectReader, SessionReader } from "../../app/ports/index.js";
import type { CodexProjectRepositoryOptions } from "./types.js";

/**
 * Builds a project list from persisted Codex session history.
 */
export class CodexProjectRepository implements ProjectReader {
  private readonly sessionReader: SessionReader;

  constructor(options: CodexProjectRepositoryOptions = {}) {
    this.sessionReader = options.sessionReader ?? new CodexSessionRepository();
  }

  /**
   * Returns projects grouped by workspace path, newest activity first.
   */
  async listProjects(): Promise<ProjectSummary[]> {
    const sessions = await this.sessionReader.listByProject();
    const projects = new Map<string, ProjectSummary>();

    for (const session of sessions) {
      const existingProject = projects.get(session.projectPath);

      if (!existingProject) {
        projects.set(session.projectPath, {
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
}
