import { escapeHtml, renderWithStableStyle } from "../../../../shared/lib/html/index.js";
import {
  agentModes,
  describeMode,
  modeLabels,
  type AgentMode,
  type ModeAvailability,
} from "../../../../entities/provider/model/agent-mode.js";
import type { ProviderId } from "../../../../entities/provider/types.js";
import type { TermWindow } from "../../types.js";

export type ModesModalPayload = {
  mode: AgentMode;
  providerId: ProviderId;
  unavailable: ModeAvailability;
  blockedReason?: string;
  onSelect(mode: AgentMode): Promise<void>;
};

export function ensureModesModalDefined(window: TermWindow): void {
  if (window.customElements.get("modes-modal")) return;

  class ModesModal extends window.HTMLElement {
    private value?: ModesModalPayload;
    private index = 0;
    private saving = false;
    private error = "";
    closeModal: () => void = () => { };
    private readonly onKeyDown = (event: KeyboardEvent) => {
      if (this.saving || event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      const offset =
        key === "j" || key === "arrowdown" ? 1 : key === "k" || key === "arrowup" ? -1 : 0;
      if (!offset) return;
      event.preventDefault();
      this.index = Math.max(0, Math.min(agentModes.length - 1, this.index + offset));
      this.render();
    };
    connectedCallback() {
      this.tabIndex = 0;
      this.addEventListener("keydown", this.onKeyDown);
      this.render();
    }
    disconnectedCallback() {
      this.removeEventListener("keydown", this.onKeyDown);
    }
    set payload(value: ModesModalPayload | undefined) {
      this.value = value;
      this.index = Math.max(0, agentModes.indexOf(value?.mode ?? "manual"));
      this.error = "";
      if (this.isConnected) this.render();
    }
    focusInitialElement() {
      this.focus();
    }
    cancelModal() {
      if (!this.saving) this.closeModal();
    }
    confirmModal() {
      const mode = agentModes[this.index];
      if (!this.value || this.saving || this.value.blockedReason || this.value.unavailable[mode])
        return;
      this.saving = true;
      this.render();
      void this.value
        .onSelect(mode)
        .then(() => this.closeModal())
        .catch((error: unknown) => {
          this.error = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          this.saving = false;
          if (this.isConnected) this.render();
        });
    }
    private render() {
      const provider = this.value?.providerId ?? "codex";
      renderWithStableStyle(
        this,
        `
        <style>
          modes-modal { display: flex; flex-direction: column; width: 60%; max-height: 85%; overflow: auto; border: 1px solid #fff; background: #000; padding: 1px; border-radius: 5px; }
          .modes__title { color: #5fafff; font-weight: bold; }
          .modes__row { color: #8aa4bf; margin-top: 1px; }
          .modes__selected { color: #fff; font-weight: bold; }
          .modes__reason { color: #d7ba7d; }
          .modes__help { color: #8aa4bf; margin-top: 1px; }
        </style>
        <legend class="modes__title">Modes — ${provider === "codex" ? "Codex" : "Claude Code"}</legend>
        <div>Global preference across projects and providers</div>
        ${agentModes
          .map(
            (
              mode,
              index,
            ) => `<div class="modes__row ${index === this.index ? "modes__selected" : ""}">${index === this.index ? "›" : " "} ${mode === this.value?.mode ? "●" : "○"} ${modeLabels[mode]}${this.value?.unavailable[mode] ? " (unavailable)" : ""}</div>
          <div>${escapeHtml(describeMode(mode, provider))}</div>
          ${this.value?.unavailable[mode] ? `<div class="modes__reason">${escapeHtml(this.value.unavailable[mode]!)}</div>` : ""}`,
          )
          .join("")}
        <div class="modes__reason">${escapeHtml(this.error || this.value?.blockedReason || "")}</div>
        <div class="modes__help">${this.saving ? "Applying mode…" : "j/k or ↑/↓ to move · Enter to select · Esc to cancel"}</div>
      `,
      );
    }
  }
  window.customElements.define("modes-modal", ModesModal);
}
