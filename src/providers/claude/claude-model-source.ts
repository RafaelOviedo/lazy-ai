import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ModelOption } from "../../app/types/index.js";
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

  constructor(options: ClaudeModelSourceOptions = {}) {
    this.configPath = options.configPath ?? join(homedir(), ".claude.json");
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
