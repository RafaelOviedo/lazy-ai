import type { SessionConversation, SessionSummary } from "./types.js";
import type { UsageLimitSnapshot } from "../provider/types.js";

/**
 * Reads persisted session history for one provider.
 */
export interface SessionReader {
  listByProject(projectPath?: string): Promise<SessionSummary[]>;
  getLatestUsageLimit(): Promise<UsageLimitSnapshot | null>;
  getConversation(sessionId: string): Promise<SessionConversation>;
}
