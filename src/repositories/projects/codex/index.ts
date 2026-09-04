import { CodexSessionRepository } from "../../sessions/codex/index.js";

import type { CodexSessionReader } from "../../sessions/codex/types.js";
import type { CodexProjectReader, CodexProjectSummary } from "./types.js";

export type CodexProjectRepositoryOptions = {
  sessionReader?: CodexSessionReader;
};

/**
 * Builds a project list from persisted Codex session history.
 */
export class CodexProjectRepository implements CodexProjectReader {
  private readonly sessionReader: CodexSessionReader;

  constructor(options: CodexProjectRepositoryOptions = {}) {
    this.sessionReader = options.sessionReader ?? new CodexSessionRepository();
  }

  /**
   * Returns projects grouped by workspace path, newest activity first.
   */
  async listProjects(): Promise<CodexProjectSummary[]> {
    const sessions = await this.sessionReader.listByProject();
    const projects = new Map<string, CodexProjectSummary>();

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
