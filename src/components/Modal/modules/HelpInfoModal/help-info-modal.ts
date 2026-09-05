import { escapeHtml } from "../../../../shared/lib/html/index.js";

import type { TermWindow } from "../../types.js";
import type { HelpInfoModalPayload } from "./types.js";

/**
 * Registers the help info modal custom element against a TermDOM window.
 */
export function ensureHelpInfoModalDefined(window: TermWindow): void {
  if (window.customElements.get("help-info-modal")) {
    return;
  }

  /**
   * Renders keyboard-oriented help information.
   */
  class HelpInfoModal extends window.HTMLElement {
    private closeModalValue: () => void = () => { };
    private payloadValue: HelpInfoModalPayload | undefined;

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
    set payload(value: HelpInfoModalPayload | undefined) {
      if (this.payloadValue === value) return;

      this.payloadValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    /**
     * Returns the modal payload.
     */
    get payload(): HelpInfoModalPayload | undefined {
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
          help-info-modal {
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            width: 30%;
            min-height: 60%;
            border: 1px solid #5fafff;
            border-radius: 5px;
          }

          .help-info-modal__close {
            align-self: flex-end;
          }

          .help-info-modal__title {
            color: #d7ecff;
            font-weight: bold;
            text-align: center;
          }

          .help-info-modal__content {
            display: flex;
            flex-direction: column;
            padding: 1px;
          }

          .help-info-modal__row {
            display: flex;
            justify-content: space-between;
            width: 100%;
          }

          .help-info-modal__key {
            color: #5fafff;
            font-weight: bold;
          }

          .help-info-modal__description {
            color: #8aa4bf;
          }
        </style>

        <legend>${escapeHtml(title)}</legend>
        <div class="help-info-modal__content">
          <span class="keybindings-panel__key"><span style="color: #fff;">h</span> Previous panel</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">l</span> Next panel</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">j</span> Next item</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">k</span> Previous item</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">n</span> New session</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">d</span> Delete session</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">q</span> Quit</span>
          <span class="keybindings-panel__key"><span style="color: #fff;">?</span> Help</span>
        </div>
      `;
    }
  }

  window.customElements.define("help-info-modal", HelpInfoModal);
}
