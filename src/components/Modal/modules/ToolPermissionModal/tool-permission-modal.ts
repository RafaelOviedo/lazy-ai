import { escapeHtml } from "../../../../shared/lib/html/index.js";
import { Keybindings } from "../../../../app/types.js";

import type { ToolPermissionDecision } from "../../../../entities/provider/index.js";
import type { TermWindow } from "../../types.js";
import type { ToolPermissionModalPayload } from "./types.js";

type ToolPermissionChoice = {
  decision: ToolPermissionDecision;
  label: string;
};

const maxPathLength = 68;

/**
 * Registers the tool permission modal custom element against a TermDOM window.
 */
export function ensureToolPermissionModalDefined(window: TermWindow): void {
  if (window.customElements.get("tool-permission-modal")) {
    return;
  }

  /**
   * Asks the user to approve or decline one tool call a session wants to run.
   */
  class ToolPermissionModal extends window.HTMLElement {
    private closeModalValue: () => void = () => { };
    private payloadValue: ToolPermissionModalPayload | undefined;
    private selectedIndex = 0;
    private readonly onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();

      if (key === Keybindings.J || key === "arrowdown") {
        event.preventDefault();
        this.moveSelection(1);
        return;
      }

      if (key === Keybindings.K || key === "arrowup") {
        event.preventDefault();
        this.moveSelection(-1);
      }
    };

    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.addEventListener("keydown", this.onKeyDown);
      this.render();
    }

    disconnectedCallback(): void {
      this.removeEventListener("keydown", this.onKeyDown);
    }

    set payload(value: ToolPermissionModalPayload | undefined) {
      if (this.payloadValue === value) return;

      this.payloadValue = value;
      this.selectedIndex = this.resolveInitialSelectionIndex();

      if (this.isConnected) {
        this.render();
      }
    }

    get payload(): ToolPermissionModalPayload | undefined {
      return this.payloadValue;
    }

    set closeModal(value: () => void) {
      this.closeModalValue = value;
    }

    get closeModal(): () => void {
      return this.closeModalValue;
    }

    confirmModal(): void {
      const choice = this.getChoices()[this.selectedIndex];

      if (!choice) return;

      this.payloadValue?.onDecide(choice.decision);
    }

    /**
     * Escaping an approval prompt has to mean "no", never an implicit yes.
     */
    cancelModal(): void {
      this.payloadValue?.onCancel?.();
      this.payloadValue?.onDecide({ behavior: "deny" });
    }

    focusInitialElement(): void {
      this.focus();
    }

    /**
     * Builds the answer list, dropping the session-wide allow when the provider
     * says this call must not write a persistent rule.
     */
    private getChoices(): ToolPermissionChoice[] {
      const request = this.payloadValue?.request;
      const choices: ToolPermissionChoice[] = [
        { decision: { behavior: "allow", scope: "once" }, label: "Allow once" },
      ];

      if (request?.allowsSessionScope) {
        choices.push({
          decision: { behavior: "allow", scope: "session" },
          label: `Allow ${request.toolName} for the rest of this session`,
        });
      }

      choices.push({ decision: { behavior: "deny" }, label: "Deny" });

      return choices;
    }

    /**
     * Opens on Deny when the provider flags the call as one that must not be
     * approved by a stray keystroke.
     */
    private resolveInitialSelectionIndex(): number {
      if (!this.payloadValue?.request.defaultsToDeny) return 0;

      const choices = this.getChoices();
      const denyIndex = choices.findIndex((choice) => choice.decision.behavior === "deny");

      return denyIndex === -1 ? 0 : denyIndex;
    }

    private moveSelection(offset: number): void {
      const choiceCount = this.getChoices().length;

      if (choiceCount === 0) return;

      const nextIndex = Math.min(Math.max(this.selectedIndex + offset, 0), choiceCount - 1);

      if (nextIndex === this.selectedIndex) return;

      this.selectedIndex = nextIndex;
      this.render();
    }

    private render(): void {
      const request = this.payloadValue?.request;

      this.innerHTML = `
        <style>
          tool-permission-modal {
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            width: 35%;
            min-height: 30%;
            border: 1px solid #d7ba7d;
            background: #000;
            border-radius: 5px;
            box-sizing: border-box;
            padding: 1px;
          }

          .tool-permission-modal__title {
            color: #d7ba7d;
            font-weight: bold;
            text-align: center;
            margin-bottom: 1px;
          }

          .tool-permission-modal__prompt {
            color: #d7ecff;
            margin-bottom: 1px;
          }

          .tool-permission-modal__detail,
          .tool-permission-modal__path {
            color: #8aa4bf;
          }

          .tool-permission-modal__queue {
            color: #5fafff;
            margin-top: 1px;
          }

          .tool-permission-modal__choices {
            display: flex;
            flex-direction: column;
            margin-top: 1px;
          }

          .tool-permission-modal__choice {
            color: #8aa4bf;
          }

          .tool-permission-modal__choice.is-selected {
            color: #fff;
            font-weight: bold;
          }

          .tool-permission-modal__actions {
            color: #d7ba7d;
            margin-top: 1px;
          }
        </style>

        <legend class="tool-permission-modal__title">Permission required</legend>
        <div class="tool-permission-modal__detail">${escapeHtml(this.payloadValue?.sessionLabel ?? request?.sessionId ?? "")}</div>
        <div class="tool-permission-modal__prompt">${escapeHtml(request?.title ?? "A session wants to use a tool")}</div>
        <div style="margin-bottom: 1px;">${this.renderPathMarkup()}</div>
        ${this.renderDetailMarkup()}
        <div class="tool-permission-modal__choices">${this.renderChoicesMarkup()}</div>
        ${this.renderQueueMarkup()}
        <div class="tool-permission-modal__actions">j/k to move, Enter to choose, Esc to deny</div>
      `;
    }

    private renderPathMarkup(): string {
      const path = this.payloadValue?.request.path;

      if (!path) return "";

      return `<div class="tool-permission-modal__path">${escapeHtml(this.truncatePath(path))}</div>`;
    }

    private renderDetailMarkup(): string {
      const detail = this.payloadValue?.request.detail;

      if (!detail) return "";

      return `<div class="tool-permission-modal__detail">${escapeHtml(detail)}</div>`;
    }

    private renderQueueMarkup(): string {
      const queuedCount = this.payloadValue?.queuedCount ?? 0;

      if (queuedCount <= 0) return "";

      const requestLabel = queuedCount === 1 ? "request" : "requests";

      return `<div class="tool-permission-modal__queue">${escapeHtml(`${queuedCount} more ${requestLabel} waiting`)}</div>`;
    }

    private renderChoicesMarkup(): string {
      return this.getChoices()
        .map((choice, index) => {
          const isSelected = index === this.selectedIndex;
          const selectedClass = isSelected
            ? "tool-permission-modal__choice is-selected"
            : "tool-permission-modal__choice";
          const cursor = isSelected ? "›" : " ";

          return `
            <div class="${selectedClass}" data-selected="${isSelected}">
              <span>${cursor} ${escapeHtml(choice.label)}</span>
            </div>
          `;
        })
        .join("");
    }

    /**
     * Keeps a long path on one row by dropping the middle, not the filename.
     */
    private truncatePath(path: string): string {
      if (path.length <= maxPathLength) return path;

      const tailLength = Math.floor((maxPathLength - 3) / 2);
      const headLength = maxPathLength - 3 - tailLength;

      return `${path.slice(0, headLength)}...${path.slice(-tailLength)}`;
    }
  }

  window.customElements.define("tool-permission-modal", ToolPermissionModal);
}
