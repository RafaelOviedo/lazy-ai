export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return formatCompactNumber(tokens, 1_000_000, "M");
  }

  if (tokens >= 1_000) {
    return formatCompactNumber(tokens, 1_000, "k");
  }

  return String(tokens);
}

function formatCompactNumber(value: number, unitSize: number, suffix: string): string {
  const compactValue = value / unitSize;
  const fractionDigits = compactValue < 10 && !Number.isInteger(compactValue) ? 1 : 0;

  return `${compactValue.toFixed(fractionDigits).replace(/\.0$/, "")}${suffix}`;
}
