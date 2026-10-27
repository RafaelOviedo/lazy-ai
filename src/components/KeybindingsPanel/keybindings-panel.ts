/**
 * Registers the Keybindings panel custom element against a TermDOM window.
 */
import { renderWithStableStyle } from "../../shared/lib/html/index.js";
import type { FocusedPanel, TermWindow } from "./types.js";

const spaceActionLabels: Record<FocusedPanel, string> = {
  projects: "Select project: Space",
  sessions: "Resume session: Space",
};

export function ensureKeybindingsPanelDefined(window: TermWindow): void {
  if (window.customElements.get("keybindings-panel")) {
    return;
  }

  /**
   * Renders the keybinding reference for the panel that currently has focus.
   */
  class KeybindingsPanel extends window.HTMLElement {
    private focusedPanelValue: FocusedPanel | null = null;

    /**
     * Initializes the panel markup when the element is attached.
     */
    connectedCallback(): void {
      this.render();
    }

    /**
     * Retargets the Space hint at whichever panel has focus.
     */
    set focusedPanel(value: FocusedPanel | null) {
      if (this.focusedPanelValue === value) return;

      this.focusedPanelValue = value;

      if (!this.isConnected) return;

      // Re-rendering would replace the <style> block, and TermDOM restyles the
      // whole screen for a stylesheet change, so only the label text changes.
      const spaceAction = this.querySelector<HTMLElement>("[data-space-action='true']");

      if (spaceAction) {
        spaceAction.textContent = this.renderSpaceActionMarkup();
      } else {
        this.render();
      }
    }

    /**
     * Returns the panel the Space hint currently describes.
     */
    get focusedPanel(): FocusedPanel | null {
      return this.focusedPanelValue;
    }

    /**
     * Re-renders the light DOM for the panel.
     */
    private render(): void {
      renderWithStableStyle(
        this,
        `
        <style>
          keybindings-panel {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            flex: 0 0 3px;
            overflow: hidden;
            border: 1px solid #5fafff;
            border-radius: 5px;
            box-sizing: border-box;
            padding-left: 1px;
            padding-right: 1px;
          }

          .keybindings-panel__key {
            color: #5fafff;
          }
        </style>

        <div style="display: flex; gap: 1px;">
          <span>Keybindings:</span>
          <div>
            <span class="keybindings-panel__key">Move: h/l/j/k</span> <span>|</span>
            <span class="keybindings-panel__key" data-space-action="true">${this.renderSpaceActionMarkup()}</span> <span>|</span>
            <span class="keybindings-panel__key">New session: n</span> <span>|</span>
            <span class="keybindings-panel__key">Prompt session: p</span> <span>|</span>
            <span class="keybindings-panel__key">Delete session: d</span> <span>|</span>
            <span class="keybindings-panel__key">Models: m</span> <span>|</span>
            <span class="keybindings-panel__key">Quit: q</span> <span>|</span>
            <span class="keybindings-panel__key">Keybindings: ?</span>
          </div>
        </div>
        <span>v1.4.0</span>
      `,
      );
    }

    /**
     * Names the action Space performs in the focused panel.
     */
    private renderSpaceActionMarkup(): string {
      if (!this.focusedPanelValue) return spaceActionLabels.sessions;

      return spaceActionLabels[this.focusedPanelValue];
    }
  }

  window.customElements.define("keybindings-panel", KeybindingsPanel);
}
