import { access } from "node:fs/promises";
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

const providerDataPaths: Record<ProviderId, string> = {
  "claude-code": join(homedir(), ".claude", "projects"),
  codex: join(homedir(), ".codex", "sessions"),
};

/**
 * Providers are offered in this order wherever the app lists them.
 */
export const providerOrder: ProviderId[] = ["claude-code", "codex"];

/**
 * Builds a fresh profile for one provider. Callers own disposing its client.
 */
export function createProviderProfile(providerId: ProviderId, modelId: string | null = null): ProviderProfile {
  if (providerId === "claude-code") {
    const sessions = new ClaudeSessionRepository();

    return {
      client: null,
      id: "claude-code",
      label: providerLabels["claude-code"],
      projects: new SessionGroupingProjectReader(sessions),
      sessions,
    };
  }

  const sessions = new CodexSessionRepository();

  return {
    client: new CodexAppServerClient({ model: modelId }),
    id: "codex",
    label: providerLabels.codex,
    projects: new SessionGroupingProjectReader(sessions),
    sessions,
  };
}

/**
 * Returns the providers that have local data on this machine.
 */
export async function detectAvailableProviders(): Promise<ProviderId[]> {
  const availability = await Promise.all(
    providerOrder.map(async (providerId) => ({
      providerId,
      isAvailable: await isPathReadable(providerDataPaths[providerId]),
    })),
  );

  return availability
    .filter((entry) => entry.isAvailable)
    .map((entry) => entry.providerId);
}

/**
 * Checks whether a provider data directory exists and can be read.
 */
async function isPathReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
