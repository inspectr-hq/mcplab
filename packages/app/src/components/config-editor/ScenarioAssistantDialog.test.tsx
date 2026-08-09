import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EvalRulesSuggestionCard, ExtractRulesSuggestionCard } from './ScenarioAssistantDialog';

describe('Scenario assistant suggestion cards', () => {
  it('offers add and replace actions for each suggested check', () => {
    const onApplyOne = vi.fn();
    const onReplaceOne = vi.fn();
    const rules = [
      { type: 'contains', value: 'first' },
      { type: 'contains', value: 'second' }
    ] as const;

    render(
      <EvalRulesSuggestionCard
        rules={[...rules]}
        onApply={() => undefined}
        onReplace={() => undefined}
        onApplyOne={onApplyOne}
        onReplaceOne={onReplaceOne}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add check 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace with check 2' }));

    expect(onApplyOne).toHaveBeenCalledWith(rules[0]);
    expect(onReplaceOne).toHaveBeenCalledWith(rules[1]);
  });

  it('offers add and replace actions for each value capture rule', () => {
    const onApplyOne = vi.fn();
    const onReplaceOne = vi.fn();
    const rules = [
      { name: 'first', pattern: 'one' },
      { name: 'second', pattern: 'two' }
    ] as const;

    render(
      <ExtractRulesSuggestionCard
        rules={[...rules]}
        onApply={() => undefined}
        onReplace={() => undefined}
        onApplyOne={onApplyOne}
        onReplaceOne={onReplaceOne}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add value capture rule 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace with value capture rule 2' }));

    expect(onApplyOne).toHaveBeenCalledWith(rules[0]);
    expect(onReplaceOne).toHaveBeenCalledWith(rules[1]);
  });
});
