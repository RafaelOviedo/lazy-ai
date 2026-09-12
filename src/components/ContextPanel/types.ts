import type { TermDOM } from "@b9g/termdom";

import type { SessionSummary } from "../../entities/session/index.js";

export type TermWindow = TermDOM["window"];

export type ContextPanelElement = HTMLElement & {
  projectName: string;
  projectPath: string;
  selectedSession: SessionSummary | null;
};
