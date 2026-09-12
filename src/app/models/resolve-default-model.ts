import { ClaudeModelSource } from "../../providers/claude/claude-model-source.js";
import { CodexModelSource } from "../../providers/codex/codex-model-source.js";

import type { ModelOption, ProviderId } from "../types/index.js";

/**
 * Resolves the model a provider starts new sessions on when lazy-ai sends no
 * override, so the status bar can name it instead of saying "default".
 */
export function resolveDefaultModel(providerId: ProviderId): Promise<ModelOption | null> {
  if (providerId === "claude-code") {
    return new ClaudeModelSource().getDefaultModel();
  }

  return new CodexModelSource().getDefaultModel();
}
