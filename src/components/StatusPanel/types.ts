import type { TermDOM } from "@b9g/termdom";

import type { UsageLimitSnapshot } from "../../entities/provider/index.js";
import type { SessionSummary } from "../../entities/session/index.js";

export type TermWindow = TermDOM["window"];

export type StatusPanelElement = HTMLElement & {
  activeModelIsDefault: boolean;
  activeModelLabel: string | null;
  activeProviderLabel: string;
  loadError: string | null;
  projectLoadError: string | null;
  selectedSession: SessionSummary | null;
  usageLimitSnapshot: UsageLimitSnapshot | null;
};
