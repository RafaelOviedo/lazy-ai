import type { ContextUsage } from "../../app/types/index.js";

export type ClaudeModelSourceOptions = {
  configPath?: string;
  settingsPath?: string;
};

export type ClaudeModelAccessEntry = {
  apiName?: string;
  entitled?: boolean;
};

export type ClaudeSessionRepositoryOptions = {
  claudeRootPath?: string;
};

export type ClaudeTranscriptUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};

export type ClaudeTranscriptMessage = {
  role?: string;
  model?: string;
  content?: unknown;
  usage?: ClaudeTranscriptUsage;
};

export type ClaudeTranscriptRecord = {
  type?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  aiTitle?: string;
  message?: ClaudeTranscriptMessage;
};

export type ClaudeSessionContext = {
  contextUsage?: ContextUsage;
  cwd?: string;
  model?: string;
  sessionId?: string;
  title?: string;
  updatedAt?: string;
};
