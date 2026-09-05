export function renderTokenBar(percent: number, width = 20): string {
  const normalizedPercent = Math.min(100, Math.max(0, percent));
  const filledWidth = Math.round((normalizedPercent / 100) * width);
  const emptyWidth = width - filledWidth;

  return `[${"=".repeat(filledWidth)}${".".repeat(emptyWidth)}]`;
}
