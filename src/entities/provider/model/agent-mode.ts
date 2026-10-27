import type { ProviderId } from "../types.js";

export const agentModes = ["manual", "acceptEdits", "auto", "plan"] as const;
export type AgentMode = typeof agentModes[number];
export type ModeAvailability = Partial<Record<AgentMode, string>>;
export const modeLabels: Record<AgentMode, string> = {
  manual: "Manual", acceptEdits: "Accept edits", auto: "Auto", plan: "Plan",
};

export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && agentModes.includes(value as AgentMode);
}

export function describeMode(mode: AgentMode, provider: ProviderId): string {
  if (mode === "plan") return "Explore and propose a plan. Select an implementation mode before making changes.";
  if (provider === "claude-code") {
    return {
      manual: "Ask before actions that are not already permitted.",
      acceptEdits: "Allow ordinary file edits and filesystem operations; ask for other actions.",
      auto: "Claude reviews actions automatically. Requires a supported model and configuration.",
    }[mode];
  }
  return {
    manual: "Read-only workspace; ask before changes and untrusted commands.",
    acceptEdits: "Allow workspace writes; ask before untrusted commands and escalations.",
    auto: "Allow workspace actions; automatically review eligible escalations.",
  }[mode];
}

export function claudePermissionMode(mode: AgentMode) {
  return mode === "manual" ? "default" : mode;
}

export function codexModePolicy(mode: AgentMode, cwd: string) {
  const readOnly = mode === "manual" || mode === "plan";
  return {
    approvalPolicy: mode === "plan" ? "never" : mode === "auto" ? "on-request" : "untrusted",
    approvalsReviewer: mode === "auto" ? "auto_review" : "user",
    sandbox: readOnly ? "read-only" : "workspace-write",
    sandboxPolicy: readOnly
      ? { type: "readOnly", networkAccess: false }
      : { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false,
        excludeTmpdirEnvVar: true, excludeSlashTmp: true },
  };
}

export const planFinishedMessage = "The plan is ready for review. Present the complete plan in your final response and end this turn without implementing it. The user will select an implementation mode with f in Lazy AI, then send a follow-up prompt with p. Stay in Plan mode until then.";
