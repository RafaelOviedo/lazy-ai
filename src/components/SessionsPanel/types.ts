import type { SessionRunStatus } from "../../features/run-session/index.js";
import { TermDOM } from "@b9g/termdom";
import type { SessionReader, SessionSummary } from "../../entities/session/index.js";

export type TermWindow = TermDOM["window"];

export type SessionSelectionChangeDetail = {
  session: SessionSummary | null;
  sessionCount: number;
  projectPath: string;
  error: string | null;
};

export type SessionResumeRequestDetail = {
  session: SessionSummary;
  projectPath: string;
};

export type SessionViewRequestDetail = {
  session: SessionSummary;
  projectPath: string;
};

export type SessionDeleteRequestDetail = {
  session: SessionSummary;
  projectPath: string;
};

export type SessionsPanelElement = HTMLElement & {
  activeSessionId: string | null;
  projectPath: string;
  providerLabel: string;
  getSession(sessionId: string): SessionSummary | null;
  hasSession(sessionId: string): boolean;
  setSessionAlreadyRunning(sessionId: string | null): void;
  setSessionDeleting(sessionId: string | null): void;
  setSessionResumeFailed(sessionId: string | null): void;
  setSessionResuming(sessionId: string | null): void;
  setSessionRunStatus(sessionId: string, status: SessionRunStatus): void;
  upsertSession(session: SessionSummary): void;
  forgetSession(sessionId: string): void;
  repository: SessionReader;
  readonly selectedSession: SessionSummary | null;
  reload(): Promise<void>;
  selectSession(sessionId: string): boolean;
  syncSession(sessionId: string): Promise<SessionSummary | null>;
};
