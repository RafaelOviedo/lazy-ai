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
    private readonly onPromptKeyDownCapture = (event: KeyboardEvent): void => {
      const input = this.getPromptInputFromEvent(event);

      if (!input) return;

      if (this.isReliableSoftNewlineEvent(event)) {
        event.preventDefault();
        event.stopPropagation();
        this.insertNewline(input);
        return;
      }

      if (event.key !== "Enter" || event.shiftKey) return;

      event.preventDefault();
      event.stopPropagation();
      this.confirmModal();
    };
    private readonly onPromptKeyDown = (event: KeyboardEvent): void => {
      if (!this.getPromptInputFromEvent(event)) return;
      if (event.key !== "Enter" || !event.shiftKey) return;

      event.stopPropagation();
    };

    connectedCallback(): void {
      this.addEventListener("keydown", this.onPromptKeyDownCapture, true);
      this.addEventListener("keydown", this.onPromptKeyDown);
      this.render();
    }

    disconnectedCallback(): void {
      this.removeEventListener("keydown", this.onPromptKeyDownCapture, true);
      this.removeEventListener("keydown", this.onPromptKeyDown);
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
      const input = this.querySelector<HTMLTextAreaElement>("[data-new-session-input='true']");

      input?.focus();
    }

    private getPromptValue(): string {
      const input = this.querySelector<HTMLTextAreaElement>("[data-new-session-input='true']");

      return input?.value.trim() ?? "";
    }

    private getPromptInputFromEvent(event: KeyboardEvent): HTMLTextAreaElement | null {
      const input = this.querySelector<HTMLTextAreaElement>("[data-new-session-input='true']");

      return event.target === input ? input : null;
    }

    private isReliableSoftNewlineEvent(event: KeyboardEvent): boolean {
      return event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "j";
    }

    private insertNewline(input: HTMLTextAreaElement): void {
      const selectionStart = input.selectionStart ?? input.value.length;
      const selectionEnd = input.selectionEnd ?? selectionStart;

      input.value = `${input.value.slice(0, selectionStart)}\n${input.value.slice(selectionEnd)}`;
      input.selectionStart = selectionStart + 1;
      input.selectionEnd = selectionStart + 1;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
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
            border: 1px solid #fff;
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
            min-height: 5rem;
            box-sizing: border-box;
            color: #d7ecff;
            background: #000;
            border: 1px solid #5fafff;
            resize: vertical;
            text-decoration: none;
            text-decoration-line: none;
            white-space: pre-wrap;
          }

          .start-new-session-modal__input:focus {
            border-color: #fff;
            outline: none;
            text-decoration: none;
            text-decoration-line: none;
          }

          .start-new-session-modal__actions {
            color: #d7ba7d;
          }
        </style>

        <legend class="start-new-session-modal__title">${escapeHtml("Start a new session")}</legend>
        <div class="start-new-session-modal__content">
          <label class="start-new-session-modal__label" for="new-session-prompt">Write your prompt</label>
          <textarea class="start-new-session-modal__input" data-new-session-input="true" id="new-session-prompt"></textarea>
          <div class="start-new-session-modal__actions">To confirm press Enter, Ctrl+J for a new line, Esc to cancel</div>
        </div>
      `;
    }
  }

  window.customElements.define("start-new-session-modal", StartNewSessionModal);
}
