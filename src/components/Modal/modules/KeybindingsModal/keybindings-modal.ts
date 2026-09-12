import { escapeHtml } from "../../../../shared/lib/html/index.js";

import type { TermWindow } from "../../types.js";
import type { KeybindingsModalPayload } from "./types.js";

/**
 * Registers the keybindings modal custom element against a TermDOM window.
 */
export function ensureKeybindingsModalDefined(window: TermWindow): void {
  if (window.customElements.get("keybindings-modal")) {
    return;
  }

  /**
   * Renders keyboard-oriented help information.
   */
  class KeybindingsModal extends window.HTMLElement {
    private closeModalValue: () => void = () => { };
    private payloadValue: KeybindingsModalPayload | undefined;

    /**
     * Initializes the modal markup and event delegation.
     */
    connectedCallback(): void {
      this.render();
    }

    /**
     * Cleans up delegated event handling.
     */
    disconnectedCallback(): void {
    }

    /**
     * Updates the modal payload.
     */
    set payload(value: KeybindingsModalPayload | undefined) {
      if (this.payloadValue === value) return;

      this.payloadValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the modal payload.
     */
    get payload(): KeybindingsModalPayload | undefined {
      return this.payloadValue;
    }

    /**
     * Updates the close callback supplied by the modal root.
     */
    set closeModal(value: () => void) {
      this.closeModalValue = value;
    }

    /**
     * Returns the close callback supplied by the modal root.
     */
    get closeModal(): () => void {
      return this.closeModalValue;
    }

    /**
     * Re-renders the modal content and modal-owned dimensions.
     */
    private render(): void {
      const title = this.payloadValue?.title ?? "Keybindings"

      this.innerHTML = `
        <style>
          keybindings-modal {
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            width: 30%;
            min-height: 60%;
            border: 1px solid #fff;
            background: #000;
            border-radius: 5px;
          }

          .keybindings-modal__close {
            align-self: flex-end;
          }

          .keybindings-modal__title {
            color: #d7ecff;
            font-weight: bold;
            text-align: center;
          }

          .keybindings-modal__content {
            display: flex;
            flex-direction: column;
            padding: 1px;
          }

          .keybindings-panel__moves {
            border-bottom: 1px solid #fff;
          }
          .keybindings-panel__actions {
            margin-top: 1px;
            border-bottom: 1px solid #fff;
          }

          .keybindings-modal__row {
            display: flex;
            justify-content: space-between;
            width: 100%;
          }

          .keybindings-modal__key {
            color: #5fafff;
            font-weight: bold;
          }

          .keybindings-modal__description {
            color: #8aa4bf;
          }
        </style>

        <legend>${escapeHtml(title)}</legend>
        <div class="keybindings-modal__content">
          <span class="keybindings-panel__moves">Moves</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">h</span> Previous panel</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">l</span> Next panel</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">j</span> Next item</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">k</span> Previous item</span>

          <span class="keybindings-panel__actions">Actions</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">Space</span> Resume session (Sessions panel)</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">Space</span> Select project (Projects panel)</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">n</span> New session</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">p</span> Prompt session</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">i</span> Interrupt response</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">d</span> Delete session</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">m</span> Providers and models</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">q</span> Quit</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">?</span> Keybindings</span>
        </div>
      `;
    }
  }

  window.customElements.define("keybindings-modal", KeybindingsModal);
}
