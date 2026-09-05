import type { TermDOM } from "@b9g/termdom";

import type { CodexSessionSummary } from "../../repositories/sessions/codex/types";

export type TermWindow = TermDOM["window"];

export type DetailsPanelElement = HTMLElement & {
  selectedSession: CodexSessionSummary | null;
};
