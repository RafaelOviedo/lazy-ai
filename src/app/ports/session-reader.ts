import type { SessionConversation, SessionSummary } from "../types/session.js";
import type { UsageLimitSnapshot } from "../types/usage.js";

/**
 * Reads persisted session history for one provider.
 */
export interface SessionReader {
  listByProject(projectPath?: string): Promise<SessionSummary[]>;
  getLatestUsageLimit(): Promise<UsageLimitSnapshot | null>;
  getConversation(sessionId: string): Promise<SessionConversation>;
}
