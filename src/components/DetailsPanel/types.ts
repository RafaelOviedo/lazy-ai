import type { TermDOM } from "@b9g/termdom";

import type { SessionSummary } from "../../app/types/index.js";
import type { SessionReader } from "../../app/ports/index.js";
import type { PendingSessionPrompt } from "../../shared/lib/sessions";

export type TermWindow = TermDOM["window"];

export type DetailsPanelElement = HTMLElement & {
  interruptedSessionId: string | null;
  readonly isConversationLoading: boolean;
  pendingUserPrompt: PendingSessionPrompt | null;
  repository: SessionReader;
  selectedSession: SessionSummary | null;
  syncConversation(sessionId: string): Promise<void>;
  thinkingSessionId: string | null;
};
