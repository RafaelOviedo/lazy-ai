import { escapeHtml } from "../../../../shared/lib/html/index.js";

import type { TermWindow } from "../../types.js";
import type { ActionErrorModalPayload } from "./types.js";

const defaultTitle = "Action unavailable";
const defaultMessage = "That action could not be completed.";

/**
 * Registers the action error modal custom element against a TermDOM window.
 */
export function ensureActionErrorModalDefined(window: TermWindow): void {
  if (window.customElements.get("action-error-modal")) {
    return;
  }

  /**
   * Renders a compact modal for a failed or unavailable session action.
   */
  class ActionErrorModal extends window.HTMLElement {
    private closeModalValue: () => void = () => { };
    private payloadValue: ActionErrorModalPayload | undefined;

    connectedCallback(): void {
      this.render();
    }

    set payload(value: ActionErrorModalPayload | undefined) {
      if (this.payloadValue === value) return;

      this.payloadValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    get payload(): ActionErrorModalPayload | undefined {
      return this.payloadValue;
    }

    set closeModal(value: () => void) {
      this.closeModalValue = value;
    }

    get closeModal(): () => void {
      return this.closeModalValue;
    }

    confirmModal(): void {
      this.close();
    }

    cancelModal(): void {
      this.close();
    }

    private close(): void {
      this.payloadValue?.onClose?.();
      this.closeModalValue();
    }

    private render(): void {
      const title = this.payloadValue?.title ?? defaultTitle;
      const message = this.payloadValue?.message ?? defaultMessage;

      this.innerHTML = `
        <style>
          action-error-modal {
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            width: 34%;
            min-height: 20%;
            border: 1px solid #BA0606;
            background: #000;
            border-radius: 5px;
            box-sizing: border-box;
            padding: 1px;
          }

          .action-error-modal__title {
            color: #BA0606;
            font-weight: bold;
            text-align: center;
            margin-bottom: 1px;
          }

          .action-error-modal__message {
            color: #d7ecff;
            margin-bottom: 1px;
            white-space: pre-wrap;
          }

          .action-error-modal__actions {
            color: #d7ba7d;
          }
        </style>

        <legend class="action-error-modal__title">${escapeHtml(title)}</legend>
        <div class="action-error-modal__message">${escapeHtml(message)}</div>
        <div class="action-error-modal__actions">Press Enter or Esc to close</div>
      `;
    }
  }

  window.customElements.define("action-error-modal", ActionErrorModal);
}
