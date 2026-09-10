import { escapeHtml } from "../../../../shared/lib/html/index.js";

import type { TermWindow } from "../../types.js";
import type { StartNewSessionModalPayload } from "./types.js";

/**
 * Registers the new session modal custom element against a TermDOM window.
 */
export function ensureStartNewSessionModalDefined(window: TermWindow): void {
  if (window.customElements.get("start-new-session-modal")) {
    return;
  }

  /**
   * Renders the prompt input used to start a new Codex session.
   */
  class StartNewSessionModal extends window.HTMLElement {
    private closeModalValue: () => void = () => { };
    private payloadValue: StartNewSessionModalPayload | undefined;

    connectedCallback(): void {
      this.render();
    }

    set payload(value: StartNewSessionModalPayload | undefined) {
      if (this.payloadValue === value) return;

      this.payloadValue = value;

      if (this.isConnected) {
        this.render();
      }
    }

    get payload(): StartNewSessionModalPayload | undefined {
      return this.payloadValue;
    }

    set closeModal(value: () => void) {
      this.closeModalValue = value;
    }

    get closeModal(): () => void {
      return this.closeModalValue;
    }

    confirmModal(): void {
      const prompt = this.getPromptValue();

      if (!prompt) return;

      this.payloadValue?.onConfirm(prompt);
    }

    cancelModal(): void {
      this.payloadValue?.onCancel?.();
      this.closeModalValue();
    }

    focusInitialElement(): void {
      const input = this.querySelector<HTMLInputElement>("[data-new-session-input='true']");

      input?.focus();
    }

    private getPromptValue(): string {
      const input = this.querySelector<HTMLInputElement>("[data-new-session-input='true']");

      return input?.value.trim() ?? "";
    }

    private render(): void {
      this.innerHTML = `
        <style>
          start-new-session-modal {
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            width: 42%;
            min-height: 20%;
            border: 1px solid #5fafff;
            background: #000;
            border-radius: 5px;
            box-sizing: border-box;
            padding: 1px;
          }

          .start-new-session-modal__title {
            color: #d7ecff;
            font-weight: bold;
            text-align: center;
            margin-bottom: 1px;
          }

          .start-new-session-modal__content {
            display: flex;
            flex-direction: column;
            gap: 1px;
          }

          .start-new-session-modal__label {
            color: #8aa4bf;
          }

          .start-new-session-modal__input {
            width: 100%;
            color: #d7ecff;
            background: #000;
            border: 1px solid #5fafff;
          }

          .start-new-session-modal__input:focus {
            border-color: #fff;
            outline: none;
          }

          .start-new-session-modal__actions {
            color: #d7ba7d;
          }
        </style>

        <legend class="start-new-session-modal__title">${escapeHtml("Start a new session")}</legend>
        <div class="start-new-session-modal__content">
          <label class="start-new-session-modal__label" for="new-session-prompt">Write your prompt</label>
          <input class="start-new-session-modal__input" data-new-session-input="true" id="new-session-prompt" type="text" />
          <div class="start-new-session-modal__actions">To confirm press Enter, to cancel press Esc</div>
        </div>
      `;
    }
  }

  window.customElements.define("start-new-session-modal", StartNewSessionModal);
}
