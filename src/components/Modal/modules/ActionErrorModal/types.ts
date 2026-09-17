export type ActionErrorModalPayload = {
  message?: string;
  onClose?: () => void;
  /** Heading above the message, such as "Not supported" or "Session error". */
  title?: string;
};
