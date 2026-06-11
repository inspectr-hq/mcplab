import type { EvalResult, ScenarioRun } from '@/types/eval';

export type RunFailureSignalKind = 'auth' | 'rate_limit' | 'infra';

export interface RunFailureSignal {
  kind: RunFailureSignalKind;
  label: string;
  detail: string;
}

function collectRunFailureTexts(result: EvalResult): string[] {
  const texts: string[] = [];
  for (const scenario of result.scenarios) {
    for (const run of scenario.runs) {
      if (run.error) texts.push(run.error);
      texts.push(...run.failureReasons);
    }
  }
  return texts.map((text) => String(text ?? '').trim()).filter(Boolean);
}

function classifyFailureText(text: string): RunFailureSignalKind | null {
  const lower = text.toLowerCase();
  if (
    lower.includes('invalid_token') ||
    lower.includes('authentication failed') ||
    lower.includes('bearer token') ||
    lower.includes('oauth')
  ) {
    return 'auth';
  }
  if (
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit')
  ) {
    return 'rate_limit';
  }
  if (
    lower.includes('scenario error:') ||
    lower.includes('failed to list tools') ||
    lower.includes('failed to connect to mcp server') ||
    lower.includes('tool call failed') ||
    lower.includes('fetch failed') ||
    lower.includes('streamable http error')
  ) {
    return 'infra';
  }
  return null;
}

function signalLabel(kind: RunFailureSignalKind): string {
  if (kind === 'auth') return 'Auth error';
  if (kind === 'rate_limit') return 'Rate limited';
  return 'Infra error';
}

export function getRunFailureSignal(result: EvalResult): RunFailureSignal | null {
  const texts = collectRunFailureTexts(result);
  const kindsInPriority: RunFailureSignalKind[] = ['auth', 'rate_limit', 'infra'];
  for (const kind of kindsInPriority) {
    const detail = texts.find((text) => classifyFailureText(text) === kind);
    if (detail) {
      return {
        kind,
        label: signalLabel(kind),
        detail
      };
    }
  }
  return null;
}

export function hasScenarioExecutionError(run: ScenarioRun): boolean {
  if (run.error?.trim()) return true;
  return run.failureReasons.some((reason) => reason.startsWith('Scenario error:'));
}
