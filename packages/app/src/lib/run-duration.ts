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

export function getRunTotalDurationMs(run: EvalResult): number {
  const fromScenarios = run.scenarios.reduce((sum, scenario) => sum + getScenarioTotalDurationMs(scenario), 0);
  if (fromScenarios > 0) return fromScenarios;
  if (typeof run.totalDurationMs === 'number' && run.totalDurationMs > 0) return run.totalDurationMs;
  if (run.totalRuns > 0 && Number.isFinite(run.avgLatency) && run.avgLatency > 0) {
    return run.avgLatency * run.totalRuns;
  }
  return 0;
}
