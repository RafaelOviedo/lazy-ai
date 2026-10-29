import type { TermDOM } from "@b9g/termdom";

import type { LiveConversationEvent } from "../../entities/provider/index.js";
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
  applyLiveEvent(event: LiveConversationEvent): void;
  settleLiveEvents(sessionId: string): void;
  thinkingSessionId: string | null;
  thinkingLabel: string;
};
