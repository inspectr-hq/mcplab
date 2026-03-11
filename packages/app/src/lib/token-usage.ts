import type { TokenUsage } from "@/types/eval";

export type TokenAccumulator = {
  input: number;
  output: number;
  total: number;
  hasInput: boolean;
  hasOutput: boolean;
  hasTotal: boolean;
};

export function createTokenAccumulator(): TokenAccumulator {
  return {
    input: 0,
    output: 0,
    total: 0,
    hasInput: false,
    hasOutput: false,
    hasTotal: false
  };
}

export function addTokenUsage(
  accumulator: TokenAccumulator,
  usage?: TokenUsage | null
): void {
  if (!usage) return;
  if (typeof usage.inputTokens === "number") {
    accumulator.input += usage.inputTokens;
    accumulator.hasInput = true;
  }
  if (typeof usage.outputTokens === "number") {
    accumulator.output += usage.outputTokens;
    accumulator.hasOutput = true;
  }
  if (typeof usage.totalTokens === "number") {
    accumulator.total += usage.totalTokens;
    accumulator.hasTotal = true;
  }
}

export function toTokenUsage(accumulator: TokenAccumulator): TokenUsage | null {
  if (!accumulator.hasInput && !accumulator.hasOutput && !accumulator.hasTotal) return null;
  return {
    inputTokens: accumulator.hasInput ? accumulator.input : null,
    outputTokens: accumulator.hasOutput ? accumulator.output : null,
    totalTokens: accumulator.hasTotal ? accumulator.total : null
  };
}

export function sumTokenUsages(
  usages: Array<TokenUsage | null | undefined>
): TokenUsage | null {
  const accumulator = createTokenAccumulator();
  for (const usage of usages) addTokenUsage(accumulator, usage);
  return toTokenUsage(accumulator);
}
