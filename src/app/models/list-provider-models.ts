import { ClaudeModelSource } from "../../providers/claude/claude-model-source.js";
import { CodexModelSource } from "../../providers/codex/codex-model-source.js";
import { providerLabels } from "../registry/index.js";

import type { ProviderModelGroup } from "../types/index.js";

/**
 * Collects the selectable models of every provider installed on this machine.
 */
export async function listProviderModels(): Promise<ProviderModelGroup[]> {
  const [claudeModels, codexModels] = await Promise.all([
    new ClaudeModelSource().listModels(),
    new CodexModelSource().listModels(),
  ]);

  const groups: ProviderModelGroup[] = [
    {
      providerId: "claude-code",
      label: providerLabels["claude-code"],
      models: claudeModels,
    },
    {
      providerId: "codex",
      label: providerLabels.codex,
      models: codexModels,
    },
  ];

  return groups.filter((group) => group.models.length > 0);
}
