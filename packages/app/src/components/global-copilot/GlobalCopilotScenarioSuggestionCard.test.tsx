import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenarioSuggestionCard } from './GlobalCopilotCards';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@/lib/global-copilot-actions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/global-copilot-actions')>(
    '@/lib/global-copilot-actions'
  );
  return { ...actual, invokeGlobalCopilotAction: invokeMock };
});

describe('Global Copilot scenario suggestions', () => {
  beforeEach(() => invokeMock.mockResolvedValue({ ok: true }));

  it('applies individual checks and value capture rules', async () => {
    render(
      <ScenarioSuggestionCard
        args={{
          scenarioId: 'scenario-1',
          evalRules: [
            { type: 'contains', value: 'first' },
            { type: 'contains', value: 'second' }
          ],
          extractRules: [
            { name: 'first', pattern: 'one' },
            { name: 'second', pattern: 'two' }
          ]
        }}
      />
    );

    expect(screen.getByText('Suggested Checks update')).toBeInTheDocument();
    expect(screen.getByText('Suggested Value Capture Rules update')).toBeInTheDocument();
    expect(screen.getByText('first · one')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Add selected' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Replace all' })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Add check 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace with check 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add value capture rule 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace with value capture rule 2' }));

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'apply_scenario_patch', {
      scenarioId: 'scenario-1',
      evalRules: [{ type: 'contains', value: 'first' }],
      evalRuleMode: 'append'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'apply_scenario_patch', {
      scenarioId: 'scenario-1',
      evalRules: [{ type: 'contains', value: 'second' }],
      evalRuleMode: 'replace'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'apply_scenario_patch', {
      scenarioId: 'scenario-1',
      extractRules: [{ name: 'first', pattern: 'one' }],
      extractRuleMode: 'append'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'apply_scenario_patch', {
      scenarioId: 'scenario-1',
      extractRules: [{ name: 'second', pattern: 'two' }],
      extractRuleMode: 'replace'
    });
  });
});
