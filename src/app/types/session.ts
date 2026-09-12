import type { ContextUsage } from "./context.js";
import type { UsageLimit } from "./usage.js";

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
