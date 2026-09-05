import type { TermDOM } from "@b9g/termdom";

export type TermWindow = TermDOM["window"];

export type ModalComponentDefinition = {
  tagName: string;
  define: (window: TermWindow) => void;
};

export type ModalElement<TPayload = unknown> = HTMLElement & {
  closeModal: () => void;
  payload: TPayload | undefined;
};
