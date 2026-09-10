import { escapeHtml } from "../../../../shared/lib/html/index.js";

import type { TermWindow } from "../../types.js";
import type { SessionPromptErrorModalPayload } from "./types.js";

/**
 * Registers the session prompt error modal custom element against a TermDOM window.
 */
export function ensureSessionPromptErrorModalDefined(window: TermWindow): void {
  if (window.customElements.get("session-prompt-error-modal")) {
    return;
  }

  /**
   * Renders a compact modal for prompt precondition failures.
   */
  class SessionPromptErrorModal extends window.HTMLElement {
    private closeModalValue: () => void = () => { };
    private payloadValue: SessionPromptErrorModalPayload | undefined;

    connectedCallback(): void {
      this.render();
    }

    set payload(value: SessionPromptErrorModalPayload | undefined) {
      if (this.payloadValue === value) return;

      this.payloadValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    get payload(): SessionPromptErrorModalPayload | undefined {
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
      const message = this.payloadValue?.message ?? "Resume or start a session first";

      this.innerHTML = `
        <style>
          session-prompt-error-modal {
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

          .session-prompt-error-modal__title {
            color: #BA0606;
            font-weight: bold;
            text-align: center;
            margin-bottom: 1px;
          }

          .session-prompt-error-modal__message {
            color: #d7ecff;
            margin-bottom: 1px;
          }

          .session-prompt-error-modal__actions {
            color: #d7ba7d;
          }
        </style>

        <legend class="session-prompt-error-modal__title">Prompt unavailable</legend>
        <div class="session-prompt-error-modal__message">${escapeHtml(message)}</div>
        <div class="session-prompt-error-modal__actions">Press Enter or Esc to close</div>
      `;
    }
  }

  window.customElements.define("session-prompt-error-modal", SessionPromptErrorModal);
}
