import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantReasoning } from './AssistantReasoning';

describe('AssistantReasoning', () => {
  it('is open while reasoning streams in and closed once it has finished', () => {
    const { rerender } = render(<AssistantReasoning reasoning={{ text: 'Checking the run.' }} />);
    expect(screen.getByText('Thinking…')).toBeVisible();
    expect(screen.getByText('Checking the run.')).toBeVisible();

    rerender(<AssistantReasoning reasoning={{ text: 'Checking the run.', durationMs: 3200 }} />);
    expect(screen.getByText('Thought for 3 seconds')).toBeVisible();
    expect(screen.queryByText('Checking the run.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Thought for 3 seconds'));
    expect(screen.getByText('Checking the run.')).toBeVisible();
  });

  it('shows only the duration when the provider returned no summary', () => {
    render(<AssistantReasoning reasoning={{ text: '', durationMs: 1000 }} />);
    expect(screen.getByText('Thought for 1 second')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
