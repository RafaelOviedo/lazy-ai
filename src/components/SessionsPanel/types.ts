import { TermDOM } from "@b9g/termdom";
import { CodexSessionReader, CodexSessionSummary } from "../../repositories/sessions/codex/types";

export type TermWindow = TermDOM["window"];

export type SessionSelectionChangeDetail = {
  session: CodexSessionSummary | null;
  sessionCount: number;
  projectPath: string;
  error: string | null;
};

export type SessionsPanelElement = HTMLElement & {
  projectPath: string;
  repository: CodexSessionReader;
  readonly selectedSession: CodexSessionSummary | null;
  reload(): Promise<void>;
};
