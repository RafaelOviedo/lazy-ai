import { escapeHtml, renderWithStableStyle } from "../../../../shared/lib/html/index.js";
import type { TermWindow } from "../../types.js";
import type { ToolPermissionModalPayload } from "../ToolPermissionModal/types.js";

/** Answers one question at a time, submitting the complete batch atomically. */
export function ensureAgentQuestionsModalDefined(window: TermWindow): void {
  if (window.customElements.get("agent-questions-modal")) return;
  class AgentQuestionsModal extends window.HTMLElement {
    closeModal: () => void = () => {};
    private value?: ToolPermissionModalPayload;
    private questionIndex = 0;
    private optionIndex = 0;
    private selected = new Set<string>();
    private answers: Record<string, string[]> = {};
    private readonly onKeyDown = (event: KeyboardEvent) => {
      if (event.target === this.querySelector("input")) {
        if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); this.confirmModal(); }
        return;
      }
      const key = event.key.toLowerCase();
      const offset = key === "j" || key === "arrowdown" ? 1 : key === "k" || key === "arrowup" ? -1 : 0;
      if (offset) {
        event.preventDefault();
        this.optionIndex = Math.max(0, Math.min(this.choiceCount() - 1, this.optionIndex + offset));
        this.render();
      } else if (key === " " && this.question()?.multiSelect) {
        event.preventDefault();
        const label = this.question()?.options[this.optionIndex]?.label;
        if (label) { if (this.selected.has(label)) this.selected.delete(label); else this.selected.add(label); this.render(); }
      } else if (key === "tab" && this.querySelector("input")) {
        event.preventDefault(); this.querySelector<HTMLInputElement>("input")?.focus();
      }
    };
    connectedCallback() { this.tabIndex = 0; this.addEventListener("keydown", this.onKeyDown); this.render(); }
    disconnectedCallback() { this.removeEventListener("keydown", this.onKeyDown); }
    set payload(value: ToolPermissionModalPayload | undefined) {
      this.value = value; this.questionIndex = 0; this.optionIndex = 0; this.answers = {}; this.selected.clear();
      if (this.isConnected) this.render();
    }
    private question() { return this.value?.request.questions?.[this.questionIndex]; }
    private choiceCount() { const q = this.question(); return (q?.options.length ?? 0) + (q?.allowOther || !q?.options.length ? 1 : 0); }
    focusInitialElement() { if (!this.question()?.options.length) this.querySelector<HTMLInputElement>("input")?.focus(); else this.focus(); }
    cancelModal() { this.value?.onDecide({ behavior: "deny" }); }
    confirmModal() {
      const q = this.question();
      if (!q) return;
      const input = this.querySelector<HTMLInputElement>("input");
      const other = input?.value.trim();
      let answer: string[];
      if (other) answer = q.multiSelect ? [...this.selected, other] : [other];
      else if (q.multiSelect) answer = [...this.selected];
      else {
        const choice = q.options[this.optionIndex];
        if (!choice) { input?.focus(); return; }
        answer = [choice.label];
      }
      if (!answer.length) return;
      this.answers[q.id] = answer;
      if (this.questionIndex + 1 === this.value?.request.questions?.length) {
        this.value.onDecide({ behavior: "allow", scope: "once", answers: this.answers });
      } else {
        if (input) input.value = "";
        this.questionIndex += 1; this.optionIndex = 0; this.selected.clear(); this.render(); this.focusInitialElement();
      }
    }
    private render() {
      const q = this.question();
      const draft = this.querySelector<HTMLInputElement>("input")?.value ?? "";
      renderWithStableStyle(this, `
        <style>
          agent-questions-modal { display: flex; flex-direction: column; width: 60%; max-height: 85%; overflow: auto; border: 1px solid #d7ba7d; padding: 1px; background: #000; }
          .questions__title { color: #d7ba7d; font-weight: bold; }
          .questions__muted { color: #8aa4bf; }
          .questions__choice { margin-top: 1px; }
          .questions__selected { color: #5fafff; font-weight: bold; }
          .questions__input { width: 100%; color: #fff; background: #000; border: 1px solid #5fafff; }
        </style>
        <legend class="questions__title">${escapeHtml(q?.header ?? "Agent question")} (${this.questionIndex + 1}/${this.value?.request.questions?.length ?? 0})</legend>
        <div class="questions__muted">${escapeHtml(this.value?.sessionLabel ?? "")}</div>
        <div>${escapeHtml(q?.question ?? "")}</div>
        ${(q?.options ?? []).map((option, index) => `<div class="questions__choice ${index === this.optionIndex ? "questions__selected" : ""}">${index === this.optionIndex ? "›" : " "} ${q?.multiSelect ? this.selected.has(option.label) ? "[x]" : "[ ]" : ""} ${escapeHtml(option.label)}</div><div class="questions__muted">${escapeHtml(option.description)}</div>`).join("")}
        ${q && (q.allowOther || !q.options.length) ? `<label class="questions__choice">${this.optionIndex === q.options.length ? "› " : ""}Your answer (Tab to type)</label><input class="questions__input" type="${q.isSecret ? "password" : "text"}" />` : ""}
        <div class="questions__muted">j/k or ↑/↓ to move${q?.multiSelect ? " · Space to toggle" : ""} · Enter to answer · Esc to cancel</div>
      `);
      const input = this.querySelector<HTMLInputElement>("input");
      if (input) input.value = draft;
    }
  }
  window.customElements.define("agent-questions-modal", AgentQuestionsModal);
}
