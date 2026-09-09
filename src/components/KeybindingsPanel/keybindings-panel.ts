/**
 * Registers the Keybindings panel custom element against a TermDOM window.
 */
import type { TermWindow } from "./types.js";

export function ensureKeybindingsPanelDefined(window: TermWindow): void {
  if (window.customElements.get("keybindings-panel")) {
    return;
  }

  /**
   * Renders the static keybinding reference.
   */
  class KeybindingsPanel extends window.HTMLElement {
    /**
     * Initializes the panel markup when the element is attached.
     */
    connectedCallback(): void {
      this.render();
    }

    /**
     * Re-renders the light DOM for the panel.
     */
    private render(): void {
      this.innerHTML = `
        <style>
          keybindings-panel {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            width: 97.5%;
            height: 5%;
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
            <span class="keybindings-panel__key">Previous panel: h ↑</span> <span>|</span>
            <span class="keybindings-panel__key">Next panel: l ↓</span> <span>|</span>
            <span class="keybindings-panel__key">Previous item: k ↑</span> <span>|</span>
            <span class="keybindings-panel__key">Next item: j ↓</span> <span>|</span>
            <span class="keybindings-panel__key">New session: n</span> <span>|</span>
            <span class="keybindings-panel__key">Delete session: d</span> <span>|</span>
            <span class="keybindings-panel__key">Quit: q</span> <span>|</span>
            <span class="keybindings-panel__key">Help: ?</span>
          </div>
        </div>
        <span>v1.0.0</span>
      `;
    }
  }

  window.customElements.define("keybindings-panel", KeybindingsPanel);
}
