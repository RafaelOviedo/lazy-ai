export enum ModalName {
  confirmDeleteSessionModal = "ConfirmDeleteSessionModal",
  helpInfoModal = "HelpInfoModal",
}

export type ModalPayload<T = unknown> = T;

export type ModalConfig<T = unknown> = {
  isActive: boolean;
  component?: ModalName;
  payload?: ModalPayload<T>;
};

export type ModalListener = () => void;
