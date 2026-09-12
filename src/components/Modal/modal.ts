import { useModal } from "../../composables/useModal.js";
import { ModalName } from "../../shared/lib/modal/index.js";
import { Keybindings } from "../../app/keybindings.types.js";
import { ensureConfirmDeleteSessionModalDefined } from "./modules/ConfirmDeleteSessionModal/confirm-delete-session-modal.js";
import { ensureHelpInfoModalDefined } from "./modules/HelpInfoModal/help-info-modal.js";
import { ensureModelPickerModalDefined } from "./modules/ModelPickerModal/model-picker-modal.js";
import { ensurePromptSessionModalDefined } from "./modules/PromptSessionModal/prompt-session-modal.js";
import { ensureSessionPromptErrorModalDefined } from "./modules/SessionPromptErrorModal/session-prompt-error-modal.js";
import { ensureStartNewSessionModalDefined } from "./modules/StartNewSessionModal/start-new-session-modal.js";

import type { ModalConfig } from "../../shared/lib/modal/index.js";
import type { ModalComponentDefinition, ModalElement, TermWindow } from "./types.js";

const modalComponentMap: Record<ModalName, ModalComponentDefinition> = {
  [ModalName.confirmDeleteSessionModal]: { tagName: "confirm-delete-session-modal", define: ensureConfirmDeleteSessionModalDefined },
  [ModalName.helpInfoModal]: { tagName: "help-info-modal", define: ensureHelpInfoModalDefined },
  [ModalName.modelPickerModal]: { tagName: "model-picker-modal", define: ensureModelPickerModalDefined },
  [ModalName.promptSessionModal]: { tagName: "prompt-session-modal", define: ensurePromptSessionModalDefined },
  [ModalName.sessionPromptErrorModal]: { tagName: "session-prompt-error-modal", define: ensureSessionPromptErrorModalDefined },
  [ModalName.startNewSessionModal]: { tagName: "start-new-session-modal", define: ensureStartNewSessionModalDefined },
};

const defaultPreloadedModal = ModalName.helpInfoModal;

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
      const modalConfig = this.modal.getModalConfig();

      if (!modalConfig.isActive) return;

      if (event.key === Keybindings.ENTER && !event.shiftKey && this.confirmActiveModal(modalConfig)) {
        event.preventDefault();
        return;
      }

      if (event.key !== Keybindings.ESCAPE) return;

      event.preventDefault();

      if (!this.cancelActiveModal(modalConfig)) {
        this.modal.closeModal();
      }
    };

    /**
     * Subscribes to modal state when the root enters the document.
     */
    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.preloadModalShell(defaultPreloadedModal);
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

      const modalElement = this.syncModalElement(modalComponent);

      if (modalElement?.focusInitialElement) {
        modalElement.focusInitialElement();
      } else {
        this.focus();
      }
    }

    /**
     * Builds the default modal once so the first open only toggles visibility.
     */
    private preloadModalShell(component: ModalName): void {
      if (this.hasRenderedShell && this.renderedComponent === component) return;

      const modalComponent = modalComponentMap[component];

      modalComponent.define(window);
      this.renderModalShell({ isActive: false, component }, modalComponent);
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
    private syncModalElement(modalComponent: ModalComponentDefinition): ModalElement | null {
      const modalElement = this.querySelector<ModalElement>(modalComponent.tagName);

      if (!modalElement) return null;

      modalElement.closeModal = this.modal.closeModal.bind(this.modal);
      modalElement.payload = this.modal.getModalConfig().payload;

      return modalElement;
    }

    /**
     * Invokes the active modal confirmation action when it exposes one.
     */
    private confirmActiveModal(modalConfig: ModalConfig): boolean {
      const modalElement = this.getActiveModalElement(modalConfig);

      if (!modalElement?.confirmModal) return false;

      modalElement.confirmModal();
      return true;
    }

    /**
     * Invokes the active modal cancellation action when it exposes one.
     */
    private cancelActiveModal(modalConfig: ModalConfig): boolean {
      const modalElement = this.getActiveModalElement(modalConfig);

      if (!modalElement?.cancelModal) return false;

      modalElement.cancelModal();
      return true;
    }

    /**
     * Returns the element for the current modal component.
     */
    private getActiveModalElement(modalConfig: ModalConfig): ModalElement | null {
      if (!modalConfig.component) return null;

      const modalComponent = modalComponentMap[modalConfig.component];

      return this.querySelector<ModalElement>(modalComponent.tagName);
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
