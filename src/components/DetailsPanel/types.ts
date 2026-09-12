import type { TermDOM } from "@b9g/termdom";

import type { SessionReader, SessionSummary } from "../../entities/session/index.js";
import type { PendingSessionPrompt } from "../../shared/lib/sessions";

export type TermWindow = TermDOM["window"];

export type DetailsPanelElement = HTMLElement & {
  interruptedSessionId: string | null;
  readonly isConversationLoading: boolean;
  pendingUserPrompt: PendingSessionPrompt | null;
  repository: SessionReader | null;
  selectedSession: SessionSummary | null;
  syncConversation(sessionId: string): Promise<void>;
  thinkingSessionId: string | null;
};
