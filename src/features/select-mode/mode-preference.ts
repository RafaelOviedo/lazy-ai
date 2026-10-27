import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isAgentMode, type AgentMode } from "../../entities/provider/model/agent-mode.js";

export function modeSettingsPath(): string {
  const root = process.env.XDG_CONFIG_HOME || (process.platform === "win32" ? process.env.APPDATA : null)
    || join(homedir(), ".config");
  return join(root, "lazy-ai", "settings.json");
}

/** Owns only Lazy AI preferences; provider configuration is never rewritten. */
export function createModePreference(path = modeSettingsPath()) {
  let mode: AgentMode = "manual";
  let settings: Record<string, unknown> = {};
  return {
    get: () => mode,
    async load(): Promise<void> {
      mode = "manual";
      try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a settings object.");
        settings = parsed as Record<string, unknown>;
        if (settings.mode !== undefined && !isAgentMode(settings.mode)) throw new Error("Unknown saved mode.");
        mode = isAgentMode(settings.mode) ? settings.mode : "manual";
      } catch (error) {
        mode = "manual";
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new Error(`Could not read Lazy AI settings at ${path}. Using Manual. ${error instanceof Error ? error.message : ""}`);
      }
    },
    async save(next: AgentMode): Promise<void> {
      if (!isAgentMode(next)) throw new Error("Unknown agent mode.");
      const updated = { ...settings, mode: next };
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      settings = updated;
      mode = next;
    },
  };
}

export const modePreference = createModePreference();
export let modePreferenceLoadError: string | null = null;
export async function loadModePreference(): Promise<void> {
  try { await modePreference.load(); }
  catch (error) { modePreferenceLoadError = (error as Error).message; }
}
