export type TokenBarSegments = {
  done: string;
  rest: string;
};

export function getTokenBarSegments(percent: number, width = 25): TokenBarSegments {
  const normalizedPercent = Math.min(100, Math.max(0, percent));
  const filledWidth = Math.round((normalizedPercent / 100) * width);
  const emptyWidth = width - filledWidth;

  return {
    done: "█".repeat(filledWidth),
    rest: "░".repeat(emptyWidth),
  };
}
