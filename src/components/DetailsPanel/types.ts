import type { TermDOM } from "@b9g/termdom";

import type { CodexSessionReader, CodexSessionSummary } from "../../repositories/sessions/codex/types";
import type { PendingSessionPrompt } from "../../shared/lib/sessions";

export type TermWindow = TermDOM["window"];

export type DetailsPanelElement = HTMLElement & {
  readonly isConversationLoading: boolean;
  pendingUserPrompt: PendingSessionPrompt | null;
  repository: CodexSessionReader;
  selectedSession: CodexSessionSummary | null;
  thinkingSessionId: string | null;
};
