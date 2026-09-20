import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

const standardEfforts: EffortLevel[] = ["low", "medium", "high", "max"];
const extendedEfforts: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * The entitlement cache has no effort capabilities. Keep an explicit offline
 * table from https://code.claude.com/docs/en/model-config#adjust-effort-level
 * (2026-09-20); unknown models deliberately have no selectable override.
 */
export function getClaudeSupportedEfforts(modelId: string): EffortLevel[] {
  const model = modelId.replace(/-claude-ai$/, "").replace(/-\d{8}$/, "").replace(/\[.*\]$/, "");
  if (["claude-opus-4-6", "claude-sonnet-4-6"].includes(model)) return [...standardEfforts];
  if (["claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-sonnet-5",
    "claude-fable-5", "claude-fable-5-1"].includes(model)) return [...extendedEfforts];
  return [];
}

export function parseClaudeEffort(effort: string | null): EffortLevel | null {
  if (effort === null) return null;
  if (!extendedEfforts.includes(effort as EffortLevel)) {
    throw new Error(`Unsupported Claude thinking level: ${effort}`);
  }
  return effort as EffortLevel;
}
