import type { ModalConfig, ModalListener, ModalName, ModalPayload } from "./types.js";

export class ModalManager {
  private static instance: ModalManager | null = null;
  private modalConfig: ModalConfig = { isActive: false };
  private readonly listeners = new Set<ModalListener>();

  private constructor() {}

  static getInstance(): ModalManager {
    if (!ModalManager.instance) {
      ModalManager.instance = new ModalManager();
    }

    return ModalManager.instance;
  }

  getSnapshot(): ModalConfig {
    return this.modalConfig;
  }

  subscribe(listener: ModalListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  openModal<T>(component: ModalName, payload?: ModalPayload<T>): void {
    this.modalConfig = {
      isActive: true,
      component,
      payload,
    };

    this.notify();
  }

  closeModal(): void {
    if (!this.modalConfig.isActive) return;

    this.modalConfig = {
      isActive: false,
      component: undefined,
      payload: undefined,
    };

    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
