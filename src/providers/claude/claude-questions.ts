import type { AgentQuestion } from "../../entities/provider/types.js";

export function parseClaudeQuestions(value: unknown): AgentQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((question, index) => {
    if (!question || typeof question.question !== "string") return [];
    return [{
      id: String(index), header: typeof question.header === "string" ? question.header : "Question",
      question: question.question, multiSelect: question.multiSelect === true, allowOther: true,
      options: Array.isArray(question.options) ? question.options.filter((option: { label?: unknown }) => typeof option?.label === "string")
        .map((option: { label: string; description?: string }) => ({ label: option.label, description: option.description ?? "" })) : [],
    }];
  });
}
