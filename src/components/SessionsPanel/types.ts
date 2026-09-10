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

export type SessionDeleteRequestDetail = {
  session: CodexSessionSummary;
  projectPath: string;
};

export type SessionsPanelElement = HTMLElement & {
  activeSessionId: string | null;
  projectPath: string;
  getSession(sessionId: string): CodexSessionSummary | null;
  hasSession(sessionId: string): boolean;
  setSessionAlreadyRunning(sessionId: string | null): void;
  setSessionDeleting(sessionId: string | null): void;
  setSessionResumeFailed(sessionId: string | null): void;
  setSessionResuming(sessionId: string | null): void;
  setSessionInterrupted(sessionId: string | null): void;
  setSessionThinking(sessionId: string | null): void;
  repository: CodexSessionReader;
  readonly selectedSession: CodexSessionSummary | null;
  reload(): Promise<void>;
  selectSession(sessionId: string): boolean;
  syncSession(sessionId: string): Promise<CodexSessionSummary | null>;
};
