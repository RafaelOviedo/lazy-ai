export enum ModalName {
  actionErrorModal = "ActionErrorModal",
  confirmDeleteSessionModal = "ConfirmDeleteSessionModal",
  keybindingsModal = "KeybindingsModal",
  modelPickerModal = "ModelPickerModal",
  promptSessionModal = "PromptSessionModal",
  startNewSessionModal = "StartNewSessionModal",
  toolPermissionModal = "ToolPermissionModal",
}

export type ModalPayload<T = unknown> = T;

export type ModalConfig<T = unknown> = {
  isActive: boolean;
  component?: ModalName;
  payload?: ModalPayload<T>;
};

export type ModalListener = () => void;
