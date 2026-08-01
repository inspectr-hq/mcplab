import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ResultsDashboard from './ResultsDashboard';
import type { EvalResult } from '@/types/eval';

function makeRun(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id: 'run-1',
    configId: 'cfg-1',
    configHash: 'hash',
    timestamp: '2026-08-01T10:00:00.000Z',
    mcpServerVersions: {},
    scenarios: [],
    overallPassRate: 0.75,
    totalScenarios: 4,
    totalRuns: 4,
    avgToolCalls: 3.5,
    avgLatency: 1200,
    toolTokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150
    },
    ...overrides
  };
}

describe('ResultsDashboard', () => {
  it('summarizes the selected result range', () => {
    render(
      <ResultsDashboard
        runs={[makeRun(), makeRun({ id: 'run-2', overallPassRate: 1, totalScenarios: 2 })]}
        loading={false}
      />
    );

    expect(screen.getByText('Pass Rate')).toBeInTheDocument();
    expect(screen.getByText('87.5%')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Avg Tool Calls')).toBeInTheDocument();
    expect(screen.getByText('Pass / Fail')).toBeInTheDocument();
  });
});
