import { useModal } from "../../composables/useModal.js";
import { ModalName } from "../../shared/lib/modal/index.js";
import { Keybindings } from "../../app/keybindings.types.js";
import { ensureHelpInfoModalDefined } from "./modules/HelpInfoModal/help-info-modal.js";

import type { ModalConfig } from "../../shared/lib/modal/index.js";
import type { ModalComponentDefinition, ModalElement, TermWindow } from "./types.js";

const modalComponentMap: Record<ModalName, ModalComponentDefinition> = {
  [ModalName.helpInfoModal]: { tagName: "help-info-modal", define: ensureHelpInfoModalDefined },
};

/**
 * Registers the app modal root custom element against a TermDOM window.
 */
export function ensureModalDefined(window: TermWindow): void {
  if (window.customElements.get("app-modal")) {
    return;
  }

  /**
   * Renders the active modal from the global ModalManager state.
   */
  class AppModal extends window.HTMLElement {
    private readonly modal = useModal();
    private unsubscribe: (() => void) | null = null;
    private previouslyFocusedElement: HTMLElement | null = null;
    private renderedComponent: ModalName | undefined;
    private hasRenderedShell = false;
    private readonly onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== Keybindings.ESCAPE || !this.modal.getModalConfig().isActive) return;

      event.preventDefault();
      this.modal.closeModal();
    };

    /**
     * Subscribes to modal state when the root enters the document.
     */
    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.unsubscribe = this.modal.subscribe(() => this.render());
      this.ownerDocument.addEventListener("keydown", this.onKeyDown);
      this.render();
    }

    /**
     * Releases modal subscriptions and event handlers.
     */
    disconnectedCallback(): void {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.ownerDocument.removeEventListener("keydown", this.onKeyDown);
    }

    /**
     * Re-renders the modal root when modal state changes.
     */
    private render(): void {
      const modalConfig = this.modal.getModalConfig();

      if (!modalConfig.isActive || !modalConfig.component) {
        this.classList.remove("is-active");
        this.restorePreviousFocus();
        return;
      }

      this.capturePreviousFocus();

      const modalComponent = modalComponentMap[modalConfig.component];

      modalComponent.define(window);

      this.classList.add("is-active");

      if (!this.hasRenderedShell || this.renderedComponent !== modalConfig.component) {
        this.renderModalShell(modalConfig, modalComponent);
      }

      this.syncModalElement(modalConfig, modalComponent);
      this.focus();
    }

    /**
     * Computes the active modal shell only when the component changes.
     */
    private renderModalShell(modalConfig: ModalConfig, modalComponent: ModalComponentDefinition): void {
      this.renderedComponent = modalConfig.component;
      this.hasRenderedShell = true;

      this.innerHTML = `
        <style>
          app-modal {
            display: none;
            justify-content: center;
            align-items: center;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
          }

          app-modal.is-active {
            display: flex;
          }
        </style>

        <${modalComponent.tagName} data-modal-content="true"></${modalComponent.tagName}>
      `;
    }

    /**
     * Passes the current payload and close callback to the active modal element.
     */
    private syncModalElement(modalConfig: ModalConfig, modalComponent: ModalComponentDefinition): void {
      const modalElement = this.querySelector<ModalElement>(modalComponent.tagName);

      if (!modalElement) return;

      modalElement.closeModal = this.modal.closeModal;
      modalElement.payload = modalConfig.payload;
    }

    /**
     * Captures the element focused before the modal takes over keyboard input.
     */
    private capturePreviousFocus(): void {
      if (this.previouslyFocusedElement) return;

      const activeElement = this.ownerDocument.activeElement;

      if (activeElement instanceof window.HTMLElement && activeElement !== this && !this.contains(activeElement)) {
        this.previouslyFocusedElement = activeElement;
      }
    }

    /**
     * Returns focus to the element that had it before the modal opened.
     */
    private restorePreviousFocus(): void {
      const elementToRestore = this.previouslyFocusedElement;

      this.previouslyFocusedElement = null;

      if (elementToRestore?.isConnected) {
        elementToRestore.focus();
      }
    }
  }

  window.customElements.define("app-modal", AppModal);
}
