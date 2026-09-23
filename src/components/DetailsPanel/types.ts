import type { TermDOM } from "@b9g/termdom";

import type { SessionReader, SessionSummary } from "../../entities/session/index.js";
import type { PendingSessionPrompt } from "../../features/run-session/index.js";

export type TermWindow = TermDOM["window"];

export type DetailsPanelElement = HTMLElement & {
  interruptedSessionId: string | null;
  readonly isConversationLoading: boolean;
  pendingUserPrompt: PendingSessionPrompt | null;
  repository: SessionReader | null;
  viewedSession: SessionSummary | null;
  viewSession(session: SessionSummary): void;
  syncConversation(sessionId: string): Promise<void>;
  thinkingSessionId: string | null;
};
