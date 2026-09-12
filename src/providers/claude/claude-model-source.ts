import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ModelOption } from "../../entities/ai-model/index.js";
import type { ClaudeModelAccessEntry, ClaudeModelSourceOptions } from "./types.js";

type ClaudeModelDescription = {
  familyIndex: number;
  label: string;
  versionParts: number[];
};

const modelFamilyOrder = ["opus", "sonnet", "haiku", "fable"];

/**
 * Reads the entitled model list Claude Code caches on disk so the picker opens instantly.
 */
export class ClaudeModelSource {
  private readonly configPath: string;
  private readonly settingsPath: string;

  constructor(options: ClaudeModelSourceOptions = {}) {
    this.configPath = options.configPath ?? join(homedir(), ".claude.json");
    this.settingsPath = options.settingsPath ?? join(homedir(), ".claude", "settings.json");
  }

  /**
   * Resolves the model Claude Code would start on: an enforced org default, then
   * the user's configured model, then the newest entitled model.
   */
  async getDefaultModel(): Promise<ModelOption | null> {
    const models = await this.listModels();

    if (models.length === 0) return null;

    const [orgDefault, configuredModel] = await Promise.all([
      this.readEnforcedOrgModel(),
      this.readConfiguredModel(),
    ]);

    return this.matchModel(models, orgDefault)
      ?? this.matchModel(models, configuredModel)
      ?? models[0];
  }

  /**
   * Matches a wire id or a family alias such as `opus` or `opus[1m]`.
   */
  private matchModel(models: ModelOption[], candidate: string | null): ModelOption | undefined {
    if (!candidate) return undefined;

    const exactMatch = models.find((model) => model.id === candidate);

    if (exactMatch) return exactMatch;

    const alias = candidate.replace(/\[.*\]$/, "").toLowerCase();

    return models.find((model) => model.label.toLowerCase().startsWith(alias));
  }

  /**
   * Reads the user's configured model from Claude Code settings.
   */
  private async readConfiguredModel(): Promise<string | null> {
    try {
      const file = await readFile(this.settingsPath, "utf8");
      const parsed = JSON.parse(file) as { model?: unknown };

      return typeof parsed.model === "string" ? parsed.model : null;
    } catch {
      return null;
    }
  }

  /**
   * Reads an org-configured model only when it overrides the user's choice.
   */
  private async readEnforcedOrgModel(): Promise<string | null> {
    try {
      const file = await readFile(this.configPath, "utf8");
      const parsed = JSON.parse(file) as {
        orgModelDefaultCache?: { name?: unknown; override_user_selection?: unknown };
      };
      const orgDefault = parsed.orgModelDefaultCache;

      if (orgDefault?.override_user_selection !== true) return null;

      return typeof orgDefault.name === "string" ? orgDefault.name : null;
    } catch {
      return null;
    }
  }

  /**
   * Returns the models this account can actually use, newest family versions first.
   */
  async listModels(): Promise<ModelOption[]> {
    const entries = await this.readModelAccessEntries();

    return entries
      .filter((entry) => Boolean(entry.apiName) && entry.entitled === true)
      .map((entry) => {
        const apiName = entry.apiName as string;

        return { apiName, description: this.describeModel(apiName) };
      })
      .sort((left, right) => this.compareDescriptions(left.description, right.description))
      .map(({ apiName, description }) => ({
        id: apiName,
        providerId: "claude-code" as const,
        label: description.label,
      }));
  }

  /**
   * Turns a wire model id into the family/version label Claude Code shows.
   */
  private describeModel(apiName: string): ClaudeModelDescription {
    const normalized = apiName
      .replace(/^claude-/, "")
      .replace(/-claude-ai$/, "")
      .replace(/-\d{8}$/, "");

    const tokens = normalized.split("-");
    const familyPosition = tokens.findIndex((token) => modelFamilyOrder.includes(token));

    if (familyPosition === -1) {
      return { familyIndex: modelFamilyOrder.length, label: apiName, versionParts: [] };
    }

    const family = tokens[familyPosition];
    const versionParts = tokens
      .filter((_, index) => index !== familyPosition)
      .map((token) => Number(token))
      .filter((value) => Number.isFinite(value));
    const version = versionParts.join(".");
    const familyLabel = `${family.charAt(0).toUpperCase()}${family.slice(1)}`;

    return {
      familyIndex: modelFamilyOrder.indexOf(family),
      label: version ? `${familyLabel} ${version}` : familyLabel,
      versionParts,
    };
  }

  /**
   * Orders by model family, then by newest version within that family.
   */
  private compareDescriptions(left: ClaudeModelDescription, right: ClaudeModelDescription): number {
    if (left.familyIndex !== right.familyIndex) {
      return left.familyIndex - right.familyIndex;
    }

    const partCount = Math.max(left.versionParts.length, right.versionParts.length);

    for (let index = 0; index < partCount; index += 1) {
      const leftPart = left.versionParts[index] ?? 0;
      const rightPart = right.versionParts[index] ?? 0;

      if (leftPart !== rightPart) return rightPart - leftPart;
    }

    return 0;
  }

  /**
   * Reads cached model entitlements and falls back to an empty list when Claude Code is absent.
   */
  private async readModelAccessEntries(): Promise<ClaudeModelAccessEntry[]> {
    try {
      const file = await readFile(this.configPath, "utf8");
      const parsed = JSON.parse(file) as { modelAccessCache?: unknown };

      return Array.isArray(parsed.modelAccessCache) ? parsed.modelAccessCache as ClaudeModelAccessEntry[] : [];
    } catch {
      return [];
    }
  }
}
