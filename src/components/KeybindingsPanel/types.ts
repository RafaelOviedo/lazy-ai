import type { TermDOM } from "@b9g/termdom";

export type TermWindow = TermDOM["window"];

export type FocusedPanel = "projects" | "sessions";

export type KeybindingsPanelElement = HTMLElement & {
  focusedPanel: FocusedPanel | null;
};
