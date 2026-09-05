import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";

import type {
  CodexSessionReader,
  CodexSessionRepositoryOptions,
  CodexSessionSummary,
  SessionContext,
  SessionIndexRow,
  SessionMetaEvent,
  ThreadSettingsAppliedEvent,
  TokenCountEvent,
  TurnContextEvent,
} from "./types";

/**
 * Reads persisted Codex sessions from the local Codex data directory.
 */
export class CodexSessionRepository implements CodexSessionReader {
  private readonly sessionIndexPath: string;
  private readonly sessionsDirectoryPath: string;

  constructor(options: CodexSessionRepositoryOptions = {}) {
    const codexRootPath = options.codexRootPath ?? join(homedir(), ".codex");

    this.sessionIndexPath = join(codexRootPath, "session_index.jsonl");
    this.sessionsDirectoryPath = join(codexRootPath, "sessions");
  }

  /**
   * Returns the latest persisted sessions, optionally scoped to one project path.
   */
  async listByProject(projectPath?: string): Promise<CodexSessionSummary[]> {
    const indexRows = await this.readJsonlFile<SessionIndexRow>(this.sessionIndexPath);
    const latestIndexRows = new Map<string, SessionIndexRow>();

    for (const row of indexRows) {
      if (!row.id) continue;
      latestIndexRows.set(row.id, row);
    }

    const sessionFiles = await this.findSessionFiles(this.sessionsDirectoryPath);
    const sessions: CodexSessionSummary[] = [];

    for (const row of latestIndexRows.values()) {
      const sessionFilePath = sessionFiles.get(row.id);

      if (!sessionFilePath) continue;

      const sessionContext = await this.readSessionContext(sessionFilePath);

      if (!sessionContext?.cwd) continue;
      if (projectPath && sessionContext.cwd !== projectPath) continue;

      const updatedAt = row.updated_at ?? "";

      sessions.push({
        id: row.id,
        title: row.thread_name?.trim() || "Untitled session",
        updatedAt,
        relativeUpdated: this.formatRelativeTime(updatedAt),
        projectPath: sessionContext.cwd,
        projectName: basename(sessionContext.cwd) || sessionContext.cwd,
        model: sessionContext.model ?? "unknown",
        contextUsage: sessionContext.contextUsage,
        status: "saved",
      });
    }

    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /**
   * Reads a JSONL file into parsed objects and falls back to an empty list.
   */
  private async readJsonlFile<T>(filePath: string): Promise<T[]> {
    try {
      const file = await readFile(filePath, "utf8");

      return file
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
    } catch {
      return [];
    }
  }

  /**
   * Extracts project and model context from a persisted session file.
   */
  private async readSessionContext(filePath: string): Promise<SessionContext | null> {
    try {
      const file = await readFile(filePath, "utf8");
      const lines = file.split("\n");
      const sessionContext: SessionContext = {};

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine) continue;

        const record = JSON.parse(trimmedLine) as SessionMetaEvent | ThreadSettingsAppliedEvent | TokenCountEvent | TurnContextEvent;

        if (record.type === "session_meta" && record.payload) {
          sessionContext.cwd = record.payload.cwd ?? sessionContext.cwd;
          sessionContext.model = record.payload.model ?? sessionContext.model;
          continue;
        }

        if (record.type === "turn_context" && record.payload) {
          sessionContext.cwd = sessionContext.cwd ?? record.payload.cwd;
          sessionContext.model = record.payload.model ?? sessionContext.model;
          continue;
        }

        if (record.type === "event_msg" && record.payload?.type === "thread_settings_applied") {
          sessionContext.model = record.payload.thread_settings?.model ?? sessionContext.model;
          continue;
        }

        if (record.type === "event_msg" && record.payload?.type === "token_count") {
          const usedTokens = record.payload.info?.last_token_usage?.input_tokens;
          const maxTokens = record.payload.info?.model_context_window;

          if (this.isPositiveNumber(usedTokens) && this.isPositiveNumber(maxTokens)) {
            sessionContext.contextUsage = {
              usedTokens,
              maxTokens,
              percent: Math.min(100, Math.round((usedTokens / maxTokens) * 100)),
            };
          }
        }
      }

      return Object.keys(sessionContext).length > 0 ? sessionContext : null;
    } catch {
      return null;
    }
  }

  /**
   * Checks whether a parsed JSON value is a usable positive number.
   */
  private isPositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }

  /**
   * Walks the Codex sessions tree and maps session ids to their backing files.
   */
  private async findSessionFiles(directoryPath: string): Promise<Map<string, string>> {
    const sessionFiles = new Map<string, string>();

    const walk = async (currentPath: string): Promise<void> => {
      try {
        const entries = await readdir(currentPath, { withFileTypes: true, encoding: "utf8" });

        for (const entry of entries) {
          const entryPath = join(currentPath, entry.name);

          if (entry.isDirectory()) {
            await walk(entryPath);
            continue;
          }

          if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

          const sessionId = this.extractSessionId(entry.name);

          if (!sessionId || sessionFiles.has(sessionId)) continue;

          sessionFiles.set(sessionId, entryPath);
        }
      } catch {
        return;
      }
    };

    await walk(directoryPath);

    return sessionFiles;
  }

  /**
   * Pulls a session UUID from a persisted Codex session filename.
   */
  private extractSessionId(fileName: string): string | null {
    const match = fileName.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);

    return match?.[1] ?? null;
  }

  /**
   * Formats an ISO timestamp into a short relative label for panel display.
   */
  private formatRelativeTime(timestamp: string): string {
    if (!timestamp) return "unknown";

    const updatedAt = new Date(timestamp).getTime();

    if (Number.isNaN(updatedAt)) return "unknown";

    const diffMs = Date.now() - updatedAt;
    const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.floor(diffMinutes / 60);

    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);

    if (diffDays < 7) return `${diffDays}d ago`;

    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }
}
