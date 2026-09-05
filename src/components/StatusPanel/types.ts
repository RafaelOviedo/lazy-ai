import type { TermDOM } from "@b9g/termdom";

import type { CodexSessionSummary } from "../../repositories/sessions/codex/types";

export type TermWindow = TermDOM["window"];

export type StatusPanelElement = HTMLElement & {
  loadError: string | null;
  projectLoadError: string | null;
  selectedSession: CodexSessionSummary | null;
};
