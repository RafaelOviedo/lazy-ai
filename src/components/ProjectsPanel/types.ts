import type { TermDOM } from "@b9g/termdom";

import type { CodexProjectReader, CodexProjectSummary } from "../../repositories/projects/codex/types";

export type TermWindow = TermDOM["window"];

export type ProjectSelectionChangeDetail = {
  project: CodexProjectSummary | null;
  projectCount: number;
  error: string | null;
};

export type ProjectsPanelElement = HTMLElement & {
  projectPath: string;
  repository: CodexProjectReader;
  readonly selectedProject: CodexProjectSummary | null;
  reload(): Promise<void>;
};
