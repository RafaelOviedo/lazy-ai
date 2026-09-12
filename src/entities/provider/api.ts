import type { ProviderId } from "./types.js";
import type { ProjectReader } from "../project/api.js";
import type { SessionReader } from "../session/api.js";

/**
 * Drives live turns for one provider. Null on a provider that can only be read.
 */
export interface ProviderRuntimeClient {
  deleteThread(threadId: string): Promise<unknown>;
  dispose(): void;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  resumeThread(threadId: string, cwd?: string): Promise<{ threadId: string }>;
  startThread(cwd?: string): Promise<{ sessionId: string; threadId: string }>;
  startTurn(threadId: string, prompt: string, cwd?: string): Promise<{ turnId: string }>;
  waitForTurnCompletion(threadId: string, turnId?: string): Promise<{ errorMessage?: string; status: string }>;
}

/**
 * Everything the app needs to render and drive one provider.
 */
export type ProviderProfile = {
  client: ProviderRuntimeClient | null;
  id: ProviderId;
  label: string;
  projects: ProjectReader;
  sessions: SessionReader;
};
