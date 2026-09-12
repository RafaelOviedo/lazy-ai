import type { UsageLimit } from "../provider/types.js";

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  relativeUpdated: string;
  projectPath: string;
  projectName: string;
  model: string;
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
