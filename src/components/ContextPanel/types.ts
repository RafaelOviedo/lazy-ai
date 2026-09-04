import type { TermDOM } from "@b9g/termdom";

import type { CodexSessionSummary } from "../../repositories/sessions/codex/types";

export type TermWindow = TermDOM["window"];

export type ContextPanelElement = HTMLElement & {
  projectName: string;
  projectPath: string;
  selectedSession: CodexSessionSummary | null;
};
