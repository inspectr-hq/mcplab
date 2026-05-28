import type { EvalResult, ScenarioResult } from '@/types/eval';

export function formatDurationMs(
  durationMs: number,
  options?: { preciseUnderTenSeconds?: boolean }
): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0ms';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (options?.preciseUnderTenSeconds && durationMs < 10_000) {
    const seconds = durationMs / 1000;
    const rounded = Math.round(seconds * 10) / 10;
    const normalized = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
    return `${normalized}s`;
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function getScenarioTotalDurationMs(scenario: ScenarioResult): number {
  if (scenario.runs.length > 0) {
    return scenario.runs.reduce((sum, run) => sum + run.duration, 0);
  }
  return scenario.avgDuration;
}

export function getRunTotalDurationMs(run: EvalResult): number | null {
  const hasScenarioRuns = run.scenarios.some((scenario) => scenario.runs.length > 0);
  if (hasScenarioRuns) {
    return run.scenarios.reduce((sum, scenario) => sum + getScenarioTotalDurationMs(scenario), 0);
  }
  if (typeof run.totalDurationMs === 'number' && run.totalDurationMs >= 0)
    return run.totalDurationMs;
  return null;
}

export function getScenarioToolTimeMs(scenario: ScenarioResult): number {
  if (scenario.runs.length > 0) {
    return scenario.runs.reduce(
      (sum, run) =>
        sum + run.toolCalls.reduce((toolSum, toolCall) => toolSum + toolCall.duration, 0),
      0
    );
  }
  return 0;
}

export function getRunToolTimeMs(run: EvalResult): number | null {
  const hasScenarioRuns = run.scenarios.some((scenario) => scenario.runs.length > 0);
  if (hasScenarioRuns) {
    return run.scenarios.reduce((sum, scenario) => sum + getScenarioToolTimeMs(scenario), 0);
  }
  if (typeof run.totalToolDurationMs === 'number' && run.totalToolDurationMs >= 0) {
    return run.totalToolDurationMs;
  }
  return null;
}
