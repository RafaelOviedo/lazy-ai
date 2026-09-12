import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ModelOption } from "../../app/types/index.js";
import type { CodexModelSourceOptions, CodexModelsCacheEntry } from "./types.js";

const listedVisibility = "list";
const lowestPriority = Number.MAX_SAFE_INTEGER;

/**
 * Reads the model list Codex caches on disk so the picker opens without spawning the CLI.
 */
export class CodexModelSource {
  private readonly configPath: string;
  private readonly modelsCachePath: string;

  constructor(options: CodexModelSourceOptions = {}) {
    const codexRootPath = options.codexRootPath ?? join(homedir(), ".codex");

    this.configPath = join(codexRootPath, "config.toml");
    this.modelsCachePath = join(codexRootPath, "models_cache.json");
  }

  /**
   * Resolves the model Codex would pick when lazy-ai sends no override: the
   * configured model if the user pinned one, otherwise Codex's own top-ranked
   * listed model.
   */
  async getDefaultModel(): Promise<ModelOption | null> {
    const models = await this.listModels();

    if (models.length === 0) return null;

    const configuredSlug = await this.readConfiguredModelSlug();
    const configuredModel = configuredSlug
      ? models.find((model) => model.id === configuredSlug)
      : undefined;

    return configuredModel ?? models[0];
  }

  /**
   * Reads the top-level `model` key from config.toml, ignoring per-section keys.
   */
  private async readConfiguredModelSlug(): Promise<string | null> {
    try {
      const file = await readFile(this.configPath, "utf8");

      for (const line of file.split("\n")) {
        const trimmedLine = line.trim();

        // Only the preamble applies globally; stop at the first table header.
        if (trimmedLine.startsWith("[")) break;

        const match = trimmedLine.match(/^model\s*=\s*["']([^"']+)["']/);

        if (match) return match[1];
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Returns the user-selectable Codex models in the order Codex itself ranks them.
   */
  async listModels(): Promise<ModelOption[]> {
    const entries = await this.readModelEntries();

    return entries
      .filter((entry) => Boolean(entry.slug) && entry.visibility === listedVisibility)
      .sort((left, right) => (left.priority ?? lowestPriority) - (right.priority ?? lowestPriority))
      .map((entry) => ({
        id: entry.slug as string,
        providerId: "codex" as const,
        label: entry.display_name ?? (entry.slug as string),
        description: entry.description,
        defaultEffort: entry.default_reasoning_level,
        contextWindow: entry.context_window,
      }));
  }

  /**
   * Reads the cached model entries and falls back to an empty list when Codex is absent.
   */
  private async readModelEntries(): Promise<CodexModelsCacheEntry[]> {
    try {
      const file = await readFile(this.modelsCachePath, "utf8");
      const parsed = JSON.parse(file) as { models?: unknown };

      return Array.isArray(parsed.models) ? parsed.models as CodexModelsCacheEntry[] : [];
    } catch {
      return [];
    }
  }
}
