import { homedir } from "node:os";
import { join } from "node:path";

import { ClaudeSessionRepository } from "../../providers/claude/claude-session-repository.js";
import { CodexAppServerClient } from "../../providers/codex/codex-app-server-client.js";
import { CodexSessionRepository } from "../../providers/codex/codex-session-repository.js";
import { SessionGroupingProjectReader } from "../../entities/project/index.js";

import type { ProviderId, ProviderProfile } from "../../entities/provider/index.js";

export const providerLabels: Record<ProviderId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

/**
 * Providers are offered in this order wherever the app lists them.
 */
export const providerOrder: ProviderId[] = ["claude-code", "codex"];

/**
 * Resolves a provider's data directory, honouring the relocation variable each
 * CLI documents so detection and the readers never disagree about where to look.
 */
export function providerHomePath(providerId: ProviderId): string {
  if (providerId === "claude-code") {
    return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
  }

  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

/**
 * Builds a fresh profile for one provider. Callers own disposing its client.
 */
export function createProviderProfile(providerId: ProviderId, modelId: string | null = null): ProviderProfile {
  if (providerId === "claude-code") {
    const sessions = new ClaudeSessionRepository({ claudeRootPath: providerHomePath("claude-code") });

    return {
      client: null,
      id: "claude-code",
      label: providerLabels["claude-code"],
      projects: new SessionGroupingProjectReader(sessions),
      sessions,
    };
  }

  const sessions = new CodexSessionRepository({ codexRootPath: providerHomePath("codex") });

  return {
    client: new CodexAppServerClient({ model: modelId }),
    id: "codex",
    label: providerLabels.codex,
    projects: new SessionGroupingProjectReader(sessions),
    sessions,
  };
}
