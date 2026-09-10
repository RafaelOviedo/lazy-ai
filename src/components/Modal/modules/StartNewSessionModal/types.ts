export type StartNewSessionModalPayload = {
  onCancel?: () => void;
  onConfirm: (prompt: string) => void;
};
