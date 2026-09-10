import { escapeHtml } from "../../../../shared/lib/html/index.js";

import type { TermWindow } from "../../types.js";
import type { ConfirmDeleteSessionModalPayload } from "./types.js";

/**
 * Registers the delete confirmation modal custom element against a TermDOM window.
 */
export function ensureConfirmDeleteSessionModalDefined(window: TermWindow): void {
  if (window.customElements.get("confirm-delete-session-modal")) {
    return;
  }

  /**
   * Renders a destructive session deletion confirmation.
   */
  class ConfirmDeleteSessionModal extends window.HTMLElement {
    private closeModalValue: () => void = () => { };
    private payloadValue: ConfirmDeleteSessionModalPayload | undefined;

    connectedCallback(): void {
      this.render();
    }

    set payload(value: ConfirmDeleteSessionModalPayload | undefined) {
      if (this.payloadValue === value) return;

      this.payloadValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    get payload(): ConfirmDeleteSessionModalPayload | undefined {
      return this.payloadValue;
    }

    set closeModal(value: () => void) {
      this.closeModalValue = value;
    }

    get closeModal(): () => void {
      return this.closeModalValue;
    }

    confirmModal(): void {
      this.payloadValue?.onConfirm();
    }

    cancelModal(): void {
      this.payloadValue?.onCancel?.();
      this.closeModalValue();
    }

    private render(): void {
      const sessionTitle = this.payloadValue?.sessionTitle ?? "Untitled session";

      this.innerHTML = `
        <style>
          confirm-delete-session-modal {
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            width: 34%;
            min-height: 35%;
            border: 1px solid #BA0606;
            background: #000;
            border-radius: 5px;
            box-sizing: border-box;
            padding: 1px;
          }

          .confirm-delete-session-modal__title {
            color: #BA0606;
            font-weight: bold;
            text-align: center;
            margin-bottom: 1px;
          }

          .confirm-delete-session-modal__content {
            display: flex;
            flex-direction: column;
          }

          .confirm-delete-session-modal__session {
            color: #d7ecff;
            font-weight: bold;
            margin-bottom: 1px;
          }

          .confirm-delete-session-modal__warning {
            color: #d7ecff;
            margin-top: 1px;
            margin-bottom: 1px;
          }

          .confirm-delete-session-modal__actions {
            color: #d7ba7d;
          }
        </style>

        <legend class="confirm-delete-session-modal__title">Delete session</legend>
        <div class="confirm-delete-session-modal__content">
          <div>Delete <span class="confirm-delete-session-modal__session">"${escapeHtml(sessionTitle)}"</span>?</div>
          <div class="confirm-delete-session-modal__warning">This cannot be undone</div>
          <div class="confirm-delete-session-modal__actions">To confirm press Enter, to cancel press Esc</div>
        </div>
      `;
    }
  }

  window.customElements.define("confirm-delete-session-modal", ConfirmDeleteSessionModal);
}
