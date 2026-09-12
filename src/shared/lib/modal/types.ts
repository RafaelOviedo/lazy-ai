export enum ModalName {
  confirmDeleteSessionModal = "ConfirmDeleteSessionModal",
  keybindingsModal = "KeybindingsModal",
  modelPickerModal = "ModelPickerModal",
  promptSessionModal = "PromptSessionModal",
  sessionPromptErrorModal = "SessionPromptErrorModal",
  startNewSessionModal = "StartNewSessionModal",
}

export type ModalPayload<T = unknown> = T;

export type ModalConfig<T = unknown> = {
  isActive: boolean;
  component?: ModalName;
  payload?: ModalPayload<T>;
};

export type ModalListener = () => void;
