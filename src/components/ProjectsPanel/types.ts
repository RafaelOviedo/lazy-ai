import type { TermDOM } from "@b9g/termdom";

import type { ProjectSummary } from "../../app/types/index.js";
import type { ProjectReader } from "../../app/ports/index.js";

export type TermWindow = TermDOM["window"];

export type ProjectSelectionChangeDetail = {
  project: ProjectSummary | null;
  projectCount: number;
  error: string | null;
};

export type ProjectsPanelElement = HTMLElement & {
  projectPath: string;
  repository: ProjectReader;
  readonly selectedProject: ProjectSummary | null;
  reload(): Promise<void>;
};
