export type PromptSessionModalPayload = {
  onCancel?: () => void;
  onConfirm: (prompt: string) => void;
  sessionTitle: string;
};
