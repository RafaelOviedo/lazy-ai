import type { TermDOM } from "@b9g/termdom";

import type { ProjectReader, ProjectSummary } from "../../entities/project/index.js";

export type TermWindow = TermDOM["window"];

export type ProjectSelectionChangeDetail = {
  project: ProjectSummary | null;
  projectCount: number;
  error: string | null;
};

export type ProjectsPanelElement = HTMLElement & {
  projectPath: string;
  providerLabel: string;
  repository: ProjectReader;
  readonly selectedProject: ProjectSummary | null;
  reload(): Promise<void>;
};
