export type ConfirmDeleteSessionModalPayload = {
  onCancel?: () => void;
  onConfirm: () => void;
  sessionId: string;
  sessionTitle: string;
};
