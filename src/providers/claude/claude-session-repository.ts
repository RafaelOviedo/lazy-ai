import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";

import type {
  ConversationMessage,
  ConversationRole,
  SessionConversation,
  SessionSummary,
  UsageLimitSnapshot,
} from "../../app/types/index.js";
import type { SessionReader } from "../../app/ports/index.js";
import type {
  ClaudeSessionContext,
  ClaudeSessionRepositoryOptions,
  ClaudeTranscriptMessage,
  ClaudeTranscriptRecord,
  ClaudeTranscriptUsage,
} from "./types.js";

const standardContextWindow = 200000;
const extendedContextWindow = 1000000;
const injectedTextPrefixes = [
  "<local-command-caveat>",
  "<local-command-stdout>",
  "<command-name>",
  "<command-message>",
  "<system-reminder>",
  "<user-prompt-submit-hook>",
];

/**
 * Reads persisted Claude Code sessions from the local Claude data directory.
 */
export class ClaudeSessionRepository implements SessionReader {
  private readonly projectsDirectoryPath: string;
  private readonly sessionContextCache = new Map<string, { context: ClaudeSessionContext; modifiedAtMs: number }>();

  constructor(options: ClaudeSessionRepositoryOptions = {}) {
    const claudeRootPath = options.claudeRootPath ?? join(homedir(), ".claude");

    this.projectsDirectoryPath = join(claudeRootPath, "projects");
  }

  /**
   * Claude Code stores each workspace under a slugged directory, so a scoped
   * lookup can read one project's transcripts instead of every project's.
   */
  private resolveScanRoot(projectPath?: string): string {
    if (!projectPath) return this.projectsDirectoryPath;

    return join(this.projectsDirectoryPath, projectPath.replace(/[^a-zA-Z0-9]/g, "-"));
  }

  /**
   * Returns the latest persisted sessions, optionally scoped to one project path.
   */
  async listByProject(projectPath?: string): Promise<SessionSummary[]> {
    const sessionFiles = await this.findSessionFiles(this.resolveScanRoot(projectPath));
    const sessions: SessionSummary[] = [];

    for (const [sessionId, sessionFilePath] of sessionFiles) {
      const sessionContext = await this.readSessionContext(sessionFilePath);

      if (!sessionContext?.cwd) continue;
      if (projectPath && !this.isSameProjectPath(sessionContext.cwd, projectPath)) continue;

      const updatedAt = sessionContext.updatedAt ?? "";

      sessions.push({
        id: sessionContext.sessionId ?? sessionId,
        title: sessionContext.title ?? "Untitled session",
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
   * Returns display-ready conversation messages for one persisted session.
   */
  async getConversation(sessionId: string): Promise<SessionConversation> {
    const sessionFiles = await this.findSessionFiles(this.projectsDirectoryPath, true);
    const sessionFilePath = sessionFiles.get(sessionId);

    if (!sessionFilePath) {
      return {
        sessionId,
        messages: [],
      };
    }

    return {
      sessionId,
      messages: await this.readConversationMessages(sessionFilePath, sessionId),
    };
  }

  /**
   * Claude Code does not persist rate-limit telemetry in its transcripts.
   */
  async getLatestUsageLimit(): Promise<UsageLimitSnapshot | null> {
    return null;
  }

  /**
   * Extracts project, model, and token context from a persisted transcript.
   */
  private async readSessionContext(filePath: string): Promise<ClaudeSessionContext | null> {
    const cached = this.sessionContextCache.get(filePath);

    try {
      const fileStats = await stat(filePath);

      if (cached && cached.modifiedAtMs === fileStats.mtimeMs) {
        return cached.context;
      }

      const file = await readFile(filePath, "utf8");
      const sessionContext: ClaudeSessionContext = { updatedAt: fileStats.mtime.toISOString() };
      let firstUserPrompt: string | undefined;

      for (const line of file.split("\n")) {
        // Transcripts are dominated by large tool-result records. Only parse the
        // lines that can carry the fields a summary needs.
        if (!this.isSummaryLine(line, Boolean(sessionContext.cwd), Boolean(firstUserPrompt))) continue;

        const record = this.parseRecord(line);

        if (!record) continue;

        sessionContext.cwd = sessionContext.cwd ?? record.cwd;
        sessionContext.sessionId = sessionContext.sessionId ?? record.sessionId;

        if (record.type === "ai-title" && record.aiTitle?.trim()) {
          sessionContext.title = record.aiTitle.trim();
          continue;
        }

        if (record.type === "assistant" && record.message) {
          sessionContext.model = record.message.model ?? sessionContext.model;
          sessionContext.contextUsage = this.readContextUsage(record.message) ?? sessionContext.contextUsage;
          continue;
        }

        if (record.type === "user" && !firstUserPrompt) {
          const message = this.readConversationMessage(record, "");

          if (message) {
            firstUserPrompt = this.formatSessionTitle(message.text);
          }
        }
      }

      sessionContext.title = sessionContext.title ?? firstUserPrompt;

      this.sessionContextCache.set(filePath, { context: sessionContext, modifiedAtMs: fileStats.mtimeMs });

      return sessionContext;
    } catch {
      return null;
    }
  }

  /**
   * Cheap pre-filter that avoids parsing transcript lines a summary cannot use.
   */
  private isSummaryLine(line: string, hasCwd: boolean, hasUserPrompt: boolean): boolean {
    if (!line.trim()) return false;
    if (this.hasRecordType(line, "ai-title") || this.hasRecordType(line, "assistant")) return true;
    if (!hasCwd) return true;

    return !hasUserPrompt && this.hasRecordType(line, "user");
  }

  /**
   * Matches a record type without parsing, tolerating either JSON spacing style.
   */
  private hasRecordType(line: string, recordType: string): boolean {
    return line.includes(`"type":"${recordType}"`) || line.includes(`"type": "${recordType}"`);
  }

  /**
   * Extracts user-visible conversation items from a persisted transcript.
   */
  private async readConversationMessages(filePath: string, sessionId: string): Promise<ConversationMessage[]> {
    try {
      const file = await readFile(filePath, "utf8");
      const messages: ConversationMessage[] = [];

      for (const [index, line] of file.split("\n").entries()) {
        const record = this.parseRecord(line);

        if (!record) continue;

        const message = this.readConversationMessage(record, `${sessionId}:${index}`);

        if (message) {
          messages.push(message);
        }
      }

      return messages;
    } catch {
      return [];
    }
  }

  /**
   * Converts a raw transcript record into a normalized conversation message.
   */
  private readConversationMessage(record: ClaudeTranscriptRecord, fallbackId: string): ConversationMessage | null {
    if (record.isMeta || record.isSidechain) return null;

    const role = this.readConversationRole(record.type);

    if (!role || !record.message) return null;

    const text = this.readContentText(record.message.content).trim();

    if (!text) return null;
    if (role === "user" && this.isInjectedText(text)) return null;

    return {
      id: record.uuid ?? fallbackId,
      role,
      text,
      timestamp: record.timestamp,
    };
  }

  /**
   * Keeps hidden transcript roles out of the user-facing conversation.
   */
  private readConversationRole(type: string | undefined): ConversationRole | null {
    if (type === "user" || type === "assistant") return type;

    return null;
  }

  /**
   * Pulls readable text from Claude message content blocks, skipping tool traffic.
   */
  private readContentText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!this.isObject(part)) return "";
        if (part.type !== "text") return "";

        return typeof part.text === "string" ? part.text : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * Skips host-injected records that Claude Code stores as user messages.
   */
  private isInjectedText(text: string): boolean {
    const normalizedText = text.trim();

    return injectedTextPrefixes.some((prefix) => normalizedText.startsWith(prefix));
  }

  /**
   * Converts assistant token usage into context-window pressure.
   */
  private readContextUsage(message: ClaudeTranscriptMessage): ClaudeSessionContext["contextUsage"] {
    const usage = message.usage;

    if (!usage) return undefined;

    const usedTokens = this.sumUsage(usage);

    if (usedTokens <= 0) return undefined;

    const maxTokens = usedTokens > standardContextWindow ? extendedContextWindow : standardContextWindow;

    return {
      usedTokens,
      maxTokens,
      percent: Math.min(100, Math.round((usedTokens / maxTokens) * 100)),
    };
  }

  /**
   * Adds the token buckets that occupy the context window.
   */
  private sumUsage(usage: ClaudeTranscriptUsage): number {
    return [usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .reduce((total, value) => total + value, 0);
  }

  /**
   * Compares project paths tolerantly because providers record separators and casing differently.
   */
  private isSameProjectPath(left: string, right: string): boolean {
    return this.normalizeProjectPath(left) === this.normalizeProjectPath(right);
  }

  /**
   * Normalizes a workspace path for comparison.
   */
  private normalizeProjectPath(projectPath: string): string {
    return projectPath.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  }

  /**
   * Parses one transcript line and ignores malformed entries.
   */
  private parseRecord(line: string): ClaudeTranscriptRecord | null {
    const trimmedLine = line.trim();

    if (!trimmedLine) return null;

    try {
      const parsed = JSON.parse(trimmedLine) as unknown;

      return this.isObject(parsed) ? parsed as ClaudeTranscriptRecord : null;
    } catch {
      return null;
    }
  }

  /**
   * Checks for a plain object value.
   */
  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * Walks the Claude projects tree and maps session ids to their backing files.
   */
  private async findSessionFiles(directoryPath: string, allowFallback = false): Promise<Map<string, string>> {
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

    // The slugged directory name is lossy, so fall back to a full scan when the
    // scoped guess finds nothing.
    if (sessionFiles.size === 0 && (allowFallback || directoryPath !== this.projectsDirectoryPath)) {
      await walk(this.projectsDirectoryPath);
    }

    return sessionFiles;
  }

  /**
   * Pulls a session UUID from a persisted transcript filename.
   */
  private extractSessionId(fileName: string): string | null {
    const match = fileName.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);

    return match?.[1] ?? null;
  }

  /**
   * Builds a compact title from the first user-visible prompt.
   */
  private formatSessionTitle(message: string): string | undefined {
    const normalizedMessage = message.replace(/\s+/g, " ").trim();

    return normalizedMessage ? normalizedMessage.slice(0, 48) : undefined;
  }

  /**
   * Formats an ISO timestamp into a short relative label for panel display.
   */
  private formatRelativeTime(timestamp: string): string {
    if (!timestamp) return "unknown";

    const updatedAt = new Date(timestamp).getTime();

    if (Number.isNaN(updatedAt)) return "unknown";

    const diffMinutes = Math.max(0, Math.floor((Date.now() - updatedAt) / 60000));

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
