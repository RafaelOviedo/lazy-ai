import type { TermDOM } from "@b9g/termdom";

import type { SessionSummary, UsageLimitSnapshot } from "../../app/types/index.js";

export type TermWindow = TermDOM["window"];

export type StatusPanelElement = HTMLElement & {
  loadError: string | null;
  projectLoadError: string | null;
  selectedSession: SessionSummary | null;
  usageLimitSnapshot: UsageLimitSnapshot | null;
};
