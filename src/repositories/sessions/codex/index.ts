import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";

import type {
  CodexConversationMessage,
  CodexSessionReader,
  CodexSessionConversation,
  CodexSessionRepositoryOptions,
  CodexSessionSummary,
  CodexConversationRole,
  SessionContext,
  SessionIndexRow,
  SessionMetaEvent,
  ThreadSettingsAppliedEvent,
  TokenCountEvent,
  TurnContextEvent,
  UsageLimit,
  UsageLimitSnapshot,
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

    for (const [sessionId, sessionFilePath] of sessionFiles) {
      const indexRow = latestIndexRows.get(sessionId);
      const sessionContext = await this.readSessionContext(sessionFilePath);

      if (!sessionContext?.cwd) continue;
      if (projectPath && sessionContext.cwd !== projectPath) continue;

      const updatedAt = indexRow?.updated_at ?? sessionContext.updatedAt ?? "";

      sessions.push({
        id: sessionContext.sessionId ?? sessionId,
        title: this.resolveSessionTitle(indexRow?.thread_name, sessionContext.title),
        updatedAt,
        relativeUpdated: this.formatRelativeTime(updatedAt),
        projectPath: sessionContext.cwd,
        projectName: basename(sessionContext.cwd) || sessionContext.cwd,
        model: sessionContext.model ?? "unknown",
        contextUsage: sessionContext.contextUsage,
        usageLimit: sessionContext.usageLimit,
        status: "saved",
      });
    }

    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /**
   * Returns display-ready conversation messages for one persisted session.
   */
  async getConversation(sessionId: string): Promise<CodexSessionConversation> {
    const sessionFiles = await this.findSessionFiles(this.sessionsDirectoryPath);
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
   * Returns the newest Codex usage-limit snapshot seen in any persisted session.
   */
  async getLatestUsageLimit(): Promise<UsageLimitSnapshot | null> {
    const sessionFiles = await this.findSessionFiles(this.sessionsDirectoryPath);
    let latestSnapshot: UsageLimitSnapshot | null = null;

    for (const sessionFilePath of sessionFiles.values()) {
      const snapshot = await this.readLatestUsageLimitSnapshot(sessionFilePath);

      if (!snapshot) continue;
      if (!latestSnapshot || snapshot.observedAt.localeCompare(latestSnapshot.observedAt) > 0) {
        latestSnapshot = snapshot;
      }
    }

    return latestSnapshot;
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
        .map((line) => this.parseJsonObject(line) as T | null)
        .filter((record): record is T => record !== null);
    } catch {
      return [];
    }
  }

  /**
   * Extracts user-visible conversation items from a persisted session file.
   */
  private async readConversationMessages(filePath: string, sessionId: string): Promise<CodexConversationMessage[]> {
    try {
      const file = await readFile(filePath, "utf8");
      const messages: CodexConversationMessage[] = [];

      for (const [index, line] of file.split("\n").entries()) {
        const trimmedLine = line.trim();

        if (!trimmedLine) continue;

        const record = this.parseJsonObject(trimmedLine);
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
   * Converts a raw Codex response item into a normalized conversation message.
   */
  private readConversationMessage(record: Record<string, unknown> | null, fallbackId: string): CodexConversationMessage | null {
    if (!record || record.type !== "response_item" || !this.isObject(record.payload)) {
      return null;
    }

    const payload = record.payload;
    const payloadType = payload.type;
    const timestamp = typeof record.timestamp === "string" ? record.timestamp : undefined;

    if (payloadType === "message") {
      const role = this.readConversationRole(payload.role);
      const text = this.readContentText(payload.content).trim();

      if (!role || !text) return null;
      if (role === "user" && this.isInjectedUserMessage(payload, text)) return null;

      return {
        id: this.readString(payload.id) ?? fallbackId,
        role,
        text,
        timestamp,
      };
    }

    return null;
  }

  /**
   * Keeps hidden setup roles out of the user-facing transcript.
   */
  private readConversationRole(role: unknown): CodexConversationRole | null {
    if (role === "user" || role === "assistant") return role;

    return null;
  }

  /**
   * Pulls readable text from Codex message content blocks.
   */
  private readContentText(content: unknown): string {
    if (typeof content === "string") return content;

    if (!Array.isArray(content)) return "";

    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!this.isObject(part)) return "";

        return this.readString(part.text) ?? this.readString(part.content) ?? "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * Skips host-injected context records that are stored as user messages.
   */
  private isInjectedUserMessage(payload: Record<string, unknown>, text: string): boolean {
    const metadata = payload.internal_chat_message_metadata_passthrough;

    if (this.isObject(metadata) && Array.isArray(metadata.content_item_kinds)) {
      return !metadata.content_item_kinds.includes("user.text");
    }

    return this.isInjectedContextText(text);
  }

  /**
   * Identifies setup/context blocks that should not become conversation titles.
   */
  private isInjectedContextText(text: string): boolean {
    const normalizedText = text.trim();

    return normalizedText.startsWith("<recommended_plugins>")
      || normalizedText.startsWith("<environment_context>")
      || normalizedText.startsWith("<skills_instructions>")
      || normalizedText.startsWith("<permissions instructions>")
      || normalizedText.startsWith("<apps_instructions>")
      || normalizedText.startsWith("<plugins_instructions>");
  }

  /**
   * Parses a JSON object and ignores non-object JSON values.
   */
  private parseJsonObject(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown;

      return this.isObject(parsed) ? parsed : null;
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
   * Reads a non-empty string field.
   */
  private readString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
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

        const record = this.parseJsonObject(trimmedLine);

        if (!record) continue;

        const timestamp = this.readString(record.timestamp);

        if (timestamp && (!sessionContext.updatedAt || timestamp.localeCompare(sessionContext.updatedAt) > 0)) {
          sessionContext.updatedAt = timestamp;
        }

        if (record.type === "session_meta" && record.payload) {
          const payload = record.payload as SessionMetaEvent["payload"] & { id?: string; session_id?: string };

          sessionContext.cwd = payload.cwd ?? sessionContext.cwd;
          sessionContext.model = payload.model ?? sessionContext.model;
          sessionContext.sessionId = payload.session_id ?? payload.id ?? sessionContext.sessionId;
          continue;
        }

        if (record.type === "turn_context" && record.payload) {
          const payload = record.payload as NonNullable<TurnContextEvent["payload"]>;

          sessionContext.cwd = sessionContext.cwd ?? payload.cwd;
          sessionContext.model = payload.model ?? sessionContext.model;
          continue;
        }

        if (record.type === "event_msg" && this.isObject(record.payload) && record.payload.type === "thread_settings_applied") {
          const payload = record.payload as NonNullable<ThreadSettingsAppliedEvent["payload"]>;

          sessionContext.model = payload.thread_settings?.model ?? sessionContext.model;
          continue;
        }

        if (record.type === "event_msg" && this.isObject(record.payload) && record.payload.type === "user_message") {
          const message = this.readString(record.payload.message);

          sessionContext.title = sessionContext.title ?? this.formatSessionTitle(message);
          continue;
        }

        const conversationMessage = this.readConversationMessage(record, "");

        if (conversationMessage?.role === "user") {
          sessionContext.title = sessionContext.title ?? this.formatSessionTitle(conversationMessage.text);
        }

        if (record.type === "event_msg" && this.isObject(record.payload) && record.payload.type === "token_count") {
          const payload = record.payload as NonNullable<TokenCountEvent["payload"]>;
          const usedTokens = payload.info?.last_token_usage?.input_tokens;
          const maxTokens = payload.info?.model_context_window;

          if (this.isPositiveNumber(usedTokens) && this.isPositiveNumber(maxTokens)) {
            sessionContext.contextUsage = {
              usedTokens,
              maxTokens,
              percent: Math.min(100, Math.round((usedTokens / maxTokens) * 100)),
            };
          }

          if (payload.rate_limits) {
            sessionContext.usageLimit = this.readUsageLimit(payload.rate_limits, sessionContext.usageLimit);
          }
        }
      }

      return Object.keys(sessionContext).length > 0 ? sessionContext : null;
    } catch {
      return null;
    }
  }

  /**
   * Reads the latest usage-limit event from one persisted session file.
   */
  private async readLatestUsageLimitSnapshot(filePath: string): Promise<UsageLimitSnapshot | null> {
    try {
      const file = await readFile(filePath, "utf8");
      const lines = file.split("\n");
      let snapshot: UsageLimitSnapshot | null = null;
      let previousUsageLimit: UsageLimit | undefined;

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine) continue;

        const record = this.parseJsonObject(trimmedLine) as TokenCountEvent | null;

        if (!record || record.type !== "event_msg" || record.payload?.type !== "token_count" || !record.payload.rate_limits || !record.timestamp) {
          continue;
        }

        previousUsageLimit = this.readUsageLimit(record.payload.rate_limits, previousUsageLimit);
        snapshot = {
          usageLimit: previousUsageLimit,
          observedAt: record.timestamp,
        };
      }

      return snapshot;
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
   * Converts Codex rate-limit telemetry into display-ready usage data.
   */
  private readUsageLimit(rateLimits: NonNullable<TokenCountEvent["payload"]>["rate_limits"], previous?: UsageLimit): UsageLimit {
    const primary = this.readUsageLimitWindow(rateLimits?.primary) ?? previous?.primary;
    const secondary = this.readUsageLimitWindow(rateLimits?.secondary) ?? previous?.secondary;

    return {
      limitId: rateLimits?.limit_id ?? previous?.limitId,
      limitName: rateLimits && "limit_name" in rateLimits ? rateLimits.limit_name : previous?.limitName,
      primary,
      secondary,
      credits: rateLimits?.credits
        ? {
            hasCredits: rateLimits.credits.has_credits,
            unlimited: rateLimits.credits.unlimited,
            balance: rateLimits.credits.balance,
          }
        : previous?.credits,
      planType: rateLimits?.plan_type ?? previous?.planType,
      rateLimitReachedType: rateLimits && "rate_limit_reached_type" in rateLimits ? rateLimits.rate_limit_reached_type : previous?.rateLimitReachedType,
    };
  }

  /**
   * Converts one Codex limit window into bounded percentages.
   */
  private readUsageLimitWindow(windowUsage: NonNullable<NonNullable<TokenCountEvent["payload"]>["rate_limits"]>["primary"]): UsageLimit["primary"] {
    const usedPercent = windowUsage?.used_percent;

    if (!this.isPercentNumber(usedPercent)) return undefined;

    return {
      usedPercent,
      remainingPercent: Math.max(0, 100 - usedPercent),
      windowMinutes: this.isPositiveNumber(windowUsage?.window_minutes) ? windowUsage.window_minutes : undefined,
      resetsAt: this.isPositiveNumber(windowUsage?.resets_at) ? windowUsage.resets_at : undefined,
    };
  }

  /**
   * Checks whether a parsed JSON value is a bounded percentage.
   */
  private isPercentNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
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
   * Builds a compact title from the first user-visible prompt.
   */
  private formatSessionTitle(message: string | null): string | undefined {
    if (!message) return undefined;
    if (this.isInjectedContextText(message)) return undefined;

    return message.replace(/\s+/g, " ").trim().slice(0, 48);
  }

  /**
   * Prefers generated thread titles, but ignores placeholder index names.
   */
  private resolveSessionTitle(indexTitle: string | undefined, fallbackTitle: string | undefined): string {
    const normalizedIndexTitle = indexTitle?.trim();

    if (normalizedIndexTitle && normalizedIndexTitle !== "Untitled session") {
      return normalizedIndexTitle;
    }

    return fallbackTitle ?? "Untitled session";
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
