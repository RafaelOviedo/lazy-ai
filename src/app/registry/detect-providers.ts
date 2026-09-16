import { access, readdir, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { providerHomePath, providerLabels, providerOrder } from "./provider-registry.js";

import type { ProviderId } from "../../entities/provider/index.js";

/**
 * A provider moves through these states before lazy-ai can use it.
 */
export type ProviderAvailability = "not-installed" | "not-authenticated" | "ready";

export type ProviderStatus = {
  /** Who is signed in, or how, when the provider exposes it without reading a token. */
  accountLabel: string | null;
  availability: ProviderAvailability;
  /** Ready providers can still have no history yet, which is a different empty state. */
  hasSessions: boolean;
  label: string;
  providerId: ProviderId;
};

type ProviderProbe = {
  apiKeyEnvVars: string[];
  binaryName: string;
  credentialFile: string;
  readAccountLabel(homePath: string): Promise<string | null>;
  readCredentialToken(credentials: Record<string, unknown>): string | null;
  sessionsDirectory: string;
  sessionsDepth: number;
};

const providerProbes: Record<ProviderId, ProviderProbe> = {
  "claude-code": {
    apiKeyEnvVars: ["ANTHROPIC_API_KEY"],
    binaryName: "claude",
    credentialFile: ".credentials.json",
    readAccountLabel: readClaudeAccountLabel,
    readCredentialToken: (credentials) => {
      const oauth = credentials.claudeAiOauth;

      return isObject(oauth) && typeof oauth.accessToken === "string" ? oauth.accessToken : null;
    },
    sessionsDirectory: "projects",
    sessionsDepth: 2,
  },
  codex: {
    apiKeyEnvVars: ["CODEX_API_KEY", "OPENAI_API_KEY"],
    binaryName: "codex",
    credentialFile: "auth.json",
    readAccountLabel: readCodexAccountLabel,
    readCredentialToken: (credentials) => {
      const tokens = credentials.tokens;

      if (isObject(tokens) && typeof tokens.access_token === "string") return tokens.access_token;

      return typeof credentials.OPENAI_API_KEY === "string" ? credentials.OPENAI_API_KEY : null;
    },
    sessionsDirectory: "sessions",
    sessionsDepth: 4,
  },
};

/**
 * Reports how far along each provider is: absent, installed but signed out, or
 * usable. Never reads a credential value beyond checking that one is present.
 */
export async function detectProviderStatuses(): Promise<ProviderStatus[]> {
  return Promise.all(providerOrder.map((providerId) => detectProviderStatus(providerId)));
}

/**
 * Picks the provider the app should boot into: a usable one first, otherwise one
 * that is at least installed so the user can be told what is missing.
 */
export function resolvePreferredProvider(statuses: ProviderStatus[]): ProviderId | null {
  const withSessions = statuses.find((status) => status.availability === "ready" && status.hasSessions);

  if (withSessions) return withSessions.providerId;

  const ready = statuses.find((status) => status.availability === "ready");

  if (ready) return ready.providerId;

  const installed = statuses.find((status) => status.availability !== "not-installed");

  return installed?.providerId ?? null;
}

/**
 * Resolves one provider's state from its CLI, credential store, and history.
 */
async function detectProviderStatus(providerId: ProviderId): Promise<ProviderStatus> {
  const probe = providerProbes[providerId];
  const homePath = providerHomePath(providerId);
  const label = providerLabels[providerId];

  const [hasBinary, hasHome] = await Promise.all([
    isBinaryOnPath(probe.binaryName),
    isReadable(homePath),
  ]);

  if (!hasBinary && !hasHome) {
    return { accountLabel: null, availability: "not-installed", hasSessions: false, label, providerId };
  }

  const [isAuthenticated, accountLabel, hasSessions] = await Promise.all([
    hasCredentials(homePath, probe),
    probe.readAccountLabel(homePath),
    hasAnyTranscript(join(homePath, probe.sessionsDirectory), probe.sessionsDepth),
  ]);

  return {
    accountLabel,
    availability: isAuthenticated ? "ready" : "not-authenticated",
    hasSessions,
    label,
    providerId,
  };
}

/**
 * Checks for a stored credential or an API key in the environment. Presence only
 * — the token itself is never returned or logged.
 */
async function hasCredentials(homePath: string, probe: ProviderProbe): Promise<boolean> {
  if (probe.apiKeyEnvVars.some((name) => Boolean(process.env[name]?.trim()))) return true;

  const credentials = await readJsonFile(join(homePath, probe.credentialFile));

  if (!credentials) return false;

  return Boolean(probe.readCredentialToken(credentials)?.trim());
}

/**
 * Claude Code records the signed-in account separately from the token store.
 */
async function readClaudeAccountLabel(homePath: string): Promise<string | null> {
  const config = await readJsonFile(join(homePath, "..", ".claude.json"));
  const account = config?.oauthAccount;

  if (!isObject(account)) return null;

  return typeof account.emailAddress === "string" ? account.emailAddress : null;
}

/**
 * Codex records how the user signed in rather than who they are.
 */
async function readCodexAccountLabel(homePath: string): Promise<string | null> {
  const credentials = await readJsonFile(join(homePath, "auth.json"));

  return typeof credentials?.auth_mode === "string" ? credentials.auth_mode : null;
}

/**
 * Looks for any persisted transcript, stopping at the first hit.
 */
async function hasAnyTranscript(directoryPath: string, maxDepth: number): Promise<boolean> {
  if (maxDepth < 0) return false;

  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) return true;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await hasAnyTranscript(join(directoryPath, entry.name), maxDepth - 1)) return true;
  }

  return false;
}

/**
 * Resolves an executable across PATH, honouring Windows executable extensions.
 */
async function isBinaryOnPath(binaryName: string): Promise<boolean> {
  const searchPath = process.env.PATH ?? "";
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [];

  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    for (const extension of ["", ...extensions]) {
      if (await isReadable(join(directory, `${binaryName}${extension}`))) return true;
    }
  }

  return false;
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
