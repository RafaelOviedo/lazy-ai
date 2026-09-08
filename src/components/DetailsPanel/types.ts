import type { TermDOM } from "@b9g/termdom";

import type { CodexSessionReader, CodexSessionSummary } from "../../repositories/sessions/codex/types";

export type TermWindow = TermDOM["window"];

export type DetailsPanelElement = HTMLElement & {
  repository: CodexSessionReader;
  selectedSession: CodexSessionSummary | null;
};
