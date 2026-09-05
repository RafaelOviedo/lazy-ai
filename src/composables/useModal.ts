import { ModalManager } from "../shared/lib/modal/index.js";

export function useModal() {
  const modalManager = ModalManager.getInstance();

  return {
    closeModal: modalManager.closeModal.bind(modalManager),
    getModalConfig: modalManager.getSnapshot.bind(modalManager),
    openModal: modalManager.openModal.bind(modalManager),
    subscribe: modalManager.subscribe.bind(modalManager),
  };
}
