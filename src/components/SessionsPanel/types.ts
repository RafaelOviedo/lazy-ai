import { TermDOM } from "@b9g/termdom";
import { CodexSessionReader, CodexSessionSummary } from "../../repositories/sessions/codex/types";

export type TermWindow = TermDOM["window"];

export type SessionSelectionChangeDetail = {
  session: CodexSessionSummary | null;
  sessionCount: number;
  projectPath: string;
  error: string | null;
};

export type SessionResumeRequestDetail = {
  session: CodexSessionSummary;
  projectPath: string;
};

export type SessionsPanelElement = HTMLElement & {
  activeSessionId: string | null;
  projectPath: string;
  setSessionAlreadyRunning(sessionId: string | null): void;
  setSessionResuming(sessionId: string | null): void;
  repository: CodexSessionReader;
  readonly selectedSession: CodexSessionSummary | null;
  reload(): Promise<void>;
};
