import type { UsageLimit } from "../provider/types.js";
import type { UsageLimitSnapshot } from "../provider/types.js";

/**
 * Reads persisted session history for one provider.
 */
export interface SessionReader {
  listByProject(projectPath?: string): Promise<SessionSummary[]>;
  getLatestUsageLimit(): Promise<UsageLimitSnapshot | null>;
  getConversation(sessionId: string): Promise<SessionConversation>;
}

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  relativeUpdated: string;
  projectPath: string;
  projectName: string;
  model: string;
  /** Latest applied thinking level; absent or null when unavailable. */
  effort?: string | null;
  contextUsage?: ContextUsage;
  usageLimit?: UsageLimit;
  status: string;
};

export type ContextUsage = {
  usedTokens: number;
  maxTokens: number;
  percent: number;
};

export type SessionConversation = {
  sessionId: string;
  messages: ConversationMessage[];
};

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  text: string;
  timestamp?: string;
};

export type ConversationRole = "user" | "assistant";
