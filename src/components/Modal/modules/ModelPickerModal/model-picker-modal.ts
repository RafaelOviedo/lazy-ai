import { escapeHtml } from "../../../../shared/lib/html/index.js";
import { Keybindings } from "../../../../shared/config/keybindings.js";

import type { ModelOption } from "../../../../entities/ai-model/index.js";
import type { TermWindow } from "../../types.js";
import type { ModelPickerModalPayload } from "./types.js";

/**
 * Registers the model picker modal custom element against a TermDOM window.
 */
export function ensureModelPickerModalDefined(window: TermWindow): void {
  if (window.customElements.get("model-picker-modal")) {
    return;
  }

  /**
   * Renders every installed provider with its selectable models.
   */
  class ModelPickerModal extends window.HTMLElement {
    private closeModalValue: () => void = () => { };
    private payloadValue: ModelPickerModalPayload | undefined;
    private selectedIndex = 0;
    private readonly onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();

      if (key === Keybindings.J || key === "arrowdown") {
        event.preventDefault();
        this.moveSelection(1);
        return;
      }

      if (key === Keybindings.K || key === "arrowup") {
        event.preventDefault();
        this.moveSelection(-1);
      }
    };

    connectedCallback(): void {
      if (!this.hasAttribute("tabindex")) {
        this.tabIndex = 0;
      }

      this.addEventListener("keydown", this.onKeyDown);
      this.render();
    }

    disconnectedCallback(): void {
      this.removeEventListener("keydown", this.onKeyDown);
    }

    set payload(value: ModelPickerModalPayload | undefined) {
      if (this.payloadValue === value) return;

      this.payloadValue = value;
      this.selectedIndex = this.resolveInitialSelectionIndex();

      if (this.isConnected) {
        this.render();
      }
    }

    get payload(): ModelPickerModalPayload | undefined {
      return this.payloadValue;
    }

    set closeModal(value: () => void) {
      this.closeModalValue = value;
    }

    get closeModal(): () => void {
      return this.closeModalValue;
    }

    confirmModal(): void {
      const model = this.getModels()[this.selectedIndex];

      if (!model) return;

      this.payloadValue?.onSelect(model);
    }

    cancelModal(): void {
      this.payloadValue?.onCancel?.();
      this.closeModalValue();
    }

    focusInitialElement(): void {
      this.focus();
      this.revealSelectedModel();
    }

    /**
     * Flattens every provider group into the single list the keyboard walks.
     */
    private getModels(): ModelOption[] {
      return (this.payloadValue?.groups ?? []).flatMap((group) => group.models);
    }

    /**
     * Starts the cursor on the active model so reopening keeps the user's place.
     */
    private resolveInitialSelectionIndex(): number {
      const activeProvider = this.payloadValue?.activeProvider;

      if (!activeProvider) return 0;

      const activeIndex = this.getModels().findIndex((model) => {
        return model.providerId === activeProvider.providerId && model.id === activeProvider.modelId;
      });

      if (activeIndex !== -1) return activeIndex;

      const providerIndex = this.getModels().findIndex((model) => model.providerId === activeProvider.providerId);

      return providerIndex === -1 ? 0 : providerIndex;
    }

    /**
     * Moves the cursor across provider boundaries without wrapping past the ends.
     */
    private moveSelection(offset: number): void {
      const modelCount = this.getModels().length;

      if (modelCount === 0) return;

      const nextIndex = Math.min(Math.max(this.selectedIndex + offset, 0), modelCount - 1);

      if (nextIndex === this.selectedIndex) return;

      this.selectedIndex = nextIndex;
      this.render();
      this.revealSelectedModel();
    }

    /**
     * Keeps the highlighted model inside the scrollable area.
     */
    private revealSelectedModel(): void {
      const selectedItem = this.querySelector<HTMLElement>("[data-selected='true']");

      selectedItem?.scrollIntoView({ block: "nearest" });
    }

    private render(): void {
      const groups = this.payloadValue?.groups ?? [];

      this.innerHTML = `
        <style>
          model-picker-modal {
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            width: 45%;
            height: 75%;
            max-height: 90%;
            border: 1px solid #fff;
            background: #000;
            border-radius: 5px;
            box-sizing: border-box;
            padding: 1px;
          }

          .model-picker-modal__title {
            color: #d7ecff;
            font-weight: bold;
            text-align: center;
            margin-bottom: 1px;
          }

          .model-picker-modal__content {
            display: flex;
            flex-direction: column;
            overflow-y: auto;
          }

          .model-picker-modal__provider {
            color: #5fafff;
            font-weight: bold;
            margin-top: 1px;
          }

          .model-picker-modal__model {
            display: flex;
            justify-content: space-between;
            width: 100%;
            color: #8aa4bf;
          }

          .model-picker-modal__model.is-selected {
            color: #fff;
            font-weight: bold;
          }

          .model-picker-modal__marker {
            color: #d7ba7d;
          }

          .model-picker-modal__meta {
            color: #444;
          }

          .model-picker-modal__empty {
            color: #8aa4bf;
          }

          .model-picker-modal__actions {
            color: #d7ba7d;
            margin-top: 1px;
          }
        </style>

        <legend class="model-picker-modal__title">Providers and models</legend>
        <div class="model-picker-modal__content">${this.renderGroupsMarkup(groups)}</div>
        <div class="model-picker-modal__actions">j/k to move, Enter to select, Esc to cancel</div>
      `;
    }

    /**
     * Builds one block per provider, keeping a running index across the groups.
     */
    private renderGroupsMarkup(groups: ModelPickerModalPayload["groups"]): string {
      if (groups.length === 0) {
        return `<div class="model-picker-modal__empty">No providers detected on this machine.</div>`;
      }

      let modelIndex = 0;

      return groups
        .map((group) => {
          const modelsMarkup = group.models
            .map((model) => this.renderModelMarkup(model, modelIndex++))
            .join("");

          return `
            <div class="model-picker-modal__provider">${escapeHtml(group.label)}</div>
            ${modelsMarkup}
          `;
        })
        .join("");
    }

    /**
     * Renders one model row, marking the cursor position and the active model.
     */
    private renderModelMarkup(model: ModelOption, index: number): string {
      const activeProvider = this.payloadValue?.activeProvider;
      const isSelected = index === this.selectedIndex;
      const isActive = activeProvider?.providerId === model.providerId && activeProvider.modelId === model.id;
      const selectedClass = isSelected ? "model-picker-modal__model is-selected" : "model-picker-modal__model";
      const marker = isActive ? `<span class="model-picker-modal__marker">●</span> ` : "  ";
      const cursor = isSelected ? "›" : " ";

      return `
        <div class="${selectedClass}" data-selected="${isSelected}">
          <span>${cursor} ${marker}${escapeHtml(model.label)}</span>
          <span class="model-picker-modal__meta">${escapeHtml(this.renderModelMeta(model))}</span>
        </div>
      `;
    }

    /**
     * Summarizes the secondary model details that fit on one row.
     */
    private renderModelMeta(model: ModelOption): string {
      const contextWindow = model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k ctx` : "";

      return [model.defaultEffort, contextWindow].filter(Boolean).join(" · ");
    }
  }

  window.customElements.define("model-picker-modal", ModelPickerModal);
}
